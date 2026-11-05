import type { Relation } from '#lib/types/relation.ts';
import type { ResolvedResult } from '#lib/types/social.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	listFollowers as listFollowersWeb2,
	listFollowing as listFollowingWeb2,
	listFriendRequests as listFriendRequestsWeb2,
	listFriendResolvedResults as listFriendResolvedResultsWeb2,
	listFriends as listFriendsWeb2,
	listSentFriendRequests as listSentFriendRequestsWeb2
} from '#lib/web2/client.ts';
import { functions } from '$declarations/satellite/satellite.api';
import type { Doc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

/** Wrap a relation as the `Doc` shape the friend-request stores read, keyed by
 * the canonical unordered pair (sorted participants joined by '#'). */
const asRelationDoc = (relation: Relation): Doc<Relation> => ({
	key: [...relation.participants].sort().join('#'),
	data: relation
});

/**
 * Read-only relation queries (friends, friend requests, follows). Split out
 * from the relation *mutation* layer (`relation.services`) so consumers that
 * only need to read the social graph — notably `group.services` — depend on
 * these without pulling in the mutation layer, which in turn depends on
 * `group.services`. Keeping the reads here breaks that import cycle without
 * any runtime `import()`. These are thin satellite passthroughs.
 */

export const getFriends = async (): Promise<Relation[]> => {
	if (isWeb2Backend()) {
		return listFriendsWeb2();
	}

	const { items } = await functions.listFriends();

	return items as Relation[];
};

export const getFriendRequests = async (): Promise<Doc<Relation>[]> => {
	if (isWeb2Backend()) {
		return (await listFriendRequestsWeb2()).map(asRelationDoc);
	}

	const { items } = await functions.listFriendRequests();

	return items.map((r) => asRelationDoc(r as Relation));
};

export const getSentFriendRequests = async (): Promise<Doc<Relation>[]> => {
	if (isWeb2Backend()) {
		return (await listSentFriendRequestsWeb2()).map(asRelationDoc);
	}

	const { items } = await functions.listSentFriendRequests();

	return items.map((r) => asRelationDoc(r as Relation));
};

/**
 * Friend-scoped resolved-result rows backing the Arena results digest's standout
 * line. One bounded satellite read over the supplied friend set's
 * `resolved_results` rows (`${owner}#${marketId}`) within the active retention
 * window — never one call per friend. Returns an empty list for an empty set so
 * the digest can render its aggregate (W–L / net VXP) without a standout.
 */
export const getFriendResolvedResults = async ({
	friends
}: {
	friends: PrincipalText[];
}): Promise<ResolvedResult[]> => {
	if (friends.length === 0) {
		return [];
	}

	if (isWeb2Backend()) {
		return listFriendResolvedResultsWeb2(friends);
	}

	const { items } = await functions.listFriendResolvedResults({ friends });

	return items;
};

export const getFollowing = async (): Promise<PrincipalText[]> => {
	if (isWeb2Backend()) {
		return (await listFollowingWeb2()).map((r) => r.participants[1]);
	}

	const { items } = await functions.listFollowing();

	return items.map((r) => r.participants[1]);
};

export const getFollowers = async (): Promise<PrincipalText[]> => {
	if (isWeb2Backend()) {
		return (await listFollowersWeb2()).map((r) => r.participants[0]);
	}

	const { items } = await functions.listFollowers();

	return items.map((r) => r.participants[0]);
};
