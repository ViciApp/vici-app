import { functions } from '#declarations/satellite/satellite.api.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { listLeaderboard as listLeaderboardWeb2 } from '#lib/web2/client.ts';
import { fromWireProfile } from '#satellite/utils/wire-format.utils.ts';

/**
 * Fetches the top profiles ranked by points (XP) from the satellite-side
 * `listLeaderboard` query. Routing through the satellite (instead of a
 * direct `listDocs` against the profiles collection) keeps the cap
 * (`LEADERBOARD_LIMIT`) and the ranking authoritative server-side.
 *
 * Nicknames are returned as-is for every row the caller is allowed to
 * see; the broader "who can see whom" gate is owned by the upcoming
 * user-visibility rework.
 *
 * Points are probability-weighted and enhanced by streaks; the actual
 * sort happens satellite-side too so client and server agree on rank.
 */
export const getLeaderboard = async (): Promise<UserProfile[]> => {
	if (isWeb2Backend()) {
		return listLeaderboardWeb2();
	}

	const { items } = await functions.listLeaderboard();

	return items.map(fromWireProfile);
};
