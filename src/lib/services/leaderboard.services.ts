import type { UserProfile } from '#lib/types/profile.ts';
import { listLeaderboard as listLeaderboardApi } from '#lib/api-client/client.ts';

/**
 * Fetches the top profiles of the server's global ranking (settled history,
 * never the client-written points). The server keeps the cap
 * (`LEADERBOARD_LIMIT`) and the ranking authoritative.
 *
 * Nicknames are returned as-is for every row the caller is allowed to
 * see; the broader "who can see whom" gate is owned by the upcoming
 * user-visibility rework.
 */
export const getLeaderboard = (): Promise<UserProfile[]> => listLeaderboardApi();
