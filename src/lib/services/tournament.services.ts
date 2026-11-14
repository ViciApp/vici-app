import { functions } from '#declarations/satellite/satellite.api.ts';
import type { TournamentDoc, TournamentMatchDoc, TournamentRound } from '#lib/types/tournament.ts';
import { monthAnchorFromMs } from '#lib/utils/month-anchor.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	claimTournamentPrize as claimTournamentPrizeWeb2,
	getCurrentTournament as getCurrentTournamentWeb2,
	resolveTournamentRound as resolveTournamentRoundWeb2,
	triggerTournamentDraw as triggerTournamentDrawWeb2
} from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Monthly tournament: Proposal 3 FE wrappers.
 *
 * Pattern is the same as the Worlds podium: the satellite has no
 * scheduler, so the draw is fire-and-forget on every Tournament-
 * page mount (idempotent via doc-key collision on the month anchor).
 * `getCurrentTournament` then drives the bracket render.
 */

/**
 * Project the satellite's snake_case wire schema for a tournament
 * to FE camelCase.
 */
const projectTournamentWire = (wire: {
	id: string;
	monthStartMs: number;
	monthEndMs: number;
	bracketSize: number;
	state: 'in_flight' | 'concluded';
	seededLeagueIds: string[];
	createdAtMs: number;
}): TournamentDoc => ({
	id: wire.id,
	monthStartMs: wire.monthStartMs,
	monthEndMs: wire.monthEndMs,
	bracketSize: wire.bracketSize,
	state: wire.state,
	seededLeagueIds: wire.seededLeagueIds,
	createdAtMs: wire.createdAtMs
});

/**
 * Project the satellite's snake_case wire schema for a match to FE
 * camelCase. Optional snake_case fields land as `undefined`; we
 * normalise to `null` so the FE can pattern-match on `=== null` to
 * detect "TBD" slots.
 */
const projectMatchWire = (wire: {
	tournamentId: string;
	round: TournamentRound;
	index: number;
	fromLeagueId?: string;
	toLeagueId?: string;
	fromStartCalls?: number;
	fromStartWins?: number;
	toStartCalls?: number;
	toStartWins?: number;
	fromAcc?: number;
	toAcc?: number;
	winnerLeagueId?: string;
	startMs: number;
	endMs: number;
}): TournamentMatchDoc => ({
	tournamentId: wire.tournamentId,
	round: wire.round,
	index: wire.index,
	fromLeagueId: wire.fromLeagueId ?? null,
	toLeagueId: wire.toLeagueId ?? null,
	fromStartCalls: wire.fromStartCalls ?? null,
	fromStartWins: wire.fromStartWins ?? null,
	toStartCalls: wire.toStartCalls ?? null,
	toStartWins: wire.toStartWins ?? null,
	fromAcc: wire.fromAcc ?? null,
	toAcc: wire.toAcc ?? null,
	winnerLeagueId: wire.winnerLeagueId ?? null,
	startMs: wire.startMs,
	endMs: wire.endMs
});

/**
 * Read the current tournament + its matches. Returns `null` for
 * the tournament when none has been drawn yet; the FE should
 * render a "draw a bracket" state.
 */
export const getCurrentTournament = async (): Promise<{
	tournament: TournamentDoc | null;
	matches: TournamentMatchDoc[];
}> => {
	// The HTTP API already emits the FE doc shapes with explicit nulls for
	// TBD slots, so no wire projection applies on this transport.
	if (isWeb2Backend()) {
		return await getCurrentTournamentWeb2();
	}

	const { tournament, matches } = await functions.getCurrentTournament();

	return {
		tournament: isNullish(tournament) ? null : projectTournamentWire(tournament),
		matches: matches.map(projectMatchWire)
	};
};

export interface TriggerTournamentDrawResult {
	ok: boolean;
	tournamentId?: string;
	reason?: 'already_drawn' | 'month_not_started' | 'insufficient_leagues' | 'invalid_input';
	availableLeagues?: number;
}

/**
 * Fire the draw for `monthAnchor`. Idempotent: a second call for
 * the same month returns `already_drawn` cleanly. Safe to
 * fire-and-forget on every Tournament-page mount.
 */
export const triggerTournamentDraw = ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<TriggerTournamentDrawResult> =>
	// The web2 API also runs the draw from its worker; the lazy page-mount
	// trigger stays for parity and collides idempotently with it.
	isWeb2Backend()
		? triggerTournamentDrawWeb2({ monthAnchor })
		: functions.triggerTournamentDraw({ monthAnchor });

export interface ResolveTournamentRoundResult {
	ok: boolean;
	reason?:
		| 'tournament_not_found'
		| 'round_not_yet_closed'
		| 'previous_round_not_resolved'
		| 'no_matches'
		| 'invalid_input';
	matchesResolved?: number;
	tournamentConcluded?: boolean;
}

/**
 * Resolve every match in a closed round. Idempotent via the match
 * doc's `winnerLeagueId` write-once invariant: already-resolved
 * matches are skipped. Returns the number of matches settled in
 * this call + whether the tournament has concluded.
 *
 * The FE fires this on every Tournament-page mount for each round
 * whose `endMs <= now`, walking forward through the bracket.
 */
export const resolveTournamentRound = ({
	tournamentId,
	round
}: {
	tournamentId: string;
	round: TournamentRound;
}): Promise<ResolveTournamentRoundResult> =>
	// Also a worker job on the web2 API; the mount-time trigger stays for
	// parity and skips already-settled matches server-side.
	isWeb2Backend()
		? resolveTournamentRoundWeb2({ tournamentId, round })
		: functions.resolveTournamentRound({ tournamentId, round });

export interface ClaimTournamentPrizeResult {
	ok: boolean;
	reason?: 'tournament_not_found' | 'tournament_not_concluded' | 'not_member_of_top_league';
	awardsCreated?: number;
	awardsAlreadyClaimed?: number;
	totalVxpCredited?: number;
}

/**
 * Fire the per-user prize claim for a concluded tournament. Caller
 * computes their highest-tier placement (1 / 2 / 3) by membership
 * in the bracket's winning leagues; the satellite writes a single
 * `VXP_AWARDS` doc + reports the VXP credited.
 *
 * Idempotent via the award doc key: a second call returns
 * `awardsAlreadyClaimed > 0` and `awardsCreated === 0`.
 *
 * The FE fires this on every Tournament-page mount once the
 * tournament's state has flipped to `concluded`.
 */
export const claimTournamentPrize = ({
	tournamentId
}: {
	tournamentId: string;
}): Promise<ClaimTournamentPrizeResult> =>
	isWeb2Backend()
		? claimTournamentPrizeWeb2({ tournamentId })
		: functions.claimTournamentPrize({ tournamentId });

/**
 * Convenience: the current calendar month's anchor (UTC). Used by
 * the FE to default the draw trigger to the in-progress month.
 */
export const currentMonthAnchor = (nowMs: number = Date.now()): string => monthAnchorFromMs(nowMs);
