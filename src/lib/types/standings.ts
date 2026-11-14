import type { PrincipalText } from '@junobuild/schema';

/**
 * Per-window ranked standings, derived from the clearing canister's
 * `list_leaderboard` query. The clearing layer ranks by net realized P&L
 * over a fixed calendar window; the front end maps each entry to this view
 * model and overlays handle / avatar from the satellite profile cache.
 */

/**
 * The calendar window a standings slice aggregates over. Mirrors the
 * clearing `LeaderboardWindow` variant (ISO week / UTC month / all-time).
 */
export type StandingsWindow = 'week' | 'month' | 'all';

/**
 * One principal's standing within a window: an aggregate, never a per-call
 * breakdown.
 */
export interface StandingEntry {
	/** The ranked principal (text form), matching a profile `owner`. */
	owner: PrincipalText;
	/**
	 * 1-based competition rank in the window (ties share a rank, the next
	 * distinct P&L skips the tied positions).
	 */
	rank: number;
	/**
	 * Rank in the immediately preceding window (last week / last month), or
	 * `undefined` when there is no prior window (all-time) or the principal
	 * did not appear in it. Drives the ↑/↓ delta.
	 */
	priorRank: number | undefined;
	/**
	 * Rank movement vs the prior window: positive = climbed (improved),
	 * negative = dropped, `0` = held, `undefined` = no comparable prior rank.
	 * Computed as `priorRank - rank` so a smaller (better) rank reads as a
	 * positive climb.
	 */
	rankDelta: number | undefined;
	/** Net realized P&L over the window, in internal USD base units. */
	realizedPnl: bigint;
	/** Settled positions in the window. */
	settledCount: number;
	/** Settled positions that were net positive. */
	winCount: number;
	/** `winCount / settledCount` as a 0–100 percentage, `0` when none settled. */
	accuracy: number;
}

/**
 * A resolved standings slice for one window: the ranked entries plus the full
 * ranked count (after any league `members` filter) so a caller can show
 * "rank X of total" without paging to the end.
 */
export interface StandingsResult {
	window: StandingsWindow;
	entries: StandingEntry[];
	total: number;
}
