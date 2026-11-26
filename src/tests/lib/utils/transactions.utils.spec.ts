import type { ClearingDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import { DAY_IN_MS, MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import { ICP_TOKEN as ICP, VXP_TOKEN as VXP } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { Token } from '#lib/types/token.ts';
import type { Transaction } from '#lib/types/wallet.ts';
import {
	isSettlementLoss,
	mapClearingEventToTransaction,
	mergeTransactionsPage,
	weeklyVxpDeltaBaseUnits
} from '#lib/utils/transactions.utils.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const tx = ({
	id,
	timestamp,
	token = ICP,
	amount = BigInt(1)
}: {
	id: string;
	timestamp: number;
	token?: Token;
	amount?: bigint;
}): Transaction => ({
	id,
	user: 'aaaaa-aa',
	timestamp: BigInt(timestamp),
	type: 'Receive',
	source: 'ledger',
	domain: 'wallet',
	amount,
	token
});

const USER = Principal.anonymous();

// 10 VXP in VXP base units (4 decimals), the scale a Settled event's cashflow uses.
const TEN_VXP = BigInt(100_000);

const nowNs = (): bigint => BigInt(Date.now()) * MILLISECOND_IN_NANOSECONDS;

const clearingEvent = ({
	eventType,
	qty,
	price = { value: BigInt(1), decimals: 0 },
	timestamp = nowNs()
}: {
	eventType: ClearingDid.EventType;
	qty: bigint;
	price?: ClearingDid.DecimalValue;
	timestamp?: bigint;
}): ClearingDid.Event => ({
	event_id: BigInt(1),
	clearing_id: USER,
	series_id: 'series-1',
	user: USER,
	qty,
	price: { decimal: price, timestamp: [], oracle_id: [] },
	event_type: eventType,
	timestamp
});

const clearingRow = (params: Parameters<typeof clearingEvent>[0]): Transaction =>
	mapClearingEventToTransaction({
		event: clearingEvent(params),
		token: VXP,
		user: USER.toText()
	});

const stake = (): Transaction =>
	clearingRow({
		eventType: { Executed: null },
		qty: BigInt(20),
		price: { value: BigInt(5), decimals: 1 }
	});

const settlement = (cashflow: bigint): Transaction =>
	clearingRow({ eventType: { Settled: null }, qty: cashflow });

const ids = (txs: Transaction[]): string[] =>
	txs.map(({ id, token }) => `${id}@${token.ledgerCanisterId}`);

describe('transactions.utils', () => {
	describe('mergeTransactionsPage', () => {
		it('appends a page and sorts the result newest-first', () => {
			const merged = mergeTransactionsPage({
				transactions: [tx({ id: 'a', timestamp: 30 }), tx({ id: 'b', timestamp: 10 })],
				page: [tx({ id: 'c', timestamp: 20 }), tx({ id: 'd', timestamp: 5 })]
			});

			assert.deepEqual(ids(merged), [
				`a@${ICP.ledgerCanisterId}`,
				`c@${ICP.ledgerCanisterId}`,
				`b@${ICP.ledgerCanisterId}`,
				`d@${ICP.ledgerCanisterId}`
			]);
		});

		it('keeps one row per id and ledger, the page row winning', () => {
			const merged = mergeTransactionsPage({
				transactions: [tx({ id: 'a', timestamp: 10, amount: BigInt(1) })],
				page: [tx({ id: 'a', timestamp: 10, amount: BigInt(2) })]
			});

			assert.equal(merged.length, 1);
			assert.equal(merged[0].amount, BigInt(2));
		});

		it('keeps the same id on two ledgers as two rows', () => {
			const merged = mergeTransactionsPage({
				transactions: [tx({ id: '7', timestamp: 10, token: ICP })],
				page: [tx({ id: '7', timestamp: 20, token: VXP })]
			});

			assert.deepEqual(ids(merged), [`7@${VXP.ledgerCanisterId}`, `7@${ICP.ledgerCanisterId}`]);
		});

		it('returns an empty list for two empty inputs', () => {
			assert.deepEqual(mergeTransactionsPage({ transactions: [], page: [] }), []);
		});
	});

	describe('mapClearingEventToTransaction', () => {
		it('maps a winning outcome settlement to its cashflow', () => {
			const row = settlement(TEN_VXP);

			assert.equal(row.type, 'Settlement');
			assert.equal(row.amount, TEN_VXP);
			assert.equal(row.qty, TEN_VXP);
		});

		it('keeps the magnitude of a losing settlement and its signed qty', () => {
			const row = settlement(-TEN_VXP);

			assert.equal(row.amount, TEN_VXP);
			assert.equal(row.qty, -TEN_VXP);
		});

		it('does not scale a price settlement cashflow by the settlement price', () => {
			const row = clearingRow({
				eventType: { Settled: null },
				qty: TEN_VXP,
				price: { value: BigInt(25), decimals: 2 }
			});

			assert.equal(row.amount, TEN_VXP);
		});
	});

	describe('isSettlementLoss', () => {
		it('is true for a settlement with a negative cashflow', () => {
			assert.equal(isSettlementLoss(settlement(-TEN_VXP)), true);
		});

		it('is false for a winning settlement', () => {
			assert.equal(isSettlementLoss(settlement(TEN_VXP)), false);
		});

		it('is false for a row that is not a settlement', () => {
			assert.equal(isSettlementLoss(stake()), false);
		});
	});

	describe('weeklyVxpDeltaBaseUnits', () => {
		it('reports the net win of a call staked and settled this week', () => {
			assert.equal(weeklyVxpDeltaBaseUnits([settlement(TEN_VXP), stake()]), TEN_VXP);
		});

		it('reports the net loss of a call staked and settled this week', () => {
			assert.equal(weeklyVxpDeltaBaseUnits([settlement(-TEN_VXP), stake()]), -TEN_VXP);
		});

		it('reports no change for a week with only a stake', () => {
			assert.equal(weeklyVxpDeltaBaseUnits([stake()]), ZERO);
		});

		it('adds ledger receives and leaves out rows older than seven days', () => {
			const eightDaysAgoNs = BigInt(Date.now() - 8 * DAY_IN_MS) * MILLISECOND_IN_NANOSECONDS;

			const received = tx({ id: 'r', timestamp: Number(nowNs()), token: VXP, amount: TEN_VXP });
			const oldWin = clearingRow({
				eventType: { Settled: null },
				qty: TEN_VXP,
				timestamp: eightDaysAgoNs
			});

			assert.equal(weeklyVxpDeltaBaseUnits([received, oldWin]), TEN_VXP);
		});
	});
});
