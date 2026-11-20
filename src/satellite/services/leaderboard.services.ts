import { Collection } from '#lib/constants/collections.constants.ts';
import { LEADERBOARD_QUALIFY_MIN } from '#lib/constants/standings.constants.ts';
import { MINUTE_IN_MS } from '#lib/constants/time.constants.ts';
import {
	LEADERBOARD_RANKING_KEY,
	type LeaderboardRankingDoc
} from '#lib/types/leaderboard-ranking.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { compareRankScore, type SettledRecord } from '#lib/utils/leaderboard-score.utils.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import {
	decodeStoredProfile,
	isPubliclyHidden,
	withProfileRole
} from '#satellite/services/profile.services.ts';
import { settledTotalsByPrincipal } from '#satellite/services/settled-history.services.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';
import type { PrincipalText } from '@junobuild/schema';

const LEADERBOARD_LIMIT = 50;

/** How long a stored ranking serves before a refresh recomputes it: every
 * leaderboard load asks for a refresh, and a recompute reads every profile's
 * settled history from the clearing canister. */
export const LEADERBOARD_RANKING_TTL_MS = 5 * MINUTE_IN_MS;

const rankingPurpose = 'leaderboard ranking';

/** The stored ranking with its version, or nothing before the first refresh. */
const readRanking = (): { doc: LeaderboardRankingDoc; version?: bigint } | undefined => {
	const stored = getDocStore({
		collection: Collection.LEADERBOARD_RANKING,
		key: LEADERBOARD_RANKING_KEY,
		caller: controllerCaller(rankingPurpose)
	});

	return isNullish(stored)
		? undefined
		: { doc: decodeDocData<LeaderboardRankingDoc>(stored.data), version: stored.version };
};

const isFresh = ({ computedAtMs }: LeaderboardRankingDoc): boolean =>
	timeMs() - computedAtMs < LEADERBOARD_RANKING_TTL_MS;

/** The ranked principals, best first; empty before the first refresh. */
const rankedOwners = (): PrincipalText[] => readRanking()?.doc.owners ?? [];

/**
 * Every non-hidden profile with at least {@link LEADERBOARD_QUALIFY_MIN}
 * settled calls, ordered by `compareRankScore` over its all-time settled
 * history (the clearing canister's record), then by principal so a rank is
 * stable. The client-written `points` play no part.
 */
const computeRankedOwners = async (): Promise<PrincipalText[]> => {
	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller: msgCaller(),
		params: {}
	});

	const owners = items
		.map(decodeStoredProfile)
		.filter((profile) => !isPubliclyHidden(profile))
		.map(({ owner }) => owner);

	const settled = await settledTotalsByPrincipal({
		members: owners.map((owner) => Principal.fromText(owner)),
		fromMs: 0,
		toMs: timeMs()
	});

	return owners
		.map((owner): SettledRecord & { owner: PrincipalText } => ({
			owner,
			settledCount: settled.get(owner)?.calls ?? 0,
			winCount: settled.get(owner)?.wins ?? 0
		}))
		.filter(({ settledCount }) => settledCount >= LEADERBOARD_QUALIFY_MIN)
		.sort((a, b) => {
			const byScore = compareRankScore(a, b);

			if (byScore !== 0) {
				return byScore;
			}

			return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
		})
		.map(({ owner }) => owner);
};

/**
 * Recompute the stored ranking unless the stored one is younger than
 * {@link LEADERBOARD_RANKING_TTL_MS}. Anyone can call: the app asks on every
 * leaderboard load, and the TTL keeps the clearing reads to one per window.
 * Written as a controller into the controllers-only collection.
 */
export const refreshLeaderboardRankingFn = async (): Promise<{
	refreshed: boolean;
	ranked: number;
}> => {
	const stored = readRanking();

	if (nonNullish(stored) && isFresh(stored.doc)) {
		return { refreshed: false, ranked: stored.doc.owners.length };
	}

	const owners = await computeRankedOwners();

	// Another refresh may have landed during the clearing read; nothing below
	// awaits, so this check and the write run as one step.
	const latest = readRanking();

	if (nonNullish(latest) && isFresh(latest.doc)) {
		return { refreshed: false, ranked: latest.doc.owners.length };
	}

	setDocStore({
		collection: Collection.LEADERBOARD_RANKING,
		key: LEADERBOARD_RANKING_KEY,
		caller: controllerCaller(rankingPurpose),
		doc: {
			data: encodeDocData<LeaderboardRankingDoc>({ owners, computedAtMs: timeMs() }),
			version: latest?.version
		}
	});

	return { refreshed: true, ranked: owners.length };
};

/** A ranked principal's profile as every profile query emits it, or nothing
 * when it is gone or has been hidden since the ranking was stored. */
const rankedProfile = (owner: PrincipalText): UserProfile | undefined => {
	const caller = msgCaller();
	const doc = getDocStore({ collection: Collection.PROFILES, key: owner, caller });

	if (isNullish(doc)) {
		return;
	}

	const profile = decodeStoredProfile([owner, doc]);

	return isPubliclyHidden(profile) ? undefined : withProfileRole({ profile, caller });
};

/**
 * The top {@link LEADERBOARD_LIMIT} profiles of the stored ranking, matching
 * the order the rank and rival queries read.
 *
 * The shape mirrors {@link UserProfile} (no extra wrapping) so the frontend
 * can render it through the same components used everywhere else.
 */
export const listLeaderboard = (): UserProfile[] => {
	const profiles: UserProfile[] = [];

	for (const owner of rankedOwners()) {
		if (profiles.length === LEADERBOARD_LIMIT) {
			break;
		}

		const profile = rankedProfile(owner);

		if (nonNullish(profile)) {
			profiles.push(profile);
		}
	}

	return profiles;
};

/**
 * The caller's rival, resolved from the FULL stored ranking (not the
 * top-{@link LEADERBOARD_LIMIT} slice {@link listLeaderboard} returns), so it
 * works for every ranked user.
 *
 * - Usual case: the profile one rank ABOVE the caller, the next competitor
 *   to overtake.
 * - Leader (rank 1): nobody is above, so surface the runner-up one rank
 *   BELOW, with `rivalIsTrailing: true` so the FE frames the gap as a lead
 *   rather than a deficit.
 *
 * `rival` is `undefined` (→ FE locked tease) when the caller is unranked or
 * is the lone ranked profile.
 */
export const getMyRivalFn = (): {
	rival: UserProfile | undefined;
	rivalIsTrailing: boolean;
} => {
	const owners = rankedOwners();
	const myIndex = owners.indexOf(msgCaller().toText());

	if (myIndex === -1) {
		return { rival: undefined, rivalIsTrailing: false };
	}

	const rivalIsTrailing = myIndex === 0;
	const rivalOwner = owners[rivalIsTrailing ? 1 : myIndex - 1];
	const rival = isNullish(rivalOwner) ? undefined : rankedProfile(rivalOwner);

	if (isNullish(rival)) {
		return { rival: undefined, rivalIsTrailing: false };
	}

	return { rival, rivalIsTrailing };
};

/**
 * The 1-based rank of `principal` in the stored ranking and the count of
 * ranked profiles. The count is the denominator for the `top-decile`
 * achievement and the profile's "Top X%" line.
 *
 * `rank` is `undefined` when the principal is not ranked: no profile,
 * hidden, or fewer than {@link LEADERBOARD_QUALIFY_MIN} settled calls.
 */
export const getUserRankAndCountFn = ({
	principal
}: {
	principal: PrincipalText;
}): { rank: number | undefined; count: number } => {
	const owners = rankedOwners();
	const index = owners.indexOf(principal);

	return {
		rank: index === -1 ? undefined : index + 1,
		count: owners.length
	};
};
