// Flow award semantics: lifetime-call milestone crossings, the overtime
// credit at the daily cap, its per-day idempotency and the rolling
// wall-clock anti-farming cap, strict under concurrent mints.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { parseVxp, VXP_FLOW_OVERTIME_ROLLING_CAP } from '../src/vxp/constants';
import { flowMilestonesCrossed, mintFlowOvertime, runFlowMilestoneTrigger } from '../src/vxp/flow';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { readAwardRow, stubVxpLedger, type LedgerStub } from './helpers/vxp';

let stub: LedgerStub | undefined;

beforeAll(async () => {
	await ensureMigrated();
});

afterEach(() => {
	stub?.restore();
	stub = undefined;
});

describe('milestone crossing math', () => {
	test('boundaries at 10 / 100 / 500 / 1000, crossings only', () => {
		expect(flowMilestonesCrossed({ prev: 9, next: 10 })).toEqual([10]);
		expect(flowMilestonesCrossed({ prev: 0, next: 1000 })).toEqual([10, 100, 500, 1000]);
		expect(flowMilestonesCrossed({ prev: 10, next: 99 })).toEqual([]);
		expect(flowMilestonesCrossed({ prev: 50, next: 40 })).toEqual([]);
		expect(flowMilestonesCrossed({ prev: 99, next: 101 })).toEqual([100]);
	});
});

describe('flow milestone trigger', () => {
	test('crossing 10 pays 50 VXP once; a replay collides', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await runFlowMilestoneTrigger({ userId, prevTotalTrades: 8, nextTotalTrades: 12 });
		await runFlowMilestoneTrigger({ userId, prevTotalTrades: 8, nextTotalTrades: 12 });

		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(50));

		const row = await readAwardRow({ userId, awardType: 'flow_milestone', awardKey: '10' });

		expect(row?.status).toBe('paid');
	});
});

describe('overtime credit', () => {
	test('mints once per day key: the second call for the same day is a no-op', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		expect(await mintFlowOvertime({ userId, dayKey: '2026-08-01' })).toBe('minted');
		expect(await mintFlowOvertime({ userId, dayKey: '2026-08-01' })).toBe('already');

		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(25));
		expect(stub.transfers[0]?.memo).toBe('vxp:flow_overtime:2026-08-01');

		// A NEW day key mints again: overtime is the one repeatable flow mint.
		expect(await mintFlowOvertime({ userId, dayKey: '2026-08-02' })).toBe('minted');
	});

	test('the rolling wall-clock cap blocks replayed day keys past the bound', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		// Seed the cap's worth of recent overtime awards; created_at (which the
		// caller cannot forge) is what the window counts.
		for (let i = 0; i < VXP_FLOW_OVERTIME_ROLLING_CAP; i++) {
			await query(
				`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms)
				 values ($1, 'flow_overtime', $2, $3, 'paid', $4)`,
				[userId, `2026-07-${String(i + 1).padStart(2, '0')}`, parseVxp(25).toString(), Date.now()]
			);
		}

		expect(await mintFlowOvertime({ userId, dayKey: '2026-08-03' })).toBe('rate_limited');
		expect(stub.transfers).toHaveLength(0);
		expect(
			await readAwardRow({ userId, awardType: 'flow_overtime', awardKey: '2026-08-03' })
		).toBeUndefined();
	});

	test('concurrent mints at the cap boundary pay exactly the one remaining slot', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();
		const racers = 4;

		for (let i = 0; i < VXP_FLOW_OVERTIME_ROLLING_CAP - 1; i++) {
			await query(
				`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms)
				 values ($1, 'flow_overtime', $2, $3, 'paid', $4)`,
				[userId, `2026-05-${String(i + 1).padStart(2, '0')}`, parseVxp(25).toString(), Date.now()]
			);
		}

		const outcomes = await Promise.all(
			Array.from(
				{ length: racers },
				async (_, i) => await mintFlowOvertime({ userId, dayKey: `2026-09-0${i + 1}` })
			)
		);

		expect(outcomes.filter((o) => o === 'minted')).toHaveLength(1);
		expect(outcomes.filter((o) => o === 'rate_limited')).toHaveLength(racers - 1);
		expect(stub.transfers).toHaveLength(1);
	});

	test('awards outside the rolling window free the cap again', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		for (let i = 0; i < VXP_FLOW_OVERTIME_ROLLING_CAP; i++) {
			await query(
				`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, created_at)
				 values ($1, 'flow_overtime', $2, $3, 'paid', $4, now() - interval '8 days')`,
				[userId, `2026-06-${String(i + 1).padStart(2, '0')}`, parseVxp(25).toString(), Date.now()]
			);
		}

		expect(await mintFlowOvertime({ userId, dayKey: '2026-08-04' })).toBe('minted');
	});
});
