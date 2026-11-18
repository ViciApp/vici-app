// Global leaderboard: every non-hidden profile ranked by points descending
// with the user id as the deterministic tie-break, so a user's rank is
// stable across reads. The same ordering backs the visible top slice, the
// rank/count pair and the rival lookup, so they agree row-for-row.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';
import {
	PROFILE_COLUMNS,
	PUBLICLY_VISIBLE_PROFILE_SQL,
	shapeProfile,
	type Profile,
	type ProfileRow
} from './profile';

const LEADERBOARD_LIMIT = 50;

const RANKED_FROM = `from profiles p
	 join users u on u.id = p.user_id
	 where ${PUBLICLY_VISIBLE_PROFILE_SQL}`;

const RANKED_ORDER = `order by p.points desc, p.user_id asc`;

/** The top {@link LEADERBOARD_LIMIT} profiles by points, matching what the
 * leaderboard surface displays. */
export const listLeaderboard = async (): Promise<Profile[]> => {
	const rows = await query<ProfileRow>(
		`select ${PROFILE_COLUMNS} ${RANKED_FROM} ${RANKED_ORDER} limit ${LEADERBOARD_LIMIT}`
	);

	return rows.map(shapeProfile);
};

/**
 * Single-pass rank + population count: the 1-based rank of `userId` within
 * the global ordering and the total count of ranked (non-hidden) profiles.
 * `rank` is `undefined` when the user has no profile or is hidden.
 */
export const getUserRankAndCount = async ({
	userId
}: {
	userId: string;
}): Promise<{ rank: number | undefined; count: number }> => {
	const rows = await query<{ rank: string | null; count: string }>(
		`with ranked as (
		   select p.user_id, row_number() over (${RANKED_ORDER}) as rank
		   ${RANKED_FROM}
		 )
		 select
		   (select rank from ranked where user_id = $1) as rank,
		   (select count(*) from ranked) as count`,
		[userId]
	);
	const [row] = rows;

	return {
		rank: isNullish(row?.rank) ? undefined : Number(row.rank),
		count: Number(row?.count ?? 0)
	};
};

const profileAtRank = async (rank: number): Promise<Profile | undefined> => {
	const rows = await query<ProfileRow>(
		`select ${PROFILE_COLUMNS} ${RANKED_FROM} ${RANKED_ORDER} offset ${rank - 1} limit 1`
	);
	const [row] = rows;

	return isNullish(row) ? undefined : shapeProfile(row);
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
 * `rival` is `undefined` only when the caller is genuinely unranked (no
 * profile / hidden) or is the lone ranked profile.
 */
export const getMyRival = async ({
	userId
}: {
	userId: string;
}): Promise<{ rival: Profile | undefined; rivalIsTrailing: boolean }> => {
	const { rank } = await getUserRankAndCount({ userId });

	if (isNullish(rank)) {
		return { rival: undefined, rivalIsTrailing: false };
	}

	const rivalIsTrailing = rank === 1;
	const rival = await profileAtRank(rivalIsTrailing ? 2 : rank - 1);

	if (isNullish(rival)) {
		return { rival: undefined, rivalIsTrailing: false };
	}

	return { rival, rivalIsTrailing };
};
