// Worlds standings: the write-once monthly freeze (frozen rows never drift
// as the roster later churns), the frozen-vs-provisional month read, the
// champion history derived from frozen months, and the opt-out gate on the
// recomputed windows.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import {
	freezeMonthlySnapshots,
	getAffiliationStats,
	listAffiliationChampionships,
	listAffiliationStats,
	listAffiliationStatsForMonth,
	MIN_CALLS_FOR_RANK,
	monthAnchorFromMs
} from '../src/worlds/affiliation-stats';
import { setAffiliation } from '../src/worlds/affiliations';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const uniqueSlug = (): string => `w-${randomBytes(6).toString('hex')}`;

// Past the ranges other suites draw from (monthly-stats 2100 to 2899,
// tournaments 2300 to 2699): clearTestMonths deletes everything from here on,
// and test files run concurrently.
const FIRST_TEST_YEAR = 3000;
const FIRST_TEST_MONTH_ANCHOR = `${FIRST_TEST_YEAR}-01`;

let closedMonthsDrawn = 0;

/** A closed-month anchor in a far-future year, with `nowMs` pinned one month
 * after it so the freeze sees the month as closed. Drawn sequentially, not at
 * random: the freeze is all-or-nothing per (kind, month), so two tests sharing
 * a month would see each other's frozen rows. */
const uniqueClosedMonth = (): { monthAnchor: string; nowMs: number } => {
	const year = FIRST_TEST_YEAR + Math.floor(closedMonthsDrawn / 12);
	const month = (closedMonthsDrawn % 12) + 1;

	closedMonthsDrawn += 1;

	const monthAnchor = `${year}-${String(month).padStart(2, '0')}`;
	const nowMs = Date.UTC(year, month, 15);

	return { monthAnchor, nowMs };
};

/** Frozen months and member month rows from previous runs on the same
 * database would otherwise already own the anchors this run draws. */
const clearTestMonths = async (): Promise<void> => {
	await query(`delete from affiliation_stats where month_anchor >= $1`, [FIRST_TEST_MONTH_ANCHOR]);
	await query(`delete from user_monthly_stats where month_anchor >= $1`, [FIRST_TEST_MONTH_ANCHOR]);
};

/** A member of `slug` with a profile and a month row for the anchor. */
const seedMember = async ({
	slug,
	monthAnchor,
	monthCalls,
	monthWins,
	totalTrades = 0,
	winRate = 0,
	worldsOptIn
}: {
	slug: string;
	monthAnchor: string;
	monthCalls: number;
	monthWins: number;
	totalTrades?: number;
	winRate?: number;
	worldsOptIn?: boolean;
}): Promise<string> => {
	const userId = await createTestUser();
	const preferences = worldsOptIn === false ? { sharing: { worldsOptIn: false } } : {};

	await query(
		`insert into profiles (user_id, nickname, nickname_key, total_trades, win_rate, preferences)
		 values ($1, $2, $2, $3, $4, $5)`,
		[userId, uniqueNickname(), totalTrades, winRate, JSON.stringify(preferences)]
	);
	await query(
		`insert into user_monthly_stats (user_id, month_anchor, month_calls, month_wins, updated_at_ms)
		 values ($1, $2, $3, $4, $5)`,
		[userId, monthAnchor, monthCalls, monthWins, Date.now()]
	);
	await setAffiliation({ userId, kind: 'university', affiliationIdentifier: slug });

	return userId;
};

describe.if(dbAvailable)('monthly freeze', () => {
	beforeAll(async () => {
		await ensureMigrated();
		await clearTestMonths();
	});

	test('the first freeze captures the ranking; later freezes and roster churn cannot change it', async () => {
		const { monthAnchor, nowMs } = uniqueClosedMonth();
		const slugA = uniqueSlug();
		const slugB = uniqueSlug();

		await seedMember({ slug: slugA, monthAnchor, monthCalls: 100, monthWins: 90 });
		await seedMember({ slug: slugB, monthAnchor, monthCalls: 100, monthWins: 50 });

		const first = await freezeMonthlySnapshots({ kind: 'university', monthAnchor, nowMs });

		expect(first.alreadyFrozen).toBe(false);
		expect(first.frozen).toBe(2);

		// The roster gains a stronger member after the freeze; the frozen month
		// must not move.
		await seedMember({ slug: slugB, monthAnchor, monthCalls: 400, monthWins: 400 });

		const second = await freezeMonthlySnapshots({ kind: 'university', monthAnchor, nowMs });

		expect(second.alreadyFrozen).toBe(true);
		expect(second.frozen).toBe(0);

		const ranked = await listAffiliationStatsForMonth({ kind: 'university', monthAnchor, nowMs });
		const a = ranked.find((r) => r.affiliationIdentifier === slugA);
		const b = ranked.find((r) => r.affiliationIdentifier === slugB);

		expect(a?.monthWins).toBe(90);
		expect(b?.monthWins).toBe(50);
		expect(ranked.findIndex((r) => r.affiliationIdentifier === slugA)).toBeLessThan(
			ranked.findIndex((r) => r.affiliationIdentifier === slugB)
		);
	});

	test('a frozen row is write-once at the storage level', async () => {
		const { monthAnchor, nowMs } = uniqueClosedMonth();
		const slug = uniqueSlug();

		await seedMember({ slug, monthAnchor, monthCalls: 60, monthWins: 30 });
		await freezeMonthlySnapshots({ kind: 'university', monthAnchor, nowMs });

		// A second insert for the frozen (kind, affiliation, month) key must
		// collide instead of rewriting history.
		expect(
			query(
				`insert into affiliation_stats (kind, affiliation_identifier, month_anchor,
				   total_calls, wins, month_total_calls, month_wins, updated_at_ms)
				 values ('university', $1, $2, 999, 999, 999, 999, 0)`,
				[slug, monthAnchor]
			)
		).rejects.toThrow();
	});

	test('freezing an open month is refused; below-floor affiliations are not captured', async () => {
		const { monthAnchor, nowMs } = uniqueClosedMonth();
		const slug = uniqueSlug();

		expect(
			freezeMonthlySnapshots({
				kind: 'university',
				monthAnchor: monthAnchorFromMs(nowMs),
				nowMs
			})
		).rejects.toThrow('not yet closed');

		await seedMember({ slug, monthAnchor, monthCalls: MIN_CALLS_FOR_RANK - 1, monthWins: 10 });

		const result = await freezeMonthlySnapshots({ kind: 'university', monthAnchor, nowMs });

		expect(result.frozen).toBe(0);
	});
});

describe.if(dbAvailable)('recomputed windows and championships', () => {
	beforeAll(async () => {
		await ensureMigrated();
		await clearTestMonths();
	});

	test('lifetime window sums the roster profiles and honors the worlds opt-out', async () => {
		const { monthAnchor } = uniqueClosedMonth();
		const slug = uniqueSlug();

		await seedMember({
			slug,
			monthAnchor,
			monthCalls: 10,
			monthWins: 5,
			totalTrades: 100,
			winRate: 60
		});
		await seedMember({
			slug,
			monthAnchor,
			monthCalls: 10,
			monthWins: 5,
			totalTrades: 500,
			winRate: 90,
			worldsOptIn: false
		});

		const stats = await getAffiliationStats({ kind: 'university', affiliationIdentifier: slug });

		// Only the opted-in member's lifetime counts: 100 trades, 60 wins.
		expect(stats?.totalCalls).toBe(100);
		expect(stats?.wins).toBe(60);
	});

	test('the all-time leaderboard applies the rank floor', async () => {
		const { monthAnchor } = uniqueClosedMonth();
		const ranked = uniqueSlug();
		const unranked = uniqueSlug();

		await seedMember({
			slug: ranked,
			monthAnchor,
			monthCalls: 0,
			monthWins: 0,
			totalTrades: MIN_CALLS_FOR_RANK,
			winRate: 80
		});
		await seedMember({
			slug: unranked,
			monthAnchor,
			monthCalls: 0,
			monthWins: 0,
			totalTrades: MIN_CALLS_FOR_RANK - 1,
			winRate: 100
		});

		const board = await listAffiliationStats({ kind: 'university' });

		expect(board.some((r) => r.affiliationIdentifier === ranked)).toBe(true);
		expect(board.some((r) => r.affiliationIdentifier === unranked)).toBe(false);
	});

	test('a frozen month first place earns the champion cup', async () => {
		const { monthAnchor, nowMs } = uniqueClosedMonth();
		const winner = uniqueSlug();
		const runnerUp = uniqueSlug();

		await seedMember({ slug: winner, monthAnchor, monthCalls: 80, monthWins: 70 });
		await seedMember({ slug: runnerUp, monthAnchor, monthCalls: 80, monthWins: 40 });
		await freezeMonthlySnapshots({ kind: 'university', monthAnchor, nowMs });

		const cups = await listAffiliationChampionships({
			kind: 'university',
			affiliationIdentifier: winner
		});

		expect(cups.some((c) => c.monthAnchor === monthAnchor)).toBe(true);

		const none = await listAffiliationChampionships({
			kind: 'university',
			affiliationIdentifier: runnerUp
		});

		expect(none.some((c) => c.monthAnchor === monthAnchor)).toBe(false);
	});
});
