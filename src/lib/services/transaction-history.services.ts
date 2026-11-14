import { getTransactions as getIcrcTransactionsApi } from '#lib/api/icrc-index-ng.api.ts';
import {
	TRANSACTION_HISTORY_LEDGER_PAGE_SIZE,
	TRANSACTION_HISTORY_MAX_LEDGER_PAGES,
	ZERO
} from '#lib/constants/app.constants.ts';
import { VXP_INDEX_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { getIdentity } from '#lib/services/identity.services.ts';
import type { TransactionHistoryBonusTag } from '#lib/types/transaction-history.ts';
import {
	decodeVxpAwardMemo,
	type TransactionHistoryLedgerEntry
} from '#lib/utils/transaction-history.utils.ts';
import { mapIcrcTransaction, mapTransactionIcrcToSelf } from '#lib/utils/transactions.utils.ts';
import { fromNullable, isNullish, nonNullish } from '@dfinity/utils';
import type { IcrcIndexDid } from '@icp-sdk/canisters/ledger/icrc';
import type { Identity } from '@icp-sdk/core/agent';

export interface VxpLedgerHistory {
	entries: TransactionHistoryLedgerEntry[];
	/** True when the walk hit the page cap before reaching the oldest tx. */
	truncated: boolean;
}

interface LedgerTxMeta {
	memoTag?: TransactionHistoryBonusTag;
	fee: bigint;
}

/**
 * Memo + fee live on the raw candid operation, which the shared
 * `mapIcrcTransaction` deliberately drops from the unified `Transaction`
 * shape: pull them out here so bonus labeling and fee accounting survive
 * the mapping.
 */
const extractTxMeta = (transaction: IcrcIndexDid.Transaction): LedgerTxMeta => {
	const transfer = fromNullable(transaction.transfer);
	const mint = fromNullable(transaction.mint);

	const memo = nonNullish(transfer)
		? fromNullable(transfer.memo)
		: nonNullish(mint)
			? fromNullable(mint.memo)
			: undefined;

	const fee = nonNullish(transfer) ? (fromNullable(transfer.fee) ?? ZERO) : ZERO;

	return { memoTag: decodeVxpAwardMemo(memo), fee };
};

/**
 * Walk the VXP ICRC index to exhaustion (newest → oldest), capped at
 * `TRANSACTION_HISTORY_MAX_LEDGER_PAGES` pages so a pathological account
 * stays bounded. Returns `undefined` when not signed in or when the very
 * first page fails: partial pages collected before a mid-walk failure are
 * still returned (flagged `truncated`) so the history degrades instead of
 * blanking.
 */
export const loadVxpLedgerHistory = async (): Promise<VxpLedgerHistory | undefined> => {
	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	const principal = identity.getPrincipal();

	const raw: IcrcIndexDid.TransactionWithId[] = [];
	let start: bigint | undefined = undefined;
	let done = false;

	for (let page = 0; page < TRANSACTION_HISTORY_MAX_LEDGER_PAGES && !done; page++) {
		let response: IcrcIndexDid.GetTransactions;

		try {
			response = await getIcrcTransactionsApi({
				identity,
				principal,
				start,
				maxResults: TRANSACTION_HISTORY_LEDGER_PAGE_SIZE,
				indexCanisterId: VXP_INDEX_CANISTER_ID
			});
		} catch (e: unknown) {
			console.error('Failed to walk VXP ledger history', e);

			if (page === 0) {
				return;
			}

			return { entries: mapRawToEntries({ raw, identity }), truncated: true };
		}

		const { transactions } = response;
		raw.push(...transactions);

		const nextStart = transactions[transactions.length - 1]?.id;
		const oldest = fromNullable(response.oldest_tx_id);

		done =
			transactions.length === 0 ||
			BigInt(transactions.length) < TRANSACTION_HISTORY_LEDGER_PAGE_SIZE ||
			(nonNullish(oldest) && nextStart === oldest);

		start = nextStart;
	}

	return { entries: mapRawToEntries({ raw, identity }), truncated: !done };
};

const mapRawToEntries = ({
	raw,
	identity
}: {
	raw: IcrcIndexDid.TransactionWithId[];
	identity: Identity;
}): TransactionHistoryLedgerEntry[] => {
	const metaById = new Map<string, LedgerTxMeta>(
		raw.map(({ id, transaction }) => [id.toString(), extractTxMeta(transaction)])
	);

	const mapped = raw
		.flatMap(mapTransactionIcrcToSelf)
		.map((transaction) => mapIcrcTransaction({ transaction, token: VXP_TOKEN, identity }));

	// The wallet mapper expands a self-transfer into send + receive
	// pseudo-rows (`-self` id suffix on the receive leg). On this page the
	// only real spendable change is the fee, so the receive leg is dropped
	// and the remaining leg flagged: `ledgerEntry` turns it into a hidden
	// fee-only contribution instead of two phantom rows.
	const selfIds = new Set(
		mapped.filter(({ id }) => id.endsWith('-self')).map(({ id }) => id.replace(/-self$/, ''))
	);

	return mapped
		.filter(({ id }) => !id.endsWith('-self'))
		.map((transaction) => {
			const meta = metaById.get(transaction.id) ?? { fee: ZERO };

			return {
				transaction,
				memoTag: meta.memoTag,
				fee: meta.fee,
				selfTransfer: selfIds.has(transaction.id)
			};
		});
};
