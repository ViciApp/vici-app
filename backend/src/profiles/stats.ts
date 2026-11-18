// Dashboard stat caches: per-user aggregate stats (per-category accuracy +
// recent settlements) and per-user per-month counters driving the monthly
// album awards. Both are written by the client's stats sync, scoped to the
// caller's own row by construction, and structurally validated here.

import { isNullish } from '@dfinity/utils';
import { query, tx } from '../db/client';
import { fanoutCategoryDeltasToLeagueStats } from '../leagues/stats';
import { MONTH_ANCHOR_RE } from '../lib/time';
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

// user_monthly_stats

/** Minimum resolved calls in a month before a user is eligible for the
 * sharpest-eye podium; below this, monthly accuracy is too noisy. */
export const MONTHLY_MIN_CALLS = 30;

/** Median consensus-at-call cutoff for the bold-caller award. */
export const BOLD_CALLER_MEDIAN_THRESHOLD = 0.4;

/** Exact median of a numeric array; 0 for an empty array. */
export const median = (values: readonly number[]): number => {
	if (values.length === 0) {
		return 0;
	}

	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const upper = sorted[mid] ?? 0;

	return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + upper) / 2 : upper;
};

export interface UserMonthlyStats {
	userId: string;
	monthAnchor: string;
	monthCalls: number;
	monthWins: number;
	monthConsensus: number[];
	updatedAtMs: number;
}

interface UserMonthlyStatsRow {
	user_id: string;
	month_anchor: string;
	month_calls: number;
	month_wins: number;
	month_consensus: number[];
	updated_at_ms: string;
}

const shapeMonthlyStats = (row: UserMonthlyStatsRow): UserMonthlyStats => ({
	userId: row.user_id,
	monthAnchor: row.month_anchor,
	monthCalls: row.month_calls,
	monthWins: row.month_wins,
	monthConsensus: row.month_consensus,
	updatedAtMs: Number(row.updated_at_ms)
});

/** One sharpest-eye podium entry: placement 1 (gold) / 2 (silver) /
 * 3 (bronze), accuracy as a 0..100 percentage. */
export interface MonthlyLeaderboardEntry {
	userId: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	placement: number;
}

/** One bold-caller entry: the month's best accuracy among users whose
 * median consensus-at-call is below the threshold; ties yield more than
 * one entry. */
export interface BoldCallerEntry {
	userId: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	medianConsensus: number;
}

const accuracyOf = (doc: { monthWins: number; monthCalls: number }): number =>
	doc.monthCalls > 0 ? (doc.monthWins / doc.monthCalls) * 100 : 0;

/**
 * Aggregate every monthly-stats row for `monthAnchor` and derive the two
 * monthly awards:
 *
 * - sharpest-eye: top-3 by accuracy among users with at least
 *   {@link MONTHLY_MIN_CALLS} resolved calls, ties broken by calls
 *   descending then user id ascending so the placement is deterministic.
 * - bold-caller: the best accuracy among eligible users whose median
 *   consensus-at-call is strictly below
 *   {@link BOLD_CALLER_MEDIAN_THRESHOLD}, returning every user tied at
 *   that best accuracy.
 */
export const getMonthlyLeaderboard = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<{ sharpestEye: MonthlyLeaderboardEntry[]; boldCaller: BoldCallerEntry[] }> => {
	// Fast guard: reject a malformed anchor without scanning the table.
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		return { sharpestEye: [], boldCaller: [] };
	}

	// A public board: only accounts the global leaderboard shows, so no
	// soft-deleted, hibernated or purged account is listed.
	const rows = await query<UserMonthlyStatsRow>(
		`select s.user_id, s.month_anchor, s.month_calls, s.month_wins, s.month_consensus,
		        s.updated_at_ms::text
		 from user_monthly_stats s
		 join profiles p on p.user_id = s.user_id
		 where s.month_anchor = $1 and ${PUBLICLY_VISIBLE_PROFILE_SQL}`,
		[monthAnchor]
	);

	const docs = rows.map(shapeMonthlyStats);
	const eligible = docs.filter((doc) => doc.monthCalls >= MONTHLY_MIN_CALLS);

	const sharpestEye: MonthlyLeaderboardEntry[] = [...eligible]
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
		.map((doc, index) => ({
			userId: doc.userId,
			monthCalls: doc.monthCalls,
			monthWins: doc.monthWins,
			accuracy: accuracyOf(doc),
			placement: index + 1
		}));

	const bold = eligible
		.map((doc) => ({ doc, medianConsensus: median(doc.monthConsensus) }))
		.filter(({ medianConsensus }) => medianConsensus < BOLD_CALLER_MEDIAN_THRESHOLD);

	const bestBoldAccuracy = bold.reduce((best, { doc }) => Math.max(best, accuracyOf(doc)), -1);

	const boldCaller: BoldCallerEntry[] =
		bestBoldAccuracy < 0
			? []
			: bold
					.filter(({ doc }) => accuracyOf(doc) === bestBoldAccuracy)
					.sort((a, b) => (a.doc.userId < b.doc.userId ? -1 : a.doc.userId > b.doc.userId ? 1 : 0))
					.map(({ doc, medianConsensus }) => ({
						userId: doc.userId,
						monthCalls: doc.monthCalls,
						monthWins: doc.monthWins,
						accuracy: accuracyOf(doc),
						medianConsensus
					}));

	return { sharpestEye, boldCaller };
};
