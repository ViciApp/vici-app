// The award/payment side of the two claim-based prize surfaces. Eligibility
// (affiliation podium ranking, tournament bracket placement) lives with the
// leagues/worlds/tournaments domain; this module owns the amounts and the
// idempotent grant so the payout mechanics cannot drift from the rest of the
// economy.

import { nonNullish } from '@dfinity/utils';
import { query } from '../db/client';
import type { AffiliationKind } from '../worlds/affiliations';
import { hasAwardMarker } from './award-markers';
import { grantAward, type GrantAwardOutcome } from './awards';
import { parseVxp, TOURNAMENT_PRIZE_TIERS, VXP_WORLDS_PODIUM } from './constants';

export type PodiumPlace = 'gold' | 'silver' | 'bronze';

/**
 * Whether the month's place was already paid under the key that predates the
 * kind (<YYYY-MM>_<place>), when one claim paid a single award for a place
 * whichever kind finished there. That award stands for both kinds of its month
 * and place, so a month paid under it never pays the place again.
 */
const heldUnkindedPodiumAward = async ({
	userId,
	monthAnchor,
	place
}: {
	userId: string;
	monthAnchor: string;
	place: PodiumPlace;
}): Promise<boolean> => {
	const awardKey = `${monthAnchor}_${place}`;
	const rows = await query<{ one: number }>(
		`select 1 as one from vxp_awards
		 where user_id = $1 and award_type = 'worlds_podium' and award_key = $2
		 limit 1`,
		[userId, awardKey]
	);

	return (
		nonNullish(rows[0]) || (await hasAwardMarker({ userId, awardType: 'worlds_podium', awardKey }))
	);
};

/**
 * One Worlds podium award per finish: keyed <YYYY-MM>_<kind>_<place>, so a
 * member claims each closed month's university finish and country finish
 * at most once each, exactly the satellite's award-key scheme.
 */
export const grantWorldsPodiumPrize = async ({
	userId,
	monthAnchor,
	kind,
	place
}: {
	userId: string;
	monthAnchor: string;
	kind: AffiliationKind;
	place: PodiumPlace;
}): Promise<GrantAwardOutcome> => {
	if (await heldUnkindedPodiumAward({ userId, monthAnchor, place })) {
		return { outcome: 'already' };
	}

	const awardKey = `${monthAnchor}_${kind}_${place}`;

	return await grantAward({
		userId,
		awardType: 'worlds_podium',
		awardKey,
		amountBaseUnits: parseVxp(VXP_WORLDS_PODIUM[place]),
		memo: `vxp:worlds_podium:${awardKey}`
	});
};

/**
 * One tournament prize per user per tournament, whatever the place: keyed
 * <tournamentId>_place_<n>, and refused when the user already holds a prize
 * for that tournament under any place, except a live one that failed (the
 * grant reopens it and sends it again). The read covers prizes imported from
 * the legacy app, failed ones included, since the grant never reopens those;
 * between two live grants the tournament-scoped unique index (migration 0018)
 * settles the race, so two concurrent grants for different places cannot
 * both land.
 */
export const grantTournamentPrize = async ({
	userId,
	tournamentId,
	place
}: {
	userId: string;
	tournamentId: string;
	place: 1 | 2 | 3;
}): Promise<GrantAwardOutcome> => {
	// split_part matches the index expression, so the read and the index
	// agree on what "the same tournament" means.
	const held = await query<{ one: number }>(
		`select 1 as one from vxp_awards
		 where user_id = $1 and award_type = 'tournament_prize'
		   and split_part(award_key, '_place_', 1) = $2
		   and not (origin = 'live' and status = 'failed')
		 limit 1`,
		[userId, tournamentId]
	);

	if (nonNullish(held[0])) {
		return { outcome: 'already' };
	}

	const tier = TOURNAMENT_PRIZE_TIERS.find((t) => t.place === place);
	const awardKey = `${tournamentId}_place_${place}`;

	return await grantAward({
		userId,
		awardType: 'tournament_prize',
		awardKey,
		amountBaseUnits: parseVxp(tier?.vxp ?? 0),
		memo: `vxp:tournament_prize:${awardKey}`
	});
};
