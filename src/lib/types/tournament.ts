/**
 * Monthly tournament.
 *
 * `TournamentPage` presents a single-elimination league bracket with
 * per-match accuracy. We model the structure as two collections:
 *
 *  - **`TOURNAMENTS`**: one doc per monthly tournament. Doc key is
 *    the month anchor (`YYYY-MM`) so a single draw per month is
 *    enforced by the datastore (re-running the draw collides on key).
 *  - **`TOURNAMENT_MATCHES`**: one doc per (tournament, round,
 *    match-index). Keyed `${tournamentId}/${round}/${index}` so the
 *    bracket reads as a single prefix scan.
 *
 * Rules:
 *
 *  - Entry criterion: the top `TOURNAMENT_BRACKET_SIZE` leagues by
 *    members who settled at least one call in the calendar month
 *    before the draw (an account that never plays does not lift a
 *    league). The draw scans LEAGUE_MEMBERS, counts those members per
 *    leagueId, sorts desc (leagueId asc on a tie), takes the first
 *    `TOURNAMENT_BRACKET_SIZE`.
 *  - Round windows: one `TOURNAMENT_ROUND_DURATION_DAYS` window per
 *    round (Round 1 → Final).
 *  - A match is scored from each league's members' settled history
 *    over the round window (the clearing engine's record, the source
 *    league battles are scored from), counting only members who
 *    joined by the draw. A league needs
 *    `TOURNAMENT_MIN_CALLS_PER_MATCH` settled calls in the window to
 *    qualify; a league that falls short forfeits the match.
 *  - Forfeit ⇒ opponent advances. If both forfeit, the
 *    lower-seed advances (deterministic for tie-break parity with
 *    the seed order).
 *
 * Bracket seeding follows standard single-elim where seed 1 plays
 * seed 16, seed 2 plays seed 15, etc. This produces the
 * conventional "highest seed meets lowest seed" first-round matchup.
 */

import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Standard 16-league single-elimination has four rounds, in the
 * order they appear on the bracket.
 */
export const TOURNAMENT_ROUNDS = ['r1', 'quarter', 'semifinal', 'final'] as const;

export type TournamentRound = (typeof TOURNAMENT_ROUNDS)[number];

/** Why a draw was refused: the month is already drawn, it has not started,
 * fewer leagues than a bracket exist, or the month cannot be drawn (a
 * malformed anchor, a closed month, or a month whose round 1 has closed). */
export const TOURNAMENT_DRAW_REFUSAL_REASONS = [
	'already_drawn',
	'month_not_started',
	'insufficient_leagues',
	'invalid_input'
] as const;

export type TriggerTournamentDrawRefusalReason = (typeof TOURNAMENT_DRAW_REFUSAL_REASONS)[number];

/**
 * Bracket size is fixed at 16: every tournament uses the same shape,
 * so a constant keeps the assert tight and the bracket layout
 * predictable.
 */
export const TOURNAMENT_BRACKET_SIZE = 16;

/**
 * Round duration: one 7-day window ("DAY 3 OF 7") for every round, so
 * the four rounds (28 days) fit inside any calendar month.
 */
export const TOURNAMENT_ROUND_DURATION_DAYS = 7;
export const TOURNAMENT_ROUND_DURATION_MS = TOURNAMENT_ROUND_DURATION_DAYS * DAY_IN_MS;

/**
 * Per-match qualification threshold. A league with fewer than this
 * many resolved calls in the round window forfeits the match.
 * Mirrors `MIN_CALLS_FOR_RANK` in the affiliation
 * stats: the two thresholds are deliberately separate so a
 * tournament can tighten its bar without affecting the Worlds
 * leaderboard.
 */
export const TOURNAMENT_MIN_CALLS_PER_MATCH = 50;

/**
 * Prize VXP per place, in three tiers (gold, silver, bronze). The top
 * four each get an award: both semifinal losers share the bronze tier,
 * each credited its amount independently when they call
 * `claimTournamentPrize`.
 */
export const TOURNAMENT_PRIZE_TIERS: ReadonlyArray<{
	place: 1 | 2 | 3;
	vxp: number;
}> = [
	{ place: 1, vxp: 5000 },
	{ place: 2, vxp: 2500 },
	{ place: 3, vxp: 1000 }
] as const;

/** Lifecycle state machine. */
export type TournamentState = 'in_flight' | 'concluded';

export interface TournamentDoc {
	/** Month anchor: `YYYY-MM`. Matches the doc key. */
	id: string;
	/** UTC ms timestamp of the first day of the month. */
	monthStartMs: number;
	/** UTC ms timestamp of `monthStartMs + 4 × 7 days`. */
	monthEndMs: number;
	/** Number of leagues seeded. Always {@link TOURNAMENT_BRACKET_SIZE}. */
	bracketSize: number;
	/** Lifecycle state. `in_flight` until the final match resolves; then `concluded`. */
	state: TournamentState;
	/**
	 * League ids in seed order: index 0 is the top seed (most members
	 * with a settled call in the month before the draw), index 15 is the
	 * bottom seed.
	 */
	seededLeagueIds: string[];
	/** Creation timestamp (ms). Immutable. */
	createdAtMs: number;
}

export interface TournamentMatchDoc {
	/** Parent tournament id (matches the key prefix). */
	tournamentId: string;
	/** Which round this match belongs to. */
	round: TournamentRound;
	/** Match index within the round (0..7 for r1, 0..3 for quarter, etc.). */
	index: number;
	/** The "from" / "to" league ids: `null` when the slot is TBD (winner of an upstream match). */
	fromLeagueId: string | null;
	toLeagueId: string | null;
	/**
	 * Not written: a match is scored from its leagues' members' settled
	 * history over `[startMs, endMs)`, so the draw and the resolution
	 * leave these `null`. Nothing reads them.
	 */
	fromStartCalls: number | null;
	fromStartWins: number | null;
	toStartCalls: number | null;
	toStartWins: number | null;
	/**
	 * Per-league accuracy in the round window: populated by the
	 * round-resolution endpoint as `wins / calls` over the members'
	 * settled history in the window; `null` for a forfeit.
	 */
	fromAcc: number | null;
	toAcc: number | null;
	/** Winner league id once the round resolves; `null` until then. */
	winnerLeagueId: string | null;
	/** Round window start (ms). Computed from `monthStartMs + roundIndex * 7 days`. */
	startMs: number;
	/** Round window end (ms). `startMs + 7 days`. */
	endMs: number;
}

/**
 * Canonical key builder for `tournament_matches`. The assert checks
 * that the embedded `tournamentId / round / index` agree with the
 * key: same drift-protection as `vxpAwardKey`.
 */
export const tournamentMatchKey = ({
	tournamentId,
	round,
	index
}: {
	tournamentId: string;
	round: TournamentRound;
	index: number;
}): string => `${tournamentId}/${round}/${index}`;

/**
 * UTC ms timestamp of the first day of the month containing `ms`.
 */
export const monthStartMs = (ms: number): number => {
	const d = new Date(ms);
	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);

	return d.getTime();
};

/**
 * Compute the number of matches in a round. Single-elimination
 * halves at every step: 8 → 4 → 2 → 1.
 */
export const matchCountForRound = (round: TournamentRound): number => {
	switch (round) {
		case 'r1':
			return 8;
		case 'quarter':
			return 4;
		case 'semifinal':
			return 2;
		case 'final':
			return 1;
	}
};

/**
 * Compute the round window for a tournament starting at
 * `monthStartMs`. Each round is 7 days long; the rounds run
 * back-to-back so the total tournament fits in a 28-day stretch.
 */
export const roundWindow = ({
	tournamentMonthStartMs,
	round
}: {
	tournamentMonthStartMs: number;
	round: TournamentRound;
}): { startMs: number; endMs: number } => {
	const roundIndex = TOURNAMENT_ROUNDS.indexOf(round);
	const startMs = tournamentMonthStartMs + roundIndex * TOURNAMENT_ROUND_DURATION_MS;

	return { startMs, endMs: startMs + TOURNAMENT_ROUND_DURATION_MS };
};

// Re-export `PrincipalText` so consumers don't need to import from
// `@junobuild/schema` directly.
export type { PrincipalText };
