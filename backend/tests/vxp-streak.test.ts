// Streak award semantics: the ported milestone-crossing math, structural
// idempotency of the profile trigger, base-unit sizing, and the idempotent
// underpayment backfill.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { parseVxp } from '../src/vxp/constants';
import {
	backfillStreakUnderpayments,
	milestonesCrossed,
	runStreakAwardTrigger,
	streakBackfillLogLine,
	type StreakBackfillReport
} from '../src/vxp/streak';
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
	test('crossing a single boundary yields that milestone', () => {
		expect(milestonesCrossed({ prev: 2, next: 3 })).toEqual([3]);
		expect(milestonesCrossed({ prev: 6, next: 7 })).toEqual([7]);
		expect(milestonesCrossed({ prev: 13, next: 14 })).toEqual([14]);
		expect(milestonesCrossed({ prev: 29, next: 30 })).toEqual([30]);
	});

	test('a jump across several boundaries yields all of them in order', () => {
		expect(milestonesCrossed({ prev: 0, next: 30 })).toEqual([3, 7, 14, 30]);
		expect(milestonesCrossed({ prev: 5, next: 20 })).toEqual([7, 14]);
	});

	test('no crossing when the streak stalls, decreases, or moves between boundaries', () => {
		expect(milestonesCrossed({ prev: 3, next: 3 })).toEqual([]);
		expect(milestonesCrossed({ prev: 10, next: 4 })).toEqual([]);
		expect(milestonesCrossed({ prev: 4, next: 6 })).toEqual([]);
		expect(milestonesCrossed({ prev: 3, next: 6 })).toEqual([]);
	});

	test('landing exactly on a boundary counts; starting on one does not re-count', () => {
		expect(milestonesCrossed({ prev: 0, next: 3 })).toEqual([3]);
		expect(milestonesCrossed({ prev: 3, next: 7 })).toEqual([7]);
	});
});

describe('profile trigger', () => {
	test('a crossing pays the whole-VXP bonus in base units, once ever', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await runStreakAwardTrigger({ userId, prevDailyStreak: 0, nextDailyStreak: 3 });
		// A replayed write at the same milestone must not double-credit.
		await runStreakAwardTrigger({ userId, prevDailyStreak: 0, nextDailyStreak: 3 });

		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(50));
		expect(stub.transfers[0]?.memo).toBe('vxp:streak:streak_3');

		const row = await readAwardRow({ userId, awardType: 'streak', awardKey: 'streak_3' });

		expect(row?.status).toBe('paid');
		expect(row?.amount_base_units).toBe(parseVxp(50).toString());
	});

	test('a multi-boundary jump credits every crossed milestone', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await runStreakAwardTrigger({ userId, prevDailyStreak: 2, nextDailyStreak: 15 });

		expect(stub.transfers.map(({ amount }) => amount)).toEqual([
			parseVxp(50),
			parseVxp(150),
			parseVxp(400)
		]);
	});
});

describe('underpayment backfill', () => {
	test('dry run reports the shortfall without minting; a real run mints once', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		// A legacy import paid streak_7 as 150 base units instead of 150 VXP.
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index)
			 values ($1, 'streak', 'streak_7', '150', 'paid', 1, 1, '1')`,
			[userId]
		);

		const shortfall = parseVxp(150) - BigInt(150);

		const dry = await backfillStreakUnderpayments({ dryRun: true });

		expect(dry.underpaid).toBeGreaterThanOrEqual(1);
		expect(dry.pending).toBeGreaterThanOrEqual(1);
		expect(BigInt(dry.pendingShortfallBaseUnits)).toBeGreaterThanOrEqual(shortfall);
		expect(streakBackfillLogLine(dry)).toBeDefined();
		expect(stub.transfers).toHaveLength(0);

		const wet = await backfillStreakUnderpayments({ dryRun: false });

		expect(wet.minted).toBeGreaterThanOrEqual(1);

		const marker = await readAwardRow({
			userId,
			awardType: 'streak',
			awardKey: 'streak_7_backfill'
		});

		expect(marker?.status).toBe('paid');
		expect(marker?.amount_base_units).toBe((parseVxp(150) - BigInt(150)).toString());

		// Re-running skips what is already topped up.
		const again = await backfillStreakUnderpayments({ dryRun: false });

		expect(again.alreadyBackfilled).toBeGreaterThanOrEqual(1);
		expect(again.underpaid).toBeGreaterThanOrEqual(1);
		expect(again.pending).toBe(0);
		expect(again.pendingShortfallBaseUnits).toBe('0');
		expect(BigInt(again.totalShortfallBaseUnits)).toBeGreaterThanOrEqual(shortfall);
		// Already topped-up rows stay underpaid forever; they must not log every run.
		expect(streakBackfillLogLine(again)).toBeUndefined();
		expect(stub.transfers).toHaveLength(1);
	});

	test('a marker that failed earlier stays visible and is not minted again', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index)
			 values ($1, 'streak', 'streak_14', '400', 'paid', 1, 1, '1')`,
			[userId]
		);
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms)
			 values ($1, 'streak', 'streak_14_backfill', $2, 'failed', 1)`,
			[userId, (parseVxp(400) - BigInt(400)).toString()]
		);

		const report = await backfillStreakUnderpayments({ dryRun: false });

		expect(report.failedMarkers).toBeGreaterThanOrEqual(1);
		expect(streakBackfillLogLine(report)).toBeDefined();
		expect(stub.transfers).toHaveLength(0);
	});

	test('correctly paid awards are never touched', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index)
			 values ($1, 'streak', 'streak_3', $2, 'paid', 1, 1, '1')`,
			[userId, parseVxp(50).toString()]
		);

		await backfillStreakUnderpayments({ dryRun: false });

		expect(
			await readAwardRow({ userId, awardType: 'streak', awardKey: 'streak_3_backfill' })
		).toBeUndefined();
		expect(stub.transfers).toHaveLength(0);
	});

	describe('log line', () => {
		const baseReport: StreakBackfillReport = {
			scanned: 18,
			underpaid: 18,
			alreadyBackfilled: 18,
			minted: 0,
			failed: 0,
			pending: 0,
			failedMarkers: 0,
			totalShortfallBaseUnits: '19998000',
			pendingShortfallBaseUnits: '0'
		};

		test('is silent when every underpaid row is already backfilled', () => {
			expect(streakBackfillLogLine(baseReport)).toBeUndefined();
		});

		test('reports pending rows with their outstanding shortfall only', () => {
			expect(
				streakBackfillLogLine({
					...baseReport,
					underpaid: 19,
					pending: 1,
					minted: 1,
					pendingShortfallBaseUnits: '1110000'
				})
			).toBe(
				'streak backfill: 1 pending (1 minted, 0 failed, 0 failed earlier, shortfall 1110000)'
			);
		});

		test('reports markers that failed in an earlier run', () => {
			expect(
				streakBackfillLogLine({ ...baseReport, alreadyBackfilled: 17, failedMarkers: 1 })
			).toBe('streak backfill: 0 pending (0 minted, 0 failed, 1 failed earlier, shortfall 0)');
		});

		test('reports failed mints', () => {
			expect(
				streakBackfillLogLine({
					...baseReport,
					pending: 1,
					failed: 1,
					pendingShortfallBaseUnits: '1110000'
				})
			).toBe(
				'streak backfill: 1 pending (0 minted, 1 failed, 0 failed earlier, shortfall 1110000)'
			);
		});
	});
});
