// Global leaderboard: ranked from each profile's all-time settled history
// (qualify gate, then the confidence-adjusted score the visible board uses),
// never the client-written points; rank/count correctness on a seeded
// population, the hidden-profile exclusion and deterministic tie-breaks.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { clearCache } from '../src/engine/cache';
import {
	getUserRankAndCount,
	LEADERBOARD_QUALIFY_MIN,
	listLeaderboard
} from '../src/profiles/leaderboard';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile, hibernateProfile, softDeleteProfile } from './helpers/profiles';
import { stubSettledHistory, type SettledHistoryStub } from './helpers/settlements';
import { dbAvailable } from './helpers/setup';

// Well past anything a client could reach on the points it writes, so a
// ranking that read points would put this profile first.
const HUGE_POINTS = 900_000_000;

describe.if(dbAvailable)('leaderboard', () => {
	let settled: SettledHistoryStub | undefined;
	let first: string;
	let second: string;
	let third: string;
	let pointsOnly: string;
	let belowGate: string;
	let hiddenDeleted: string;
	let hiddenHibernated: string;

	/** A profile with `calls` settled calls, `wins` of them won, and the given points. */
	const rankedProfile = async ({
		calls,
		wins,
		points = 0
	}: {
		calls: number;
		wins: number;
		points?: number;
	}): Promise<string> => {
		const { userId } = await createTestProfile({ points });

		settled?.settle({ userId, atMs: Date.UTC(2026, 0, 1), calls, wins });

		return userId;
	};

	beforeAll(async () => {
		await ensureMigrated();

		// Only this suite's profiles have settled history in the stub, so they
		// are the whole ranked population whatever other suites seed.
		settled = stubSettledHistory();

		first = await rankedProfile({ calls: 200, wins: 190 });
		second = await rankedProfile({ calls: 50, wins: 45 });
		// 10/11 is a higher raw rate than 45/50 but a thinner record: the
		// confidence-adjusted score ranks it below.
		third = await rankedProfile({ calls: 11, wins: 10, points: HUGE_POINTS });

		pointsOnly = (await createTestProfile({ points: HUGE_POINTS })).userId;
		belowGate = await rankedProfile({
			calls: LEADERBOARD_QUALIFY_MIN - 1,
			wins: LEADERBOARD_QUALIFY_MIN - 1,
			points: HUGE_POINTS
		});

		hiddenDeleted = await rankedProfile({ calls: 100, wins: 99 });
		await softDeleteProfile(hiddenDeleted);

		hiddenHibernated = await rankedProfile({ calls: 100, wins: 98 });
		await hibernateProfile(hiddenHibernated);
	});

	beforeEach(() => {
		clearCache();
	});

	afterAll(() => {
		settled?.restore();
		clearCache();
	});

	test('orders by settled history, ignores points and excludes hidden profiles', async () => {
		const ids = (await listLeaderboard()).map((item) => item.userId);

		expect(ids).toEqual([first, second, third]);
	});

	test('rank and count agree with the visible ordering', async () => {
		expect(await getUserRankAndCount({ userId: first })).toEqual({ rank: 1, count: 3 });
		expect(await getUserRankAndCount({ userId: second })).toEqual({ rank: 2, count: 3 });
		expect(await getUserRankAndCount({ userId: third })).toEqual({ rank: 3, count: 3 });
	});

	test('points alone, or settled calls below the qualify gate, leave a profile unranked', async () => {
		expect(await getUserRankAndCount({ userId: pointsOnly })).toEqual({
			rank: undefined,
			count: 3
		});
		expect(await getUserRankAndCount({ userId: belowGate })).toEqual({
			rank: undefined,
			count: 3
		});
	});

	test('a hidden profile is unranked and does not shift the ranks below it', async () => {
		expect((await getUserRankAndCount({ userId: hiddenDeleted })).rank).toBeUndefined();
		expect((await getUserRankAndCount({ userId: hiddenHibernated })).rank).toBeUndefined();
		expect((await getUserRankAndCount({ userId: second })).rank).toBe(2);
	});

	test('equal scores break by settled calls, then by user id ascending', async () => {
		// Against a weight-20 prior at 0.5, 30 wins in 40 calls and 10 in 10
		// both score exactly 2/3.
		const moreCalls = await rankedProfile({ calls: 40, wins: 30 });
		const fewerCalls = await rankedProfile({ calls: 10, wins: 10 });
		const twinA = await rankedProfile({ calls: 12, wins: 6 });
		const twinB = await rankedProfile({ calls: 12, wins: 6 });
		const [low, high] = [twinA, twinB].sort();

		const ids = (await listLeaderboard()).map((item) => item.userId);

		expect(ids.indexOf(moreCalls) + 1).toBe(ids.indexOf(fewerCalls));
		expect(ids.slice(-2)).toEqual([low ?? twinA, high ?? twinB]);
	});
});
