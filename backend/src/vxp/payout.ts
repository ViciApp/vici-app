// Treasury-signed VXP ledger access behind an injectable provider, so award
// logic and tests never touch the network directly. The transfer path retries
// once on BadFee with the ledger-reported expected fee, the only rejection
// worth an automatic second attempt. Callers that pass created_at_time get the
// ledger's deduplication: replaying an identical transfer answers Duplicate,
// which is reported as the original success rather than a failure.

import { isNullish, jsonReplacer, nonNullish } from '@dfinity/utils';
import { IcrcLedgerCanister, IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { Principal } from '@icp-sdk/core/principal';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { getAssetBySymbol } from '../custody/assets';
import { buildAgent } from '../lib/ic-agent';
import { treasuryIcIdentity, treasuryIcPrincipalText, userIcPrincipalText } from '../lib/keys';

/** The slice of the ICRC ledger client the payout path uses. Mirrors the
 * canister client's own method shapes so the default provider is a plain
 * pass-through and tests can hand in a stub. */
export interface VxpLedger {
	transfer: (params: {
		to: { owner: Principal; subaccount: [] };
		amount: bigint;
		fee?: bigint;
		memo?: Uint8Array;
		created_at_time?: bigint;
	}) => Promise<bigint>;
	balance: (params: { owner: Principal; certified: boolean }) => Promise<bigint>;
}

export type VxpLedgerProvider = () => Promise<VxpLedger>;

const defaultLedgerProvider: VxpLedgerProvider = async () => {
	const asset = await getAssetBySymbol({ chain: 'ic', symbol: 'VXP' });

	if (isNullish(asset) || isNullish(asset.ledger_ref)) {
		throw new Error('VXP asset is not seeded with a ledger canister id');
	}

	const agent = await buildAgent(treasuryIcIdentity());

	return IcrcLedgerCanister.create({
		agent,
		canisterId: Principal.fromText(asset.ledger_ref)
	});
};

let ledgerProvider: VxpLedgerProvider = defaultLedgerProvider;

/** Test seam: swap the ledger for a stub; returns a restore function. */
export const setVxpLedgerProvider = (provider: VxpLedgerProvider): (() => void) => {
	const previous = ledgerProvider;

	ledgerProvider = provider;

	return () => {
		ledgerProvider = previous;
	};
};

interface TransferErrorVariant {
	BadFee?: { expected_fee: bigint };
	InsufficientFunds?: { balance: bigint };
	Duplicate?: { duplicate_of: bigint };
}

const errorVariantOf = (err: unknown): TransferErrorVariant | undefined => {
	if (err instanceof IcrcTransferError) {
		const variant = err.errorType;

		if (nonNullish(variant) && typeof variant === 'object') {
			return variant as TransferErrorVariant;
		}
	}
};

/** Human-readable summary of a transfer rejection for logs and the stored
 * error_message: spells out the two cases routinely hit and falls back to a
 * JSON dump (or the message) for the rest. */
export const transferErrorText = (err: unknown): string => {
	const variant = errorVariantOf(err);

	if (nonNullish(variant?.InsufficientFunds)) {
		return `InsufficientFunds(balance=${variant.InsufficientFunds.balance})`;
	}

	if (nonNullish(variant?.BadFee)) {
		return `BadFee(expected_fee=${variant.BadFee.expected_fee})`;
	}

	if (nonNullish(variant)) {
		return JSON.stringify(variant, jsonReplacer);
	}

	return err instanceof Error ? err.message : String(err);
};

/**
 * The VXP ledger was installed without a max_memo_length override, so it keeps
 * the ICRC-1 ledger default of 32 bytes and rejects a longer memo outright,
 * while award memos embed their key (a league uuid alone is 36 characters). An over-long memo keeps its readable head and
 * swaps the tail for a digest of the full text, so it stays deterministic
 * (a replayed transfer must carry byte-identical memo to be deduplicated).
 */
export const MAX_TRANSFER_MEMO_BYTES = 32;

const MEMO_DIGEST_HEX_CHARS = 12;

export const encodeTransferMemo = (memo: string): Uint8Array => {
	const bytes = new TextEncoder().encode(memo);

	if (bytes.length <= MAX_TRANSFER_MEMO_BYTES) {
		return bytes;
	}

	const digest = bytesToHex(sha256(bytes)).slice(0, MEMO_DIGEST_HEX_CHARS);
	const head = bytes.slice(0, MAX_TRANSFER_MEMO_BYTES - MEMO_DIGEST_HEX_CHARS - 1);
	const encoded = new Uint8Array(MAX_TRANSFER_MEMO_BYTES);

	encoded.set(head);
	encoded.set(new TextEncoder().encode(`~${digest}`), head.length);

	return encoded;
};

/** A failed transfer says whether the ledger rejected it for lack of funds:
 * that rejection is definitive (nothing moved, and the ledger reports a
 * Duplicate before it checks the balance), so the caller may safely try the
 * same award again once the treasury is refilled. */
export type VxpTransferResult =
	{ ok: true; blockIndex: string } | { ok: false; error: string; insufficientFunds: boolean };

const failedTransfer = (err: unknown): VxpTransferResult => {
	const duplicate = errorVariantOf(err)?.Duplicate;

	if (nonNullish(duplicate)) {
		return { ok: true, blockIndex: duplicate.duplicate_of.toString() };
	}

	return {
		ok: false,
		error: transferErrorText(err),
		insufficientFunds: nonNullish(errorVariantOf(err)?.InsufficientFunds)
	};
};

/**
 * Treasury transfer of VXP base units to an owner principal, retrying once
 * with the ledger-reported expected_fee on a BadFee rejection. The memo is a
 * short tag string (e.g. vxp:streak:streak_7) encoded to bytes here so call
 * sites pass a plain string. createdAtTimeNs, when given, opts into ledger
 * deduplication (24h window): the same memo + stamp replayed after a crash
 * answers Duplicate, reported here as the original block.
 */
export const transferVxpWithBadFeeRetry = async ({
	toOwner,
	amount,
	memo,
	createdAtTimeNs
}: {
	toOwner: Principal;
	amount: bigint;
	memo: string;
	createdAtTimeNs?: bigint;
}): Promise<VxpTransferResult> => {
	const ledger = await ledgerProvider();
	const memoBytes = encodeTransferMemo(memo);

	const tryTransfer = (fee?: bigint): Promise<bigint> =>
		ledger.transfer({
			to: { owner: toOwner, subaccount: [] },
			amount,
			...(nonNullish(fee) ? { fee } : {}),
			memo: memoBytes,
			...(nonNullish(createdAtTimeNs) ? { created_at_time: createdAtTimeNs } : {})
		});

	try {
		return { ok: true, blockIndex: (await tryTransfer()).toString() };
	} catch (firstErr) {
		const badFee = errorVariantOf(firstErr)?.BadFee;

		if (isNullish(badFee)) {
			return failedTransfer(firstErr);
		}

		try {
			return { ok: true, blockIndex: (await tryTransfer(badFee.expected_fee)).toString() };
		} catch (retryErr) {
			return failedTransfer(retryErr);
		}
	}
};

/** Transfer to a user's custodial principal: in this stack the user's VXP
 * account IS their derived custodial IC principal. */
export const transferVxpToUser = ({
	userId,
	amount,
	memo,
	createdAtTimeNs
}: {
	userId: string;
	amount: bigint;
	memo: string;
	createdAtTimeNs?: bigint;
}): Promise<VxpTransferResult> =>
	transferVxpWithBadFeeRetry({
		toOwner: Principal.fromText(userIcPrincipalText(userId)),
		amount,
		memo,
		createdAtTimeNs
	});

/** The user's spendable VXP balance (base units), read from the ledger. */
export const getVxpBalance = async (userId: string): Promise<bigint> => {
	const ledger = await ledgerProvider();

	return await ledger.balance({
		owner: Principal.fromText(userIcPrincipalText(userId)),
		certified: false
	});
};

/** The treasury's own spendable VXP balance (base units): what the award
 * payouts draw on, refilled by the minter reserve registered for it. */
export const getTreasuryVxpBalance = async (): Promise<bigint> => {
	const ledger = await ledgerProvider();

	return await ledger.balance({
		owner: Principal.fromText(treasuryIcPrincipalText()),
		certified: false
	});
};
