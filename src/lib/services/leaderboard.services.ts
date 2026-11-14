import { functions } from '#declarations/satellite/satellite.api.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	getMyRival as getMyRivalWeb2,
	listLeaderboard as listLeaderboardWeb2
} from '#lib/web2/client.ts';
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

/**
 * The caller's rival: the profile adjacent to them across the full points
 * ranking (not just the top-{@link getLeaderboard} slice), so the "Your
 * rival" insight resolves for every ranked user. Usually the competitor
 * one rank above; for rank 1 it's the runner-up below, flagged
 * `isTrailing` so the gap reads as a lead. `undefined` when the caller is
 * unranked or the lone ranked profile.
 *
 * The satellite returns the profile in camelCase (`j.optional(Record)`),
 * so no wire decode is needed: it's the same shape as `getProfile`.
 */
export const getMyRival = async (): Promise<
	{ profile: UserProfile; isTrailing: boolean } | undefined
> => {
	if (isWeb2Backend()) {
		return getMyRivalWeb2();
	}

	const { rival, rivalIsTrailing } = await functions.getMyRival();

	return rival ? { profile: rival as UserProfile, isTrailing: rivalIsTrailing } : undefined;
};
