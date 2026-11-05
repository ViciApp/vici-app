import { Collection } from '#lib/constants/collections.constants.ts';
import type { UserRole } from '#lib/enums/user.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { isPubliclyHidden, withProfileDefaults } from '$satellite/services/profile.services';
import { isNullish } from '@dfinity/utils';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import { decodeDocData, getDocStore, listDocsStore } from '@junobuild/functions/sdk';
import type { PrincipalText } from '@junobuild/schema';

const LEADERBOARD_LIMIT = 50;

/**
 * Every non-hidden profile, sorted by `points` (XP) descending — the
 * SAME filter + sort key the public {@link listLeaderboard} uses, just
 * without the top-{@link LEADERBOARD_LIMIT} slice. The single source of
 * truth for the global ranking so {@link countNonHiddenProfilesFn} and
 * {@link getUserRankFn} agree byte-for-byte with the visible leaderboard.
 *
 * Ties on `points` are broken by `owner` ascending so a principal's rank
 * is stable across reads (without it, two equal-points rows could swap
 * order between calls and flip a user in/out of the top decile).
 */
const rankedProfiles = (): UserProfile[] => {
	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller,
		params: {}
	});

	return items
		.map(([_, item]) => decodeDocData<UserProfile>(item.data))
		.filter((profile) => !isPubliclyHidden(profile))
		.sort((a, b) => {
			const delta = (b.points ?? 0) - (a.points ?? 0);

			if (delta !== 0) {
				return delta;
			}

			return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
		});
};

/**
 * Returns the top {@link LEADERBOARD_LIMIT} profiles ranked by points (XP),
 * matching what the frontend Leaderboard surface displays.
 *
 * Nicknames/handles are returned for every profile the caller can see —
 * the broader "who can see whom" gate (visibility rework) is owned by a
 * future change and is out of scope here.
 *
 * The shape mirrors {@link UserProfile} (no extra wrapping) so the
 * frontend can render it through the same components used everywhere
 * else.
 */
export const listLeaderboard = (): UserProfile[] => {
	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller,
		params: {}
	});

	return (
		items
			.map(([_, item]) => decodeDocData<UserProfile>(item.data))
			// Soft-deleted OR hibernated accounts (Delete account v2) drop
			// off the public leaderboard before the role lookup + hydrate.
			.filter((profile) => !isPubliclyHidden(profile))
			.map((profile) => {
				const roleDoc = getDocStore({
					collection: Collection.ROLES,
					key: profile.owner,
					caller
				});

				return withProfileDefaults({
					...profile,
					role: roleDoc ? decodeDocData<{ role: UserRole }>(roleDoc.data).role : undefined
				});
			})
			.sort((a, b) => {
				const delta = (b.points ?? 0) - (a.points ?? 0);

				if (delta !== 0) {
					return delta;
				}

				return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
			})
			.slice(0, LEADERBOARD_LIMIT)
	);
};

/**
 * The caller's rival, resolved from the FULL {@link rankedProfiles}
 * ordering (not the top-{@link LEADERBOARD_LIMIT} slice {@link
 * listLeaderboard} returns), so it works for every ranked user — not
 * just those in the visible top N.
 *
 * - Usual case: the profile one rank ABOVE the caller — the next
 *   competitor to overtake.
 * - Leader (rank 1): nobody is above, so surface the runner-up one rank
 *   BELOW — the rival chasing them — with `rivalIsTrailing: true` so the
 *   FE frames the gap as a lead rather than a deficit.
 *
 * `rival` is `undefined` (→ FE locked tease) only when the caller is
 * genuinely unranked (no profile / hidden) or is the lone ranked profile
 * (rank 1 with no runner-up).
 *
 * The returned row is role-hydrated and run through
 * {@link withProfileDefaults}, matching the shape every other profile
 * query emits.
 */
export const getMyRivalFn = (): {
	rival: UserProfile | undefined;
	rivalIsTrailing: boolean;
} => {
	const caller = msgCaller();
	const callerText = caller.toText();

	const profiles = rankedProfiles();
	const myIndex = profiles.findIndex((profile) => profile.owner === callerText);

	if (myIndex === -1) {
		// Unranked (no profile / hidden) — no rival.
		return { rival: undefined, rivalIsTrailing: false };
	}

	// Rank 1 has nobody above: fall back to the runner-up one rank below
	// (the chaser). Every other rank takes the competitor one rank above.
	const rivalIsTrailing = myIndex === 0;
	const rival = profiles[rivalIsTrailing ? 1 : myIndex - 1];

	if (isNullish(rival)) {
		// Rank 1 with no runner-up (lone ranked profile) — no rival.
		return { rival: undefined, rivalIsTrailing: false };
	}

	const roleDoc = getDocStore({
		collection: Collection.ROLES,
		key: rival.owner,
		caller
	});

	return {
		rival: withProfileDefaults({
			...rival,
			role: roleDoc ? decodeDocData<{ role: UserRole }>(roleDoc.data).role : undefined
		}),
		rivalIsTrailing
	};
};

/**
 * Count of profiles that appear on the public leaderboard (non-hidden).
 * The denominator for the `top-decile` achievement: a user is in the top
 * 10% when their {@link getUserRankFn} rank is ≤ `count / 10`.
 *
 * @deprecated Prefer {@link getUserRankAndCountFn} which performs a single
 * `rankedProfiles()` pass and returns both rank and count together.
 */
export const countNonHiddenProfilesFn = (): number => rankedProfiles().length;

/**
 * 1-based rank of `principal` within the global leaderboard ordering
 * ({@link rankedProfiles}). Returns `undefined` when the principal has no
 * profile or is hidden (soft-deleted / hibernated) — callers treat that as
 * "unranked".
 *
 * @deprecated Prefer {@link getUserRankAndCountFn} which performs a single
 * `rankedProfiles()` pass and returns both rank and count together.
 */
export const getUserRankFn = ({ principal }: { principal: PrincipalText }): number | undefined => {
	const index = rankedProfiles().findIndex((profile) => profile.owner === principal);

	if (index === -1) {
		return;
	}

	return index + 1;
};

/**
 * Single-pass helper that runs {@link rankedProfiles} once and returns
 * both the 1-based rank of `principal` and the total count of ranked
 * (non-hidden) profiles.
 *
 * Use this instead of calling `countNonHiddenProfilesFn` +
 * `getUserRankFn` separately — those two each run a full scan+sort,
 * doubling the work on every `calculateAndSyncStats` invocation.
 *
 * `rank` is `undefined` when the principal has no profile or is hidden.
 */
export const getUserRankAndCountFn = ({
	principal
}: {
	principal: PrincipalText;
}): { rank: number | undefined; count: number } => {
	const profiles = rankedProfiles();
	const index = profiles.findIndex((profile) => profile.owner === principal);

	return {
		rank: index === -1 ? undefined : index + 1,
		count: profiles.length
	};
};
