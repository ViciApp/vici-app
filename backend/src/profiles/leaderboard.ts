// Global leaderboard: every non-hidden profile with enough settled calls,
// ranked by the confidence-adjusted score of its all-time settled history,
// read from the clearing canister like every accuracy-judged surface, never
// the client-written `points` (the profile's display copy). The parameters
// are the app's visible board's, so the same order backs the visible top
// slice, the rank/count pair and the rival lookup, and they agree
// row-for-row.

import { isNullish, nonNullish } from '@dfinity/utils';
import { parsedPrincipal, settlementPrincipalsByUser } from '../auth/identity';
import { query } from '../db/client';
import { cached, PUBLIC_READ_TTL_MS } from '../engine/cache';
import { settledTotalsByPrincipal } from '../engine/clearing';
import {
	PROFILE_COLUMNS,
	PUBLICLY_VISIBLE_PROFILE_SQL,
	shapeProfile,
	type Profile,
	type ProfileRow
} from './profile';

const LEADERBOARD_LIMIT = 50;

/** Settled calls a profile needs to be ranked at all; below it the app shows
 * the predictor as provisional. */
export const LEADERBOARD_QUALIFY_MIN = 10;

/** The accuracy a thin record shrinks toward, as a 0 to 1 fraction. */
export const LEADERBOARD_PRIOR_MEAN = 0.5;

/** The prior's strength, in virtual calls. */
export const LEADERBOARD_PRIOR_WEIGHT = 20;

const RANKED_FROM = `from profiles p
	 join users u on u.id = p.user_id
	 where ${PUBLICLY_VISIBLE_PROFILE_SQL}`;

interface RankedUser {
	userId: string;
	calls: number;
	score: number;
}

/** A settled record's win rate blended with the prior, weighted by its size,
 * so a short lucky run cannot top a long proven one. */
const leaderboardScore = ({ calls, wins }: { calls: number; wins: number }): number =>
	(LEADERBOARD_PRIOR_MEAN * LEADERBOARD_PRIOR_WEIGHT + wins) / (LEADERBOARD_PRIOR_WEIGHT + calls);

/** Score desc, then more settled calls (more proof), then the user id, so a
 * user's rank is stable across reads. */
const byScore = (a: RankedUser, b: RankedUser): number => {
	if (a.score !== b.score) {
		return b.score - a.score;
	}

	if (a.calls !== b.calls) {
		return b.calls - a.calls;
	}

	return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
};

const loadRankedUserIds = async (): Promise<string[]> => {
	const rows = await query<{ user_id: string }>(`select p.user_id ${RANKED_FROM}`);
	const principalsByUser = await settlementPrincipalsByUser(rows.map(({ user_id }) => user_id));
	const settled = await settledTotalsByPrincipal({
		members: [...principalsByUser.values()].flat().map(parsedPrincipal).filter(nonNullish),
		fromMs: 0,
		toMs: Date.now()
	});

	return [...principalsByUser]
		.map(([userId, principals]): RankedUser => {
			let calls = 0;
			let wins = 0;

			for (const text of principals) {
				calls += settled.get(text)?.calls ?? 0;
				wins += settled.get(text)?.wins ?? 0;
			}

			return { userId, calls, score: leaderboardScore({ calls, wins }) };
		})
		.filter(({ calls }) => calls >= LEADERBOARD_QUALIFY_MIN)
		.sort(byScore)
		.map(({ userId }) => userId);
};

/** The ranked user ids, best first. One roster-wide clearing read serves
 * every leaderboard request inside the public read window. */
const rankedUserIds = (): Promise<string[]> =>
	cached({ key: 'leaderboard:ranked', ttlMs: PUBLIC_READ_TTL_MS, load: loadRankedUserIds });

const profilesOf = async (userIds: string[]): Promise<Profile[]> => {
	if (userIds.length === 0) {
		return [];
	}

	const rows = await query<ProfileRow>(
		`select ${PROFILE_COLUMNS} ${RANKED_FROM} and p.user_id = any($1::uuid[])`,
		[userIds]
	);
	const byUser = new Map(rows.map((row) => [row.user_id, shapeProfile(row)]));

	return userIds.map((userId) => byUser.get(userId)).filter(nonNullish);
};

/** The top {@link LEADERBOARD_LIMIT} ranked profiles, matching what the
 * leaderboard surface displays. */
export const listLeaderboard = async (): Promise<Profile[]> =>
	await profilesOf((await rankedUserIds()).slice(0, LEADERBOARD_LIMIT));

/**
 * The 1-based rank of `userId` within the global ordering and the count of
 * ranked profiles. `rank` is `undefined` when the user has no profile, is
 * hidden, or has fewer than {@link LEADERBOARD_QUALIFY_MIN} settled calls.
 */
export const getUserRankAndCount = async ({
	userId
}: {
	userId: string;
}): Promise<{ rank: number | undefined; count: number }> => {
	const ranked = await rankedUserIds();
	const index = ranked.indexOf(userId);

	return { rank: index === -1 ? undefined : index + 1, count: ranked.length };
};

/**
 * The caller's rival, resolved from the FULL ranking (not the visible top
 * slice), so it works for every ranked user:
 *
 * - Usual case: the profile one rank ABOVE the caller, the next competitor
 *   to overtake.
 * - Leader (rank 1): nobody is above, so surface the runner-up one rank
 *   BELOW with `rivalIsTrailing: true` so the client frames the gap as a
 *   lead rather than a deficit.
 *
 * `rival` is `undefined` only when the caller is unranked or is the lone
 * ranked profile.
 */
export const getMyRival = async ({
	userId
}: {
	userId: string;
}): Promise<{ rival: Profile | undefined; rivalIsTrailing: boolean }> => {
	const ranked = await rankedUserIds();
	const index = ranked.indexOf(userId);

	if (index === -1) {
		return { rival: undefined, rivalIsTrailing: false };
	}

	const rivalIsTrailing = index === 0;
	const rivalId = ranked[rivalIsTrailing ? 1 : index - 1];
	const [rival] = isNullish(rivalId) ? [] : await profilesOf([rivalId]);

	if (isNullish(rival)) {
		return { rival: undefined, rivalIsTrailing: false };
	}

	return { rival, rivalIsTrailing };
};
