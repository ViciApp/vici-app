import { TOURNAMENT_PRIZE_TIERS, type TournamentMatchDoc } from '#lib/types/tournament.ts';
import { MONTH_ANCHOR_RE } from '#lib/utils/month-anchor.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

export type TournamentPrizePlace = (typeof TOURNAMENT_PRIZE_TIERS)[number]['place'];

export interface TournamentPodium {
	placeOneLeague: string;
	placeTwoLeague: string | null;
	/** Both semifinal losers share the bronze place. */
	semifinalLosers: string[];
}

/**
 * A league membership with the time the satellite stored it. The stamp is
 * the doc's own `created_at`, never the client-written `joinedAtMs`, so a
 * late join cannot be backdated. Leaving deletes the doc and a rejoin
 * writes a new one, so a member who left and came back carries the rejoin
 * time.
 */
export interface TournamentPrizeMembership {
	leagueId: string;
	joinedAtNs: bigint;
}

/** The podium of a tournament's matches; `undefined` until the final has a winner. */
export const tournamentPodium = (
	matches: readonly TournamentMatchDoc[]
): TournamentPodium | undefined => {
	const finalMatch = matches.find(({ round }) => round === 'final');

	if (isNullish(finalMatch) || isNullish(finalMatch.winnerLeagueId)) {
		return;
	}

	const semifinalLosers = matches
		.filter(({ round, winnerLeagueId }) => round === 'semifinal' && nonNullish(winnerLeagueId))
		.map(({ winnerLeagueId, fromLeagueId, toLeagueId }) =>
			winnerLeagueId === fromLeagueId ? toLeagueId : fromLeagueId
		)
		.filter(nonNullish);

	return {
		placeOneLeague: finalMatch.winnerLeagueId,
		placeTwoLeague:
			finalMatch.winnerLeagueId === finalMatch.fromLeagueId
				? finalMatch.toLeagueId
				: finalMatch.fromLeagueId,
		semifinalLosers
	};
};

/**
 * The place a caller's memberships earn, highest first. Only memberships
 * stored at or before the draw count: the draw seeds the bracket from that
 * roster, so joining a placed league afterwards (including once the tournament has concluded)
 * earns nothing. A member who left before claiming has no membership left
 * and earns nothing either.
 */
const tournamentPrizePlace = ({
	podium,
	memberships,
	drawnAtNs
}: {
	podium: TournamentPodium;
	memberships: readonly TournamentPrizeMembership[];
	drawnAtNs: bigint;
}): TournamentPrizePlace | undefined => {
	const leagueIds = new Set(
		memberships.filter(({ joinedAtNs }) => joinedAtNs <= drawnAtNs).map(({ leagueId }) => leagueId)
	);

	if (leagueIds.has(podium.placeOneLeague)) {
		return 1;
	}

	if (nonNullish(podium.placeTwoLeague) && leagueIds.has(podium.placeTwoLeague)) {
		return 2;
	}

	if (podium.semifinalLosers.some((id) => leagueIds.has(id))) {
		return 3;
	}
};

/**
 * Tournament ids are month anchors, and a prize is keyed on the
 * tournament id alone, so a prize key is a month anchor too.
 */
export const isTournamentPrizeAwardKey = (awardKey: string): boolean =>
	MONTH_ANCHOR_RE.test(awardKey);

/**
 * Every award key that counts as a claim of the tournament: the current
 * one and the per-place keys (`<tournamentId>_place_<n>`) claims were once
 * written under.
 */
const claimedAwardKeys = (tournamentId: string): string[] => [
	tournamentId,
	...TOURNAMENT_PRIZE_TIERS.map(({ place }) => `${tournamentId}_place_${place}`)
];

export type TournamentPrizeDecision =
	| { outcome: 'not_placed' }
	| { outcome: 'already_claimed' }
	| { outcome: 'grant'; place: TournamentPrizePlace; awardKey: string };

/**
 * Whether a caller earns a prize on a concluded tournament, and under
 * which `vxp_awards` award key. One prize per caller per tournament,
 * whatever the place: the key is the tournament id alone, so a claim for
 * another place collides with the first, and a doc under any earlier
 * per-place key blocks a new claim. Any status blocks: a `failed` doc
 * stays for diagnostics and is never re-claimed. `isHeld` says whether
 * the caller already holds an award doc under an award key.
 */
export const decideTournamentPrize = ({
	tournamentId,
	podium,
	memberships,
	drawnAtNs,
	isHeld
}: {
	tournamentId: string;
	podium: TournamentPodium;
	memberships: readonly TournamentPrizeMembership[];
	drawnAtNs: bigint;
	isHeld: (awardKey: string) => boolean;
}): TournamentPrizeDecision => {
	const place = tournamentPrizePlace({ podium, memberships, drawnAtNs });

	if (isNullish(place)) {
		return { outcome: 'not_placed' };
	}

	if (claimedAwardKeys(tournamentId).some(isHeld)) {
		return { outcome: 'already_claimed' };
	}

	return { outcome: 'grant', place, awardKey: tournamentId };
};
