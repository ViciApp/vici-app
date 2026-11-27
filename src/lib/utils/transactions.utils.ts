import type { ClearingDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import { DAY_IN_MS, MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { MarketId } from '#lib/types/market.ts';
import type { Token } from '#lib/types/token.ts';
import type { Transaction, TransactionType } from '#lib/types/wallet.ts';
import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
import { AccountIdentifier } from '@icp-sdk/canisters/ledger/icp';
import type { IcrcAccount } from '@icp-sdk/canisters/ledger/icrc';
import type { Principal } from '@icp-sdk/core/principal';

export const getAccountIdentifier = (principal: Principal): AccountIdentifier =>
	AccountIdentifier.fromPrincipal({ principal, subAccount: undefined });

export const getIcrcAccount = (principal: Principal): IcrcAccount => ({ owner: principal });

/**
 * Maps a clearing-canister `Event` (OrderPlaced / Executed / Settled /
 * Liquidated) into a `Transaction` row so it can stream into the same
 * activity table as ICRC ledger entries.
 *
 * The on-chain event records `qty` (in token base units) and `price`
 * (a probability between 0 and 1). The user-visible "amount" for trades is
 * the notional, i.e. `qty × price`, rounded back to base units. For
 * `OrderPlaced` we use `qty` directly so the order's full notional shows up
 * regardless of execution status; the row is informational and does not
 * itself move VXP on the ICRC ledger.
 */
export const mapClearingEventToTransaction = ({
	event,
	token,
	user
}: {
	event: ClearingDid.Event;
	token: Token;
	user: string;
}): Transaction => {
	const [eventKey] = Object.keys(event.event_type) as Array<keyof ClearingDid.EventType>;

	const priceUnit = decimalFixedValueToNumber({
		value: event.price.decimal.value,
		decimals: event.price.decimal.decimals
	});

	const qtyAsNumber = Number(event.qty);
	const notional = BigInt(Math.round(qtyAsNumber * priceUnit));

	const type: TransactionType =
		eventKey === 'OrderPlaced'
			? 'OrderPlaced'
			: eventKey === 'Executed'
				? 'Trade'
				: eventKey === 'Settled'
					? 'Settlement'
					: 'Liquidation';

	const amount = type === 'OrderPlaced' ? event.qty : notional;

	return {
		id: `clearing-${event.event_id.toString()}-${eventKey}`,
		user,
		timestamp: event.timestamp,
		type,
		source: 'clearing',
		domain: 'collateral',
		marketId: event.series_id as MarketId,
		amount,
		token,
		priceE6: event.price.decimal.value,
		qty: event.qty
	};
};

const sortNewestFirst = (txs: Transaction[]): Transaction[] =>
	txs.sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1));

/**
 * Folds one ledger-history page into the rows already loaded: one row per
 * transaction id and ledger (the page's copy wins, since index pages can
 * overlap), sorted newest-first.
 */
export const mergeTransactionsPage = ({
	transactions,
	page
}: {
	transactions: Transaction[];
	page: Transaction[];
}): Transaction[] => {
	const txKey = (tx: Transaction) => `${tx.id}-${tx.token.ledgerCanisterId}`;
	const merged: Record<string, Transaction> = {};

	for (const tx of [...transactions, ...page]) {
		merged[txKey(tx)] = tx;
	}

	return sortNewestFirst(Object.values(merged));
};

/**
 * Assembles the unified Wallet activity feed: merges the paged ICRC ledger
 * rows with the clearing rows, keeps only the tokens the wallet currently
 * surfaces, and sorts newest-first.
 */
export const mergeWalletFeed = ({
	ledgerTransactions,
	clearingTransactions,
	allowedLedgerCanisterIds
}: {
	ledgerTransactions: Transaction[];
	clearingTransactions: Transaction[];
	allowedLedgerCanisterIds: Iterable<string>;
}): Transaction[] => {
	const allowed = new Set(allowedLedgerCanisterIds);

	const merged = [...ledgerTransactions, ...clearingTransactions].filter((tx) =>
		allowed.has(tx.token.ledgerCanisterId)
	);

	return sortNewestFirst(merged);
};

/**
 * Weekly VXP delta: sums signed amounts on VXP-denominated rows from the last
 * 7 days. Settlements / receives / mints / rewards credit; trades / sends /
 * burns / liquidations debit (the entry amount is never refunded). Result is in VXP
 * base units; format at display only.
 */
export const weeklyVxpDeltaBaseUnits = (transactions: Transaction[]): bigint => {
	const cutoffNs = BigInt(Date.now() - 7 * DAY_IN_MS) * MILLISECOND_IN_NANOSECONDS;
	let delta = ZERO;

	const recentVxpTx = transactions.filter(
		(tx) => tx.timestamp >= cutoffNs && tx.token.symbol === VXP_TOKEN.symbol
	);

	for (const tx of recentVxpTx) {
		switch (tx.type) {
			case 'Settlement':
			case 'Receive':
			case 'Mint':
			case 'Reward':
				delta += tx.amount;
				break;
			case 'Trade':
			case 'Send':
			case 'Burn':
			case 'Liquidation':
				delta -= tx.amount;
				break;
			default:
				break;
		}
	}

	return delta;
};
