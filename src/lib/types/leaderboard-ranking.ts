import type { PrincipalText } from '@junobuild/schema';

/** The key of the one `leaderboard_ranking` doc. */
export const LEADERBOARD_RANKING_KEY = 'global';

/**
 * The stored global ranking: every visible profile with at least
 * `LEADERBOARD_QUALIFY_MIN` settled calls, ordered by `compareRankScore` over
 * its all-time settled history, then by principal. Never the client-written
 * `points`.
 */
export interface LeaderboardRankingDoc {
	/** Ranked principals, best first. */
	owners: PrincipalText[];
	/** When the satellite computed it. */
	computedAtMs: number;
}
