// Global leaderboard: rank/count correctness on a seeded population, the
// hidden-profile exclusion, deterministic tie-breaks and the rival lookup.

import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { getMyRival, getUserRankAndCount, listLeaderboard } from '../src/profiles/leaderboard';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile, hibernateProfile, softDeleteProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

// Far above anything other suites seed, so this population owns the top of
// the shared ranking.
const BASE_POINTS = 9_000_000_000_000;

describe.if(dbAvailable)('leaderboard', () => {
	let first: string;
	let second: string;
	let third: string;
	let hiddenDeleted: string;
	let hiddenHibernated: string;

	beforeAll(async () => {
		await ensureMigrated();

		// A persistent local database can carry this suite's population from a
		// previous run; demote any lingering top rows so the absolute ranks
		// asserted below stay deterministic.
		await query(`update profiles set points = 0 where points >= $1`, [BASE_POINTS]);

		({ userId: first } = await createTestProfile({ points: BASE_POINTS + 300 }));
		({ userId: second } = await createTestProfile({ points: BASE_POINTS + 200 }));
		({ userId: third } = await createTestProfile({ points: BASE_POINTS + 100 }));

		({ userId: hiddenDeleted } = await createTestProfile({ points: BASE_POINTS + 250 }));
		await softDeleteProfile(hiddenDeleted);

		({ userId: hiddenHibernated } = await createTestProfile({ points: BASE_POINTS + 150 }));
		await hibernateProfile(hiddenHibernated);
	});

	test('orders by points descending and excludes hidden profiles', async () => {
		const items = await listLeaderboard();
		const ids = items.map((item) => item.userId);

		expect(ids.slice(0, 3)).toEqual([first, second, third]);
		expect(ids).not.toContain(hiddenDeleted);
		expect(ids).not.toContain(hiddenHibernated);
	});

	test('rank and count agree with the visible ordering', async () => {
		const rankFirst = await getUserRankAndCount({ userId: first });
		const rankSecond = await getUserRankAndCount({ userId: second });
		const rankThird = await getUserRankAndCount({ userId: third });

		expect(rankFirst.rank).toBe(1);
		expect(rankSecond.rank).toBe(2);
		expect(rankThird.rank).toBe(3);

		// One population count across the same ordering.
		expect(rankFirst.count).toBe(rankSecond.count);
		expect(rankFirst.count).toBeGreaterThanOrEqual(3);
	});

	test('a hidden profile is unranked but still counted out', async () => {
		const { rank, count } = await getUserRankAndCount({ userId: hiddenDeleted });

		expect(rank).toBeUndefined();
		expect(count).toBeGreaterThanOrEqual(3);

		// Hidden rows do not shift the ranks below them.
		expect((await getUserRankAndCount({ userId: second })).rank).toBe(2);
	});

	test('ties break by user id ascending, stable across reads', async () => {
		const { userId: tieA } = await createTestProfile({ points: BASE_POINTS + 50 });
		const { userId: tieB } = await createTestProfile({ points: BASE_POINTS + 50 });
		const sorted = [tieA, tieB].sort();
		const low = sorted[0] ?? tieA;
		const high = sorted[1] ?? tieB;

		const rankLow = await getUserRankAndCount({ userId: low });
		const rankHigh = await getUserRankAndCount({ userId: high });

		expect(rankLow.rank).toBe(4);
		expect(rankHigh.rank).toBe(5);
	});

	test('the rival is the profile one rank above', async () => {
		const { rival, rivalIsTrailing } = await getMyRival({ userId: second });

		expect(rival?.userId).toBe(first);
		expect(rivalIsTrailing).toBe(false);
	});

	test('the leader gets the runner-up as a trailing rival', async () => {
		const { rival, rivalIsTrailing } = await getMyRival({ userId: first });

		expect(rival?.userId).toBe(second);
		expect(rivalIsTrailing).toBe(true);
	});

	test('an unranked (hidden) user has no rival', async () => {
		const { rival, rivalIsTrailing } = await getMyRival({ userId: hiddenDeleted });

		expect(rival).toBeUndefined();
		expect(rivalIsTrailing).toBe(false);
	});
});
