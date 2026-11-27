import {
	TOURNAMENT_BRACKET_SIZE,
	type TournamentDoc,
	type TournamentMatchDoc,
	type TournamentRound,
	type TriggerTournamentDrawRefusalReason
} from '#lib/types/tournament.ts';
import {
	claimTournamentPrize as claimTournamentPrizeApi,
	getCurrentTournament as getCurrentTournamentApi,
	resolveTournamentRound as resolveTournamentRoundApi,
	triggerTournamentDraw as triggerTournamentDrawApi
} from '#lib/web2/client.ts';

/**
 * Monthly tournament FE wrappers.
 *
 * Pattern is the same as the Worlds podium: the API runs the draw and the
 * round resolution from its worker, and the Tournament page also fires them
 * on every mount (idempotent via the month anchor and the write-once match
 * winner). `getCurrentTournament` then drives the bracket render.
 */

/**
 * Read the current tournament + its matches. Returns `null` for
 * the tournament when none has been drawn yet; the FE should
 * render a "draw a bracket" state.
 */
export const getCurrentTournament = async (): Promise<{
	tournament: TournamentDoc | null;
	matches: TournamentMatchDoc[];
}> =>
	// The API already emits the FE doc shapes with explicit nulls for TBD
	// slots, so no wire projection applies.
	await getCurrentTournamentApi();

export interface TriggerTournamentDrawResult {
	ok: boolean;
	tournamentId?: string;
	reason?: TriggerTournamentDrawRefusalReason;
	availableLeagues?: number;
}

/**
 * Run a batched draw to the end of its bracket and return the first answer:
 * whether this call drew the month, or why not. A batched draw writes the
 * bracket a few docs per call, and every `ok` answer wrote at least one of its
 * TOURNAMENT_BRACKET_SIZE docs, so `draw` is called again until it answers
 * `already_drawn`. Any other end leaves the bracket half-written, so it throws
 * rather than report the first `ok`; the next call picks up where it stopped.
 */
export const completeTournamentDraw = async ({
	draw
}: {
	draw: () => Promise<TriggerTournamentDrawResult>;
}): Promise<TriggerTournamentDrawResult> => {
	const first = await draw();

	if (!first.ok) {
		return first;
	}

	let result = first;

	for (let calls = 1; result.ok && calls < TOURNAMENT_BRACKET_SIZE; calls++) {
		result = await draw();
	}

	if (result.reason !== 'already_drawn') {
		throw new Error(
			`Tournament draw stopped before the bracket was complete: ${result.reason ?? 'still writing'}`
		);
	}

	return first;
};

/**
 * Fire the draw for `monthAnchor` and return the first answer: whether this
 * call drew the month, or why not. Idempotent: once the bracket is complete
 * a call returns `already_drawn` cleanly. Safe to fire-and-forget on every
 * Tournament-page mount.
 */
export const triggerTournamentDraw = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<TriggerTournamentDrawResult> =>
	// The API also runs the draw from its worker; the page-mount trigger
	// covers a month the worker has not reached yet and collides
	// idempotently with it.
	await triggerTournamentDrawApi({ monthAnchor });

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
	// Also a worker job on the API; the mount-time trigger skips
	// already-settled matches server-side.
	resolveTournamentRoundApi({ tournamentId, round });

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
 * in the bracket's winning leagues; the API writes a single VXP
 * award + reports the VXP credited.
 *
 * Idempotent via the award key: a second call returns
 * `awardsAlreadyClaimed > 0` and `awardsCreated === 0`.
 *
 * The FE fires this on every Tournament-page mount once the
 * tournament's state has flipped to `concluded`.
 */
export const claimTournamentPrize = ({
	tournamentId
}: {
	tournamentId: string;
}): Promise<ClaimTournamentPrizeResult> => claimTournamentPrizeApi({ tournamentId });
