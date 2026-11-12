// Double-entry internal ledger. Every business event (deposit credit,
// withdrawal hold, refund) posts legs that sum to zero per asset, inside one
// transaction, keyed by an event key whose replay collides on the unique
// per-leg idempotency key instead of double-posting.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { ZERO } from '../lib/constants';

export interface LedgerLeg {
	accountId: string;
	assetId: string;
	/** Signed amount in the asset's base units, as a decimal string. */
	delta: string;
}

export interface LedgerEvent {
	eventKey: string;
	kind: string;
	legs: LedgerLeg[];
}

const assertBalanced = (legs: LedgerLeg[]): void => {
	if (legs.length < 2) {
		throw new Error('ledger event needs at least two legs');
	}

	const sums = new Map<string, bigint>();

	for (const leg of legs) {
		// Base units are integers; a fractional delta is a caller bug.
		if (!/^-?\d+$/.test(leg.delta)) {
			throw new Error(`ledger leg delta is not an integer base-unit amount: ${leg.delta}`);
		}

		sums.set(leg.assetId, (sums.get(leg.assetId) ?? ZERO) + BigInt(leg.delta));
	}

	for (const [assetId, sum] of sums) {
		if (sum !== ZERO) {
			throw new Error(`ledger event legs do not sum to zero for asset ${assetId}`);
		}
	}
};

const insertLegs = async ({ q, event }: { q: TxQuery; event: LedgerEvent }): Promise<boolean> => {
	const existing = await q<{ id: string }>(
		`select id from ledger_entries where event_key = $1 limit 1`,
		[event.eventKey]
	);

	if (nonNullish(existing[0])) {
		return false;
	}

	for (const [index, leg] of event.legs.entries()) {
		await q(
			`insert into ledger_entries (account_id, asset_id, delta, kind, event_key, idempotency_key)
			 values ($1, $2, $3, $4, $5, $6)
			 on conflict (idempotency_key) do nothing`,
			[
				leg.accountId,
				leg.assetId,
				leg.delta,
				event.kind,
				event.eventKey,
				`${event.eventKey}#${index}`
			]
		);
	}

	return true;
};

/** Post one balanced event. Returns false when the event key was already
 * posted (idempotent replay). Pass `q` to join an enclosing transaction. */
export const postLedgerEvent = async (event: LedgerEvent, q?: TxQuery): Promise<boolean> => {
	assertBalanced(event.legs);

	if (isNullish(q)) {
		return await tx((txq) => insertLegs({ q: txq, event }));
	}

	return await insertLegs({ q, event });
};

/** The balance of one account in one asset, in base units. */
export const accountBalance = async ({
	q,
	accountId,
	assetId
}: {
	q: TxQuery;
	accountId: string;
	assetId: string;
}): Promise<bigint> => {
	const rows = await q<{ balance: string }>(
		`select coalesce(sum(delta), 0)::text as balance
		 from ledger_entries where account_id = $1 and asset_id = $2`,
		[accountId, assetId]
	);

	return BigInt(rows[0]?.balance ?? '0');
};

/** One asset's balance as the wallet reports it, in base units. */
export interface AssetBalanceRow {
	asset_id: string;
	symbol: string;
	chain: string;
	decimals: number;
	balance: string;
}

/** A user's book balances on every chain except ic, whose balances live on the
 * ledgers and are read there instead. */
export const listUserBookBalances = (userId: string): Promise<AssetBalanceRow[]> =>
	query<AssetBalanceRow>(
		`select b.asset_id, a.symbol, a.chain, a.decimals, b.balance::text as balance
		 from custody_balances b
		 join assets a on a.id = b.asset_id
		 join custody_accounts c on c.id = b.account_id
		 where c.user_id = $1 and a.chain <> 'ic'
		 order by a.chain, a.symbol`,
		[userId]
	);
