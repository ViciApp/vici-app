import { getUserStats as getUserStatsApi } from '#lib/api-client/client.ts';
import type { UserStatsDoc } from '#lib/types/user-stats.ts';

/**
 * FE service for the per-user dashboard cache: category win/loss buckets and
 * the most recent settlements. The API computes it from settled history, so
 * Dash and the profile rail read it in one request.
 *
 * Slight refresh delay (per the design decision): the Dash reads whatever
 * the server last computed; a market resolving moments before mount won't
 * show up until the next computation. Acceptable trade-off for instant page
 * loads.
 */

/**
 * Load the caller's dashboard cache. Returns `undefined` when no
 * snapshot exists yet: the FE renders a "pull-to-refresh" hint in
 * that branch.
 */
export const loadMyUserStats = (): Promise<UserStatsDoc | undefined> => getUserStatsApi();
