import type { KeyedDoc } from '#lib/types/keyed-doc.ts';
import type { Relation } from '#lib/types/relation.ts';
import type { ResolvedResult } from '#lib/types/social.ts';
import {
	listFollowing as listFollowingApi,
	listFriendRequests as listFriendRequestsApi,
	listFriendResolvedResults as listFriendResolvedResultsApi,
	listFriends as listFriendsApi,
	listSentFriendRequests as listSentFriendRequestsApi
} from '#lib/api-client/client.ts';
import type { PrincipalText } from '@dfinity/zod-schemas';

/** Wrap a relation as the `Doc` shape the friend-request stores read, keyed by
 * the canonical unordered pair (sorted participants joined by '#'). */
const asRelationDoc = (relation: Relation): KeyedDoc<Relation> => ({
	key: [...relation.participants].sort().join('#'),
	data: relation
});

/**
 * Read-only relation queries (friends, friend requests, follows). Split out
 * from the relation *mutation* layer (`relation.services`) so consumers that
 * only need to read the social graph, notably `group.services`, depend on
 * these without pulling in the mutation layer, which in turn depends on
 * `group.services`. Keeping the reads here breaks that import cycle without
 * any runtime `import()`. These are thin API passthroughs.
 */

export const getFriends = (): Promise<Relation[]> => listFriendsApi();

export const getFriendRequests = async (): Promise<KeyedDoc<Relation>[]> =>
	(await listFriendRequestsApi()).map(asRelationDoc);

export const getSentFriendRequests = async (): Promise<KeyedDoc<Relation>[]> =>
	(await listSentFriendRequestsApi()).map(asRelationDoc);

/**
 * Friend-scoped resolved-result rows backing the Arena results digest's standout
 * line. One bounded read over the supplied friend set's resolved results within
 * the active retention window, never one call per friend. Returns an empty list
 * for an empty set so the digest can render its aggregate (W-L / net VXP)
 * without a standout.
 */
export const getFriendResolvedResults = async ({
	friends
}: {
	friends: PrincipalText[];
}): Promise<ResolvedResult[]> => {
	if (friends.length === 0) {
		return [];
	}

	return await listFriendResolvedResultsApi(friends);
};

export const getFollowing = async (): Promise<PrincipalText[]> =>
	(await listFollowingApi()).map((r) => r.participants[1]);
