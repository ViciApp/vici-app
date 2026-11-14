// ICRC-1 transfer pieces shared by every backend path that sends on an ICRC
// ledger (VXP award payouts, custodial withdrawals). A transfer carrying
// created_at_time opts into the ledger's deduplication: an identical transfer
// (same sender, recipient, amount, fee, memo and created_at_time) sent again
// inside the window answers Duplicate with the original block instead of
// moving funds twice. The ledger checks the window (TooOld, CreatedInFuture)
// and the duplicate BEFORE the balance, so a replay answered InsufficientFunds
// proves no earlier send of it landed, while a replay answered TooOld proves
// nothing at all.

import { jsonReplacer, nonNullish } from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { HOUR_IN_MS } from '../../lib/time';

/**
 * The ledger deduplicates a transfer only within 24 hours (plus 2 minutes of
 * drift) of its created_at_time. A replay is only sent while its stamp is well
 * inside that window, where a landed transfer answers Duplicate; an older one
 * needs the ledger history instead.
 */
export const DEDUP_SAFE_WINDOW_MS = 23 * HOUR_IN_MS;

export interface IcrcTransferErrorVariant {
	BadFee?: { expected_fee: bigint };
	BadBurn?: { min_burn_amount: bigint };
	InsufficientFunds?: { balance: bigint };
	Duplicate?: { duplicate_of: bigint };
	TooOld?: null;
	CreatedInFuture?: { ledger_time: bigint };
	TemporarilyUnavailable?: null;
	GenericError?: { message: string; error_code: bigint };
}

/** The ledger's TransferError variant, or undefined for anything that is not
 * a ledger rejection (network, timeout, canister reject): those leave open
 * whether the transfer executed. */
export const icrcTransferErrorVariant = (err: unknown): IcrcTransferErrorVariant | undefined => {
	if (err instanceof IcrcTransferError) {
		const variant = err.errorType;

		if (nonNullish(variant) && typeof variant === 'object') {
			return variant as IcrcTransferErrorVariant;
		}
	}
};

/** Human-readable summary of a transfer rejection for logs and stored
 * failure reasons: spells out the two cases routinely hit and falls back to a
 * JSON dump (or the message) for the rest. */
export const transferErrorText = (err: unknown): string => {
	const variant = icrcTransferErrorVariant(err);

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
 * ICRC-1 ledgers installed without a max_memo_length override keep the
 * default of 32 bytes and reject a longer memo outright, while memos embed
 * their key (a uuid alone is 36 characters). An over-long memo keeps its
 * readable head and swaps the tail for a digest of the full text, so it stays
 * deterministic (a replayed transfer must carry byte-identical memo to be
 * deduplicated).
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
