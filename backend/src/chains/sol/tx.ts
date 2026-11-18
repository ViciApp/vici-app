// Minimal Solana primitives: address derivation, associated token account
// derivation and legacy transaction building for SOL + SPL transfers.
// Hand-rolled on @noble/curves + @scure/base instead of the official web3 SDK:
// the custody service builds exactly two instruction shapes, and the legacy
// message format is small and stable.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { concatBytes } from '../../lib/bytes';
import { ZERO } from '../../lib/constants';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** The base58 Solana address for an ed25519 seed. */
export const solAddressFromSeed = (seed: Uint8Array): string =>
	base58.encode(ed25519.getPublicKey(seed));

const decodeAddress = (address: string): Uint8Array => base58.decode(address);

/** A base58 32-byte public key. */
export const isSolAddress = (address: string): boolean => {
	try {
		return decodeAddress(address).length === 32;
	} catch (_: unknown) {
		return false;
	}
};

/** Compact-u16 ("shortvec") length prefix used throughout the wire format. */
export const shortvec = (length: number): Uint8Array => {
	const out: number[] = [];
	let rest = length;

	for (;;) {
		const byte = rest & 0x7f;

		rest >>= 7;

		if (rest === 0) {
			out.push(byte);

			return Uint8Array.from(out);
		}

		out.push(byte | 0x80);
	}
};

const u64le = (value: bigint): Uint8Array => {
	if (value < ZERO) {
		throw new Error('u64 cannot encode a negative amount');
	}

	const out = new Uint8Array(8);
	let rest = value;

	for (let i = 0; i < 8; i++) {
		out[i] = Number(rest & BigInt(0xff));
		rest >>= BigInt(8);
	}

	return out;
};

const isOnCurve = (bytes: Uint8Array): boolean => {
	try {
		ed25519.Point.fromBytes(bytes);

		return true;
	} catch {
		return false;
	}
};

/** Program-derived address: sha256(seeds .. bump .. programId .. marker),
 * taking the first bump whose hash is NOT a curve point. */
export const findProgramAddress = ({
	seeds,
	programId
}: {
	seeds: Uint8Array[];
	programId: string;
}): string => {
	const marker = new TextEncoder().encode('ProgramDerivedAddress');
	const program = decodeAddress(programId);

	for (let bump = 255; bump >= 0; bump--) {
		const hash = sha256(concatBytes(...seeds, Uint8Array.of(bump), program, marker));

		if (!isOnCurve(hash)) {
			return base58.encode(hash);
		}
	}

	throw new Error('no viable program-derived address bump');
};

/** The associated token account of `owner` for `mint`. */
export const deriveAssociatedTokenAccount = ({
	owner,
	mint
}: {
	owner: string;
	mint: string;
}): string =>
	findProgramAddress({
		seeds: [decodeAddress(owner), decodeAddress(TOKEN_PROGRAM_ID), decodeAddress(mint)],
		programId: ASSOCIATED_TOKEN_PROGRAM_ID
	});

interface Instruction {
	programId: string;
	/** Account addresses in instruction order with their access flags. */
	accounts: { address: string; isSigner: boolean; isWritable: boolean }[];
	data: Uint8Array;
}

/** Serialize + sign a single-signer legacy transaction; base64 for
 * sendTransaction. */
const buildSignedTx = ({
	seed,
	feePayer,
	recentBlockhash,
	instructions
}: {
	seed: Uint8Array;
	feePayer: string;
	recentBlockhash: string;
	instructions: Instruction[];
}): string => {
	interface AccountMeta {
		isSigner: boolean;
		isWritable: boolean;
	}

	const metas = new Map<string, AccountMeta>();

	const upsert = (address: string, meta: AccountMeta): void => {
		const existing = metas.get(address);

		metas.set(address, {
			isSigner: (existing?.isSigner ?? false) || meta.isSigner,
			isWritable: (existing?.isWritable ?? false) || meta.isWritable
		});
	};

	upsert(feePayer, { isSigner: true, isWritable: true });

	for (const instruction of instructions) {
		for (const account of instruction.accounts) {
			upsert(account.address, { isSigner: account.isSigner, isWritable: account.isWritable });
		}

		upsert(instruction.programId, { isSigner: false, isWritable: false });
	}

	// Message account ordering: signers first (fee payer leading), then
	// writable non-signers, then readonly non-signers.
	const ordered = [...metas.entries()].sort(([aAddr, a], [bAddr, b]) => {
		if (aAddr === feePayer) {
			return -1;
		}

		if (bAddr === feePayer) {
			return 1;
		}

		if (a.isSigner !== b.isSigner) {
			return a.isSigner ? -1 : 1;
		}

		if (a.isWritable !== b.isWritable) {
			return a.isWritable ? -1 : 1;
		}

		return aAddr < bAddr ? -1 : 1;
	});

	const numSigners = ordered.filter(([, meta]) => meta.isSigner).length;
	const numReadonlySigned = ordered.filter(([, meta]) => meta.isSigner && !meta.isWritable).length;
	const numReadonlyUnsigned = ordered.filter(
		([, meta]) => !meta.isSigner && !meta.isWritable
	).length;

	const indexOf = new Map(ordered.map(([address], index) => [address, index]));
	const accountKeys = concatBytes(...ordered.map(([address]) => decodeAddress(address)));

	const compiledInstructions = instructions.map((instruction) => {
		const programIndex = indexOf.get(instruction.programId) ?? 0;
		const accountIndexes = Uint8Array.from(
			instruction.accounts.map((account) => indexOf.get(account.address) ?? 0)
		);

		return concatBytes(
			Uint8Array.of(programIndex),
			shortvec(accountIndexes.length),
			accountIndexes,
			shortvec(instruction.data.length),
			instruction.data
		);
	});

	const message = concatBytes(
		Uint8Array.of(numSigners, numReadonlySigned, numReadonlyUnsigned),
		shortvec(ordered.length),
		accountKeys,
		decodeAddress(recentBlockhash),
		shortvec(compiledInstructions.length),
		...compiledInstructions
	);

	const signature = ed25519.sign(message, seed);
	const wire = concatBytes(shortvec(1), signature, message);

	return Buffer.from(wire).toString('base64');
};

/** A signed native SOL transfer (system program, instruction 2). */
export const buildSolTransferTx = ({
	seed,
	to,
	lamports,
	recentBlockhash
}: {
	seed: Uint8Array;
	to: string;
	lamports: bigint;
	recentBlockhash: string;
}): string => {
	const from = solAddressFromSeed(seed);
	const data = concatBytes(Uint8Array.of(2, 0, 0, 0), u64le(lamports));

	return buildSignedTx({
		seed,
		feePayer: from,
		recentBlockhash,
		instructions: [
			{
				programId: SYSTEM_PROGRAM_ID,
				accounts: [
					{ address: from, isSigner: true, isWritable: true },
					{ address: to, isSigner: false, isWritable: true }
				],
				data
			}
		]
	});
};

/** A signed SPL transfer to the recipient's associated token account,
 * preceded by an idempotent create so a first-time recipient works too. */
export const buildSplTransferTx = ({
	seed,
	to,
	amount,
	mint,
	recentBlockhash
}: {
	seed: Uint8Array;
	to: string;
	amount: bigint;
	mint: string;
	recentBlockhash: string;
}): string => {
	const from = solAddressFromSeed(seed);
	const sourceAta = deriveAssociatedTokenAccount({ owner: from, mint });
	const destAta = deriveAssociatedTokenAccount({ owner: to, mint });

	return buildSignedTx({
		seed,
		feePayer: from,
		recentBlockhash,
		instructions: [
			{
				// CreateIdempotent (discriminator 1) on the associated token program.
				programId: ASSOCIATED_TOKEN_PROGRAM_ID,
				accounts: [
					{ address: from, isSigner: true, isWritable: true },
					{ address: destAta, isSigner: false, isWritable: true },
					{ address: to, isSigner: false, isWritable: false },
					{ address: mint, isSigner: false, isWritable: false },
					{ address: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
					{ address: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
				],
				data: Uint8Array.of(1)
			},
			{
				// Transfer (instruction 3) on the token program.
				programId: TOKEN_PROGRAM_ID,
				accounts: [
					{ address: sourceAta, isSigner: false, isWritable: true },
					{ address: destAta, isSigner: false, isWritable: true },
					{ address: from, isSigner: true, isWritable: false }
				],
				data: concatBytes(Uint8Array.of(3), u64le(amount))
			}
		]
	});
};
