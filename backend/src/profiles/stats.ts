// Dashboard stats: the per-user aggregate stats cache (per-category accuracy
// + recent settlements), written by the client's stats sync, scoped to the
// caller's own row by construction and structurally validated here; and the
// monthly sharpest-eye podium, scored on read from settled history (the
// clearing canister), never from a client-written counter.

import { isNullish } from '@dfinity/utils';
import { settledTotalsByUser } from '../auth/identity';
import { query, tx } from '../db/client';
import { cached, SETTLED_STANDINGS_TTL_MS } from '../engine/cache';
import { fanoutCategoryDeltasToLeagueStats } from '../leagues/stats';
import { MONTH_ANCHOR_RE, monthWindowSoFar } from '../lib/time';
import { ProfileValidationError, PUBLICLY_VISIBLE_PROFILE_SQL } from './profile';

// user_stats

/** Recent-settlements cap: keeps the cached doc payload tight. */
export const USER_STATS_RECENT_LIMIT = 10;

export interface CategoryStatsBucket {
	calls: number;
	wins: number;
}

export interface RecentSettlementSnapshot {
	marketId: string;
	tag: string;
	win: boolean;
	settledAtMs: number;
	vxp: number;
	contrarian: boolean;
}

export interface UserStats {
	userId: string;
	categoryStats: Record<string, CategoryStatsBucket>;
	recentSettlements: RecentSettlementSnapshot[];
	computedAtMs: number;
}

interface UserStatsRow {
	user_id: string;
	category_stats: Record<string, CategoryStatsBucket>;
	recent_settlements: RecentSettlementSnapshot[];
	computed_at_ms: string;
}

const shapeUserStats = (row: UserStatsRow): UserStats => ({
	userId: row.user_id,
	categoryStats: row.category_stats,
	recentSettlements: row.recent_settlements,
	computedAtMs: Number(row.computed_at_ms)
});

/**
 * Structural guard for a user_stats write, mirroring the write-time
 * assertions: non-negative safe-integer counters with wins bounded by
 * calls, a bounded recent list, and per-settlement payloads with a finite
 * non-negative vxp and a real boolean contrarian flag.
 */
const validateUserStats = ({
	categoryStats,
	recentSettlements
}: {
	categoryStats: Record<string, CategoryStatsBucket>;
	recentSettlements: RecentSettlementSnapshot[];
}): void => {
	for (const [tag, bucket] of Object.entries(categoryStats)) {
		if (
			!Number.isSafeInteger(bucket.calls) ||
			!Number.isSafeInteger(bucket.wins) ||
			bucket.calls < 0 ||
			bucket.wins < 0
		) {
			throw new ProfileValidationError(
				`user_stats categoryStats[${tag}] counters must be non-negative safe integers (NaN / Infinity not allowed).`
			);
		}

		if (bucket.wins > bucket.calls) {
			throw new ProfileValidationError(
				`user_stats categoryStats[${tag}] wins cannot exceed calls.`
			);
		}
	}

	if (recentSettlements.length > USER_STATS_RECENT_LIMIT) {
		throw new ProfileValidationError(
			`user_stats recentSettlements length (${recentSettlements.length}) exceeds limit ${USER_STATS_RECENT_LIMIT}.`
		);
	}

	for (const settlement of recentSettlements) {
		if (
			typeof settlement.vxp !== 'number' ||
			!Number.isFinite(settlement.vxp) ||
			settlement.vxp < 0
		) {
			throw new ProfileValidationError(
				'user_stats recentSettlements vxp must be a finite non-negative number.'
			);
		}

		if (typeof settlement.contrarian !== 'boolean') {
			throw new ProfileValidationError(
				'user_stats recentSettlements contrarian must be a boolean.'
			);
		}
	}
};

export const upsertUserStats = async ({
	userId,
	categoryStats,
	recentSettlements,
	computedAtMs
}: {
	userId: string;
	categoryStats: Record<string, CategoryStatsBucket>;
	recentSettlements: RecentSettlementSnapshot[];
	computedAtMs: number;
}): Promise<UserStats> => {
	validateUserStats({ categoryStats, recentSettlements });

	return await tx(async (q) => {
		const beforeRows = await q<{ category_stats: Record<string, CategoryStatsBucket> }>(
			`select category_stats from user_stats where user_id = $1 for update`,
			[userId]
		);

		const rows = await q<UserStatsRow>(
			`insert into user_stats (user_id, category_stats, recent_settlements, computed_at_ms, updated_at)
			 values ($1, $2, $3, $4, now())
			 on conflict (user_id) do update set
			   category_stats = excluded.category_stats,
			   recent_settlements = excluded.recent_settlements,
			   computed_at_ms = excluded.computed_at_ms,
			   updated_at = now()
			 returning user_id, category_stats, recent_settlements, computed_at_ms::text`,
			[userId, JSON.stringify(categoryStats), JSON.stringify(recentSettlements), computedAtMs]
		);
		const [row] = rows;

		if (isNullish(row)) {
			throw new Error('user_stats upsert returned no row');
		}

		// The per-category league buckets ride the same transaction, sourced
		// exactly from the categoryStats deltas. A hibernated account's write
		// never moves shared league counters.
		const hibernatedRows = await q<{ hibernated: boolean }>(
			`select (hibernated_at_ms is not null) as hibernated from profiles where user_id = $1`,
			[userId]
		);

		await fanoutCategoryDeltasToLeagueStats({
			q,
			userId,
			before: beforeRows[0]?.category_stats,
			after: categoryStats,
			hibernated: hibernatedRows[0]?.hibernated ?? false
		});

		return shapeUserStats(row);
	});
};

export const getUserStats = async ({
	userId
}: {
	userId: string;
}): Promise<UserStats | undefined> => {
	const rows = await query<UserStatsRow>(
		`select user_id, category_stats, recent_settlements, computed_at_ms::text
		 from user_stats where user_id = $1`,
		[userId]
	);
	const [row] = rows;

	return isNullish(row) ? undefined : shapeUserStats(row);
};

// monthly awards

/** Minimum resolved calls in a month before a user is eligible for the
 * sharpest-eye podium; below this, monthly accuracy is too noisy. */
export const MONTHLY_MIN_CALLS = 30;

/** One sharpest-eye podium entry: placement 1 (gold) / 2 (silver) /
 * 3 (bronze), accuracy as a 0..100 percentage. */
export interface MonthlyLeaderboardEntry {
	userId: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	placement: number;
}

const accuracyOf = (doc: { monthWins: number; monthCalls: number }): number =>
	doc.monthCalls > 0 ? (doc.monthWins / doc.monthCalls) * 100 : 0;

/**
 * The sharpest-eye podium over a month so far: top-3 by settled accuracy
 * among public accounts with at least {@link MONTHLY_MIN_CALLS} settled
 * calls, ties broken by calls descending then user id ascending so the
 * placement is deterministic.
 */
const sharpestEyePodium = async ({
	fromMs,
	toMs
}: {
	fromMs: number;
	toMs: number;
}): Promise<MonthlyLeaderboardEntry[]> => {
	// A public board: only accounts the global leaderboard shows, so no
	// soft-deleted, hibernated or purged account is listed.
	const users = await query<{ user_id: string }>(
		`select p.user_id from profiles p where ${PUBLICLY_VISIBLE_PROFILE_SQL}`
	);
	const settled = await settledTotalsByUser({
		userIds: users.map((row) => row.user_id),
		fromMs,
		toMs
	});

	return [...settled]
		.map(([userId, { calls, wins }]) => ({ userId, monthCalls: calls, monthWins: wins }))
		.filter((doc) => doc.monthCalls >= MONTHLY_MIN_CALLS)
		.sort((a, b) => {
			const accDelta = accuracyOf(b) - accuracyOf(a);

			if (accDelta !== 0) {
				return accDelta;
			}

			const callsDelta = b.monthCalls - a.monthCalls;

			if (callsDelta !== 0) {
				return callsDelta;
			}

			return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
		})
		.slice(0, 3)
		.map((doc, index) => ({ ...doc, accuracy: accuracyOf(doc), placement: index + 1 }));
};

/**
 * The monthly awards for `monthAnchor`, over the month so far, shared by
 * every read of the same month for {@link SETTLED_STANDINGS_TTL_MS}.
 * `boldCaller` stays in the shape but is always empty: it is judged on the
 * consensus price at each call, which settled history does not carry.
 */
export const getMonthlyLeaderboard = async ({
	monthAnchor,
	nowMs = Date.now()
}: {
	monthAnchor: string;
	nowMs?: number;
}): Promise<{ sharpestEye: MonthlyLeaderboardEntry[]; boldCaller: [] }> => {
	const window = MONTH_ANCHOR_RE.test(monthAnchor)
		? monthWindowSoFar({ monthAnchor, nowMs })
		: undefined;

	if (isNullish(window)) {
		return { sharpestEye: [], boldCaller: [] };
	}

	const sharpestEye = await cached({
		key: `monthly-podium:${monthAnchor}:${window.closed ? 'closed' : 'open'}`,
		ttlMs: SETTLED_STANDINGS_TTL_MS,
		load: async () => await sharpestEyePodium(window)
	});

	return { sharpestEye, boldCaller: [] };
};
