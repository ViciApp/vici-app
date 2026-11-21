// Stat caches: the user stats write guard and its route input, the monthly
// award aggregation (sharpest-eye podium, bold-caller median gate) over the
// monthly rows, and the absence of any route that lets a caller write those
// rows.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import {
	getMonthlyLeaderboard,
	median,
	MONTHLY_MIN_CALLS,
	upsertUserStats
} from '../src/profiles/stats';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, hibernateProfile, softDeleteProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

/** A unique month anchor per call so suites never share an aggregation; a
 * lingering row from a previous local run is cleared up front. */
const uniqueMonthAnchor = async (): Promise<string> => {
	const anchor = `${2100 + randomInt(0, 800)}-${String(randomInt(1, 13)).padStart(2, '0')}`;

	await query(`delete from user_monthly_stats where month_anchor = $1`, [anchor]);

	return anchor;
};

describe('median', () => {
	test('computes exact medians', () => {
		expect(median([])).toBe(0);
		expect(median([0.3])).toBe(0.3);
		expect(median([0.1, 0.5])).toBe(0.3);
		expect(median([0.9, 0.1, 0.5])).toBe(0.5);
	});
});

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
	beforeAll(async () => {
		await ensureMigrated();
	});

	const seedMonth = async ({
		monthAnchor,
		monthCalls,
		monthWins,
		monthConsensus
	}: {
		monthAnchor: string;
		monthCalls: number;
		monthWins: number;
		monthConsensus: number[];
	}): Promise<string> => {
		const { userId } = await createTestProfile();

		await query(
			`insert into user_monthly_stats (user_id, month_anchor, month_calls, month_wins, month_consensus, updated_at_ms)
			 values ($1, $2, $3, $4, $5, $6)`,
			[userId, monthAnchor, monthCalls, monthWins, JSON.stringify(monthConsensus), Date.now()]
		);

		return userId;
	};

	test('podium takes the top-3 by accuracy among eligible users', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		const gold = await seedMonth({
			monthAnchor,
			monthCalls: 40,
			monthWins: 36,
			monthConsensus: [0.6]
		});
		const silver = await seedMonth({
			monthAnchor,
			monthCalls: 40,
			monthWins: 30,
			monthConsensus: [0.6]
		});
		const bronze = await seedMonth({
			monthAnchor,
			monthCalls: 40,
			monthWins: 24,
			monthConsensus: [0.6]
		});

		// Below the eligibility gate despite perfect accuracy.
		await seedMonth({
			monthAnchor,
			monthCalls: MONTHLY_MIN_CALLS - 1,
			monthWins: MONTHLY_MIN_CALLS - 1,
			monthConsensus: [0.6]
		});

		// Fourth eligible user, off the podium.
		await seedMonth({ monthAnchor, monthCalls: 40, monthWins: 20, monthConsensus: [0.6] });

		const { sharpestEye } = await getMonthlyLeaderboard({ monthAnchor });

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([gold, silver, bronze]);
		expect(sharpestEye.map((entry) => entry.placement)).toEqual([1, 2, 3]);
		expect(sharpestEye[0]?.accuracy).toBe(90);
	});

	test('podium ties break by calls descending then user id', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		const fewerCalls = await seedMonth({
			monthAnchor,
			monthCalls: 30,
			monthWins: 27,
			monthConsensus: [0.6]
		});
		const moreCalls = await seedMonth({
			monthAnchor,
			monthCalls: 50,
			monthWins: 45,
			monthConsensus: [0.6]
		});

		const { sharpestEye } = await getMonthlyLeaderboard({ monthAnchor });

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([moreCalls, fewerCalls]);
	});

	test('bold-caller gates on the median consensus and returns ties', async () => {
		const monthAnchor = await uniqueMonthAnchor();

		// Eligible and bold (median 0.2), 80% accuracy.
		const bold = await seedMonth({
			monthAnchor,
			monthCalls: 30,
			monthWins: 24,
			monthConsensus: [0.1, 0.2, 0.3]
		});

		// Same accuracy but not bold (median 0.6): filtered out.
		await seedMonth({ monthAnchor, monthCalls: 30, monthWins: 24, monthConsensus: [0.6] });

		// Bold but lower accuracy: below the best.
		await seedMonth({ monthAnchor, monthCalls: 30, monthWins: 15, monthConsensus: [0.2] });

		// Bold, tied at the best accuracy.
		const tied = await seedMonth({
			monthAnchor,
			monthCalls: 30,
			monthWins: 24,
			monthConsensus: [0.3]
		});

		const { boldCaller } = await getMonthlyLeaderboard({ monthAnchor });
		const ids = boldCaller.map((entry) => entry.userId).sort();

		expect(ids).toEqual([bold, tied].sort());
		expect(boldCaller.every((entry) => entry.accuracy === 80)).toBe(true);
	});

	test('leaves out soft-deleted, hibernated and purged accounts', async () => {
		const monthAnchor = await uniqueMonthAnchor();
		const seedBold = async (monthWins: number): Promise<string> =>
			await seedMonth({ monthAnchor, monthCalls: 40, monthWins, monthConsensus: [0.2] });

		const active = await seedBold(20);
		const softDeleted = await seedBold(40);
		const hibernated = await seedBold(39);
		const purged = await seedBold(38);

		await softDeleteProfile(softDeleted);
		await hibernateProfile(hibernated);
		await query(`delete from profiles where user_id = $1`, [purged]);

		const { sharpestEye, boldCaller } = await getMonthlyLeaderboard({ monthAnchor });

		expect(sharpestEye.map((entry) => entry.userId)).toEqual([active]);
		expect(boldCaller.map((entry) => entry.userId)).toEqual([active]);
	});

	test('an unknown month or malformed anchor yields empty awards', async () => {
		expect(await getMonthlyLeaderboard({ monthAnchor: await uniqueMonthAnchor() })).toEqual({
			sharpestEye: [],
			boldCaller: []
		});
		expect(await getMonthlyLeaderboard({ monthAnchor: 'garbage' })).toEqual({
			sharpestEye: [],
			boldCaller: []
		});
	});
});
