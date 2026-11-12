import type { PrincipalText } from '@junobuild/schema';

/**
 * Per-user, per-month gameplay stats. One doc per `${owner}/${YYYY-MM}`
 * under the `USER_MONTHLY_STATS` collection. Drives the two monthly
 * album awards:
 *
 *  - **sharpest-eye** — the month's top-3 by accuracy among users with at
 *    least {@link MONTHLY_MIN_CALLS} resolved calls (gold / silver / bronze).
 *  - **bold-caller** — the month's best accuracy among users whose *median*
 *    consensus-at-call is below {@link BOLD_CALLER_MEDIAN_THRESHOLD} (i.e.
 *    they habitually back sides the market thinks are unlikely).
 *
 * The doc is written client-side from `calculateAndSyncStats` (which already
 * fetches the user's full clearing history): the FE re-derives the current
 * and prior calendar month's counters from settled events and persists each
 * month's doc to the caller's own row. This mirrors the proven `USER_STATS`
 * client-write + assert pattern — Juno has no scheduler, so the month
 * rollover is lazy (a new month's doc is simply written under a new
 * `${owner}/${YYYY-MM}` key on the first sync of that month) and `getMonthly
 * Leaderboard` aggregates whatever per-user docs exist for the requested
 * month. The `assertSetUserMonthlyStats` guard restricts writes to the
 * caller's own row and enforces structural sanity (`monthWins <= monthCalls`,
 * the consensus array is bounded). It does NOT verify the counters against
 * real history — same integrity trade-off as `USER_STATS`.
 */
export interface UserMonthlyStatsDoc {
	/** Owner principal — matches the first key segment. */
	owner: PrincipalText;
	/** `YYYY-MM` tag that anchors the month — matches the second key segment. */
	monthAnchor: string;
	/** Resolved calls in this month. */
	monthCalls: number;
	/** Correct calls in this month (the numerator for accuracy). */
	monthWins: number;
	/**
	 * Consensus-at-call prices (0..1) for this month's calls, bounded to
	 * {@link MONTHLY_CONSENSUS_LIMIT}. The exact median is computed on read in
	 * `getMonthlyLeaderboard` to gate the bold-caller award. Bounded so the
	 * doc payload stays tight; once the cap is reached the FE keeps the most
	 * recent values (the median of a few hundred calls is stable enough for
	 * the gate).
	 */
	monthConsensus: number[];
	/** UTC ms timestamp of the last sync. */
	updatedAtMs: number;
}

/**
 * Canonical key builder — `${owner}/${YYYY-MM}`. The prefix scan on
 * `${owner}/` naturally groups a user's months; the per-month leaderboard
 * read instead scans the whole collection and filters by the `/${anchor}`
 * suffix (a user-count-bounded scan, same shape as the affiliation-stats
 * fan-out).
 */
export const userMonthlyStatsKey = ({
	owner,
	monthAnchor
}: {
	owner: PrincipalText;
	monthAnchor: string;
}): string => `${owner}/${monthAnchor}`;

/**
 * Upper bound on the per-month consensus array. The median is robust to the
 * cap: a few hundred samples already pins it. Keeps the doc bounded so a
 * malicious or buggy writer can't bloat it (enforced by the assert).
 */
export const MONTHLY_CONSENSUS_LIMIT = 100;

/**
 * Minimum resolved calls in a month before a user is eligible for the
 * sharpest-eye podium. Below this, monthly accuracy is too noisy (a single
 * 1/1 month would otherwise top the chart). Matches the source's "≥30 calls"
 * gate for the monthly accuracy award.
 */
export const MONTHLY_MIN_CALLS = 30;

/**
 * Median consensus-at-call cutoff for the bold-caller award. A user whose
 * median backed-side consensus is strictly below this habitually takes sides
 * the market prices as unlikely. Matches the source's "median consensus
 * < 40%" gate.
 */
export const BOLD_CALLER_MEDIAN_THRESHOLD = 0.4;
