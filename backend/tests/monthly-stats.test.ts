// Stat caches: the user stats write guard and its route input, the absence
// of any route that lets a caller write a monthly stats row, and the monthly
// sharpest-eye podium scored from settled history.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { clearCache } from '../src/engine/cache';
import { app } from '../src/index';
import { DAY_IN_MS, monthEndMs, monthStartMs } from '../src/lib/time';
import { getMonthlyLeaderboard, MONTHLY_MIN_CALLS, upsertUserStats } from '../src/profiles/stats';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, hibernateProfile, softDeleteProfile } from './helpers/profiles';
import { stubSettledHistory, type SettledHistoryStub } from './helpers/settlements';
import { dbAvailable } from './helpers/setup';

/** A unique month anchor per call so suites never share an aggregation; a
 * lingering row from a previous local run is cleared up front. */
const uniqueMonthAnchor = async (): Promise<string> => {
	const anchor = `${2100 + randomInt(0, 800)}-${String(randomInt(1, 13)).padStart(2, '0')}`;

	await query(`delete from user_monthly_stats where month_anchor = $1`, [anchor]);

	return anchor;
};

describe.if(dbAvailable)('user stats guard', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('accepts a sane doc and rejects broken counters', async () => {
		const userId = await createTestUser();

		const stats = await upsertUserStats({
			userId,
			categoryStats: { sports: { calls: 10, wins: 6 } },
			recentSettlements: [
				{
					marketId: 'srs_1',
					tag: 'sports',
					win: true,
					settledAtMs: 1,
					vxp: 12.5,
					contrarian: false
				}
			],
			computedAtMs: Date.now()
		});

		expect(stats.categoryStats.sports?.wins).toBe(6);

		expect(
			upsertUserStats({
				userId,
				categoryStats: { sports: { calls: 5, wins: 6 } },
				recentSettlements: [],
				computedAtMs: Date.now()
			})
		).rejects.toThrow('wins cannot exceed calls');

		expect(
			upsertUserStats({
				userId,
				categoryStats: {},
				recentSettlements: [
					{ marketId: 'm', tag: '', win: true, settledAtMs: 1, vxp: -1, contrarian: false }
				],
				computedAtMs: Date.now()
			})
		).rejects.toThrow('finite non-negative');
	});

	test('rejects NaN, Infinity and non-integer counters', async () => {
		const userId = await createTestUser();

		for (const calls of [Number.NaN, Number.POSITIVE_INFINITY, 2.5]) {
			expect(
				upsertUserStats({
					userId,
					categoryStats: { sports: { calls, wins: 0 } },
					recentSettlements: [],
					computedAtMs: Date.now()
				})
			).rejects.toThrow('non-negative safe integers');
		}

		expect(
			upsertUserStats({
				userId,
				categoryStats: { sports: { calls: 1, wins: Number.NaN } },
				recentSettlements: [],
				computedAtMs: Date.now()
			})
		).rejects.toThrow('non-negative safe integers');
	});

	test('bounds the recent-settlements list', async () => {
		const userId = await createTestUser();
		const snapshot = {
			marketId: 'm',
			tag: '',
			win: true,
			settledAtMs: 1,
			vxp: 0,
			contrarian: false
		};

		expect(
			upsertUserStats({
				userId,
				categoryStats: {},
				recentSettlements: Array.from({ length: 11 }, () => snapshot),
				computedAtMs: Date.now()
			})
		).rejects.toThrow('exceeds limit 10');
	});

	test('the stats route refuses a computedAtMs the bigint column cannot hold as a 400', async () => {
		const userId = await createTestUser();
		const cookie = `vici_session=${await createSession(userId)}`;

		const putStats = (computedAtMs: number): Promise<Response> =>
			app.handle(
				new Request('http://localhost/api/v1/profiles/me/stats', {
					method: 'PUT',
					headers: { cookie, 'content-type': 'application/json' },
					body: JSON.stringify({ categoryStats: {}, recentSettlements: [], computedAtMs })
				})
			);

		for (const computedAtMs of [Date.now() + 0.5, 1e300, -1]) {
			expect((await putStats(computedAtMs)).status).toBe(400);
		}

		expect(await query(`select 1 from user_stats where user_id = $1`, [userId])).toHaveLength(0);

		const computedAtMs = Date.now();
		const response = await putStats(computedAtMs);

		expect(response.status).toBe(200);
		expect(
			((await response.json()) as { stats: { computedAtMs: number } }).stats.computedAtMs
		).toBe(computedAtMs);
	});
});

describe.if(dbAvailable)('monthly stats writes', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('no route writes a caller monthly stats row', async () => {
		const userId = await createTestUser();
		const monthAnchor = await uniqueMonthAnchor();

		const response = await app.handle(
			new Request('http://localhost/api/v1/profiles/me/monthly-stats', {
				method: 'PUT',
				headers: {
					cookie: `vici_session=${await createSession(userId)}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					monthAnchor,
					monthCalls: 3_000_000_000,
					monthWins: 3_000_000_000,
					monthConsensus: [0.5],
					updatedAtMs: Date.now()
				})
			})
		);

		expect(response.status).toBe(404);
		expect(
			await query(`select 1 from user_monthly_stats where user_id = $1`, [userId])
		).toHaveLength(0);
	});
});

describe.if(dbAvailable)('monthly leaderboard', () => {
	let settled: SettledHistoryStub | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		clearCache();
		settled = stubSettledHistory();
	});

	afterEach(() => {
		settled?.restore();
		settled = undefined;
	});

	/** A public profile with `monthCalls` settled inside the month. */
	const seedMonth = async ({
		monthAnchor,
		monthCalls,
		monthWins
	}: {
		monthAnchor: string;
		monthCalls: number;
		monthWins: number;
	}): Promise<string> => {
		const { userId } = await createTestProfile();

		settled?.settle({
			userId,
			atMs: monthStartMs(monthAnchor) + DAY_IN_MS,
			calls: monthCalls,
			wins: monthWins
		});

		return userId;
	};

	const afterClose = (monthAnchor: string): number => monthEndMs(monthAnchor) + DAY_IN_MS;

	test('podium takes the top-3 by settled accuracy among eligible users', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		const gold = await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 36 });
		const silver = await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 30 });
		const bronze = await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 24 });

		// Below the eligibility gate despite perfect accuracy.
		await seedMonth({
			monthAnchor,
			monthCalls: MONTHLY_MIN_CALLS - 1,
			monthWins: MONTHLY_MIN_CALLS - 1
		});

		// Fourth eligible user, off the podium.
		await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 20 });

		// Settled the month before: outside the window.
		settled?.settle({
			userId: bronze,
			atMs: monthStartMs(monthAnchor) - DAY_IN_MS,
			calls: 40,
			wins: 40
		});

		const { sharpestEye } = await getMonthlyLeaderboard({
			monthAnchor,
			nowMs: afterClose(monthAnchor)
		});

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([gold, silver, bronze]);
		expect(sharpestEye.map((entry) => entry.placement)).toEqual([1, 2, 3]);
		expect(sharpestEye[0]?.accuracy).toBe(90);
	});

	test('podium ties break by calls descending then user id', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		const fewerCalls = await seedMonth({ monthAnchor, monthCalls: 30, monthWins: 27 });
		const moreCalls = await seedMonth({ monthAnchor, monthCalls: 50, monthWins: 45 });

		const { sharpestEye } = await getMonthlyLeaderboard({
			monthAnchor,
			nowMs: afterClose(monthAnchor)
		});

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([moreCalls, fewerCalls]);
	});

	test('the open month counts what has settled so far', async () => {
		const monthAnchor = await uniqueMonthAnchor();
		const nowMs = monthStartMs(monthAnchor) + 10 * DAY_IN_MS;
		const user = await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 30 });

		settled?.settle({ userId: user, atMs: nowMs + DAY_IN_MS, calls: 40, wins: 0 });

		const { sharpestEye } = await getMonthlyLeaderboard({ monthAnchor, nowMs });

		expect(sharpestEye.map((entry) => [entry.userId, entry.monthCalls])).toEqual([[user, 40]]);
	});

	test('bold-caller is never awarded: settled history carries no consensus at call', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 40 });

		const { boldCaller } = await getMonthlyLeaderboard({
			monthAnchor,
			nowMs: afterClose(monthAnchor)
		});

		expect(boldCaller).toEqual([]);
	});

	test('leaves out soft-deleted, hibernated and purged accounts', async () => {
		const monthAnchor = await uniqueMonthAnchor();
		const seed = async (monthWins: number): Promise<string> =>
			await seedMonth({ monthAnchor, monthCalls: 40, monthWins });

		const active = await seed(20);
		const softDeleted = await seed(40);
		const hibernated = await seed(39);
		const purged = await seed(38);

		await softDeleteProfile(softDeleted);
		await hibernateProfile(hibernated);
		await query(`delete from profiles where user_id = $1`, [purged]);

		const { sharpestEye } = await getMonthlyLeaderboard({
			monthAnchor,
			nowMs: afterClose(monthAnchor)
		});

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([active]);
	});

	test('a linked principal that does not parse is left out, not fatal', async () => {
		const monthAnchor = await uniqueMonthAnchor();
		const user = await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 30 });

		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'claim')`,
			[`not-a-principal-${randomInt(0, 1_000_000_000)}`, user]
		);

		const { sharpestEye } = await getMonthlyLeaderboard({
			monthAnchor,
			nowMs: afterClose(monthAnchor)
		});

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([user]);
	});

	test('a month not yet started or a malformed anchor yields empty awards without a read', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		expect(
			await getMonthlyLeaderboard({ monthAnchor, nowMs: monthStartMs(monthAnchor) - DAY_IN_MS })
		).toEqual({ sharpestEye: [], boldCaller: [] });
		expect(await getMonthlyLeaderboard({ monthAnchor: 'garbage' })).toEqual({
			sharpestEye: [],
			boldCaller: []
		});
		expect(settled?.reads()).toBe(0);
	});
});
