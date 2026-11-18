// The award/payment side of the two claim-based prize surfaces. Eligibility
// (affiliation podium ranking, tournament bracket placement) lives with the
// leagues/worlds/tournaments domain; this module owns the amounts and the
// idempotent grant so the payout mechanics cannot drift from the rest of the
// economy.

import { nonNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { grantAward, type GrantAwardOutcome } from './awards';
import { parseVxp, TOURNAMENT_PRIZE_TIERS, VXP_WORLDS_PODIUM } from './constants';

export type PodiumPlace = 'gold' | 'silver' | 'bronze';

/**
 * One Worlds podium award: keyed <YYYY-MM>_<place> so a member claims each
 * closed month's finish at most once, exactly the satellite's award-key
 * scheme.
 */
export const grantWorldsPodiumPrize = ({
	userId,
	monthAnchor,
	place
}: {
	userId: string;
	monthAnchor: string;
	place: PodiumPlace;
}): Promise<GrantAwardOutcome> => {
	const awardKey = `${monthAnchor}_${place}`;

	return grantAward({
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
 * for that tournament under any place. The read covers prizes imported from
 * the legacy app; between two live grants the tournament-scoped unique index
 * (migration 0018) settles the race, so two concurrent grants for different
 * places cannot both land.
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
