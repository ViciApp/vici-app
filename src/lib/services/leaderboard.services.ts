import { functions } from '#declarations/satellite/satellite.api.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { listLeaderboard as listLeaderboardWeb2 } from '#lib/web2/client.ts';
import { fromWireProfile } from '#satellite/utils/wire-format.utils.ts';

/**
 * Asks the satellite to recompute its stored global ranking, a no-op while
 * the stored one is fresh. Fire-and-forget: the reads it feeds
 * (`listLeaderboard`, `getUserRankAndCount`) answer from the ranking already
 * stored, and a later load picks up the new one. The API ranks on request,
 * so web2 mode has nothing to ask.
 */
export const requestLeaderboardRefresh = (): void => {
	if (isWeb2Backend()) {
		return;
	}

	functions.refreshLeaderboardRanking().catch((err: unknown) => {
		console.error('requestLeaderboardRefresh: the ranking refresh failed', err);
	});
};

/**
 * Fetches the top profiles of the server's global ranking (settled history,
 * never the client-written points) from the satellite-side `listLeaderboard`
 * query. Routing through the satellite (instead of a direct `listDocs`
 * against the profiles collection) keeps the cap (`LEADERBOARD_LIMIT`) and
 * the ranking authoritative server-side.
 *
 * Nicknames are returned as-is for every row the caller is allowed to
 * see; the broader "who can see whom" gate is owned by the upcoming
 * user-visibility rework.
 */
export const getLeaderboard = async (): Promise<UserProfile[]> => {
	if (isWeb2Backend()) {
		return listLeaderboardWeb2();
	}

	requestLeaderboardRefresh();

	const { items } = await functions.listLeaderboard();

	return items.map(fromWireProfile);
};
