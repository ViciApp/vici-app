// Solana primitive vectors: the RFC 8032 ed25519 test vector for public key
// derivation, base58 vectors from the reference test suite, the compact-u16
// length encoding, and program-derived address invariants.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import { describe, expect, test } from 'bun:test';
import {
	buildSolTransferTx,
	buildSplTransferTx,
	deriveAssociatedTokenAccount,
	findProgramAddress,
	shortvec,
	solAddressFromSeed,
	SYSTEM_PROGRAM_ID,
	TOKEN_PROGRAM_ID
} from '../src/chains/sol/tx';

describe('solAddressFromSeed', () => {
	test('matches the RFC 8032 ed25519 test vector 1 public key', () => {
		const seed = hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
		const address = solAddressFromSeed(seed);

		expect(bytesToHex(base58.decode(address))).toBe(
			'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
		);
	});

	test('is deterministic', () => {
		const seed = new Uint8Array(32).fill(7);

		expect(solAddressFromSeed(seed)).toBe(solAddressFromSeed(seed));
	});
});

describe('base58', () => {
	// Vectors from the canonical base58 encode/decode test set.
	test.each([
		['61', '2g'],
		['626262', 'a3gV'],
		['636363', 'aPEr'],
		['516b6fcd0f', 'ABnLTmg']
	])('encodes %s to %s', (hex, encoded) => {
		expect(base58.encode(hexToBytes(hex))).toBe(encoded);
	});
});

describe('shortvec', () => {
	test.each([
		[0, [0x00]],
		[1, [0x01]],
		[127, [0x7f]],
		[128, [0x80, 0x01]],
		[255, [0xff, 0x01]],
		[16384, [0x80, 0x80, 0x01]]
	])('encodes %i', (length, bytes) => {
		expect([...shortvec(length)]).toEqual(bytes);
	});
});

describe('program-derived addresses', () => {
	test('derivation is deterministic and off-curve by construction', () => {
		const owner = solAddressFromSeed(new Uint8Array(32).fill(1));
		const mint = solAddressFromSeed(new Uint8Array(32).fill(2));

		const first = deriveAssociatedTokenAccount({ owner, mint });
		const second = deriveAssociatedTokenAccount({ owner, mint });

		expect(first).toBe(second);
		expect(base58.decode(first)).toHaveLength(32);
		// Distinct owners land on distinct token accounts.
		expect(
			deriveAssociatedTokenAccount({ owner: solAddressFromSeed(new Uint8Array(32).fill(3)), mint })
		).not.toBe(first);
	});

	test('changes with the program id', () => {
		const seeds = [new TextEncoder().encode('vici-test-seed')];

		expect(findProgramAddress({ seeds, programId: TOKEN_PROGRAM_ID })).not.toBe(
			findProgramAddress({ seeds, programId: SYSTEM_PROGRAM_ID })
		);
	});
});

describe('signed transfers', () => {
	const seed = new Uint8Array(32).fill(1);
	const to = solAddressFromSeed(new Uint8Array(32).fill(2));
	const mint = solAddressFromSeed(new Uint8Array(32).fill(3));
	const recentBlockhash = solAddressFromSeed(new Uint8Array(32).fill(4));

	const wireDigest = (base64: string): string =>
		bytesToHex(sha256(Uint8Array.from(Buffer.from(base64, 'base64'))));

	// ed25519 signing is deterministic, so a digest of the wire pins every
	// byte of the message layout and the signature over it.
	test('pins the native SOL transfer wire bytes', () => {
		const wire = buildSolTransferTx({ seed, to, lamports: BigInt(1_000_000), recentBlockhash });

		expect(wireDigest(wire)).toBe(
			'a034dafa03d78cb0a7fdb60279a8f055a6f7ee71374fb1ad48088257128cbb6c'
		);
	});

	test('pins the SPL transfer wire bytes', () => {
		const wire = buildSplTransferTx({
			seed,
			to,
			amount: BigInt(2_500_000),
			mint,
			recentBlockhash
		});

		expect(wireDigest(wire)).toBe(
			'9637c029338b332841f2faa640070f865d62980eb44786376d594db7dd5a57e9'
		);
	});
});
