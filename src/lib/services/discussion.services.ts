import { Collection } from '#lib/constants/collections.constants.ts';
import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
import { marketCommentsStore } from '#lib/stores/market-comments.store.ts';
import type { Comment } from '#lib/types/comment.ts';
import { getDoc, listDocs, setDoc } from '@junobuild/core';

export const getMarketComments = async (marketId: string): Promise<Comment[]> => {
	const { items } = await listDocs<Comment>({
		collection: Collection.COMMENTS
	});

	return items
		.map(({ key, data }) => ({ ...data, key }))
		.filter((c) => c.marketId === marketId)
		.sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * Cache-aware comment loader. Fetches comments for `marketId`, writes them
 * into `marketCommentsStore`, and hydrates the shared `profilesStore` with
 * the comment authors so the UI can render names/avatars without a second
 * fetch loop. Consumers (`MarketDiscussion`) call this on mount and after
 * every mutation. `Map.has(marketId)` on `marketCommentsStore` doubles as
 * the "loaded at least once" flag for the cold-load spinner.
 */
export const loadMarketComments = async ({ marketId }: { marketId: string }): Promise<void> => {
	const comments = await getMarketComments(marketId);

	marketCommentsStore.update((current) => {
		const next = new Map(current);
		next.set(marketId, comments);

		return next;
	});

	await loadProfilesByPrincipals({ principals: comments.map((c) => c.user) });
};

export const addComment = async (
	comment: Omit<Comment, 'timestamp' | 'key' | 'upvotes' | 'downvotes'>
): Promise<void> => {
	const timestamp = Date.now();

	const key = `${comment.marketId}#${timestamp}#${comment.user.slice(0, 5)}`;

	await setDoc({
		collection: Collection.COMMENTS,
		doc: {
			key,
			data: {
				...comment,
				timestamp,
				upvotes: [],
				downvotes: []
			}
		}
	});
};

export const upvoteComment = async ({
	commentKey,
	userPrincipal
}: {
	commentKey: string;
	userPrincipal: string;
}): Promise<void> => {
	const doc = await getDoc<Comment>({
		collection: Collection.COMMENTS,
		key: commentKey
	});

	if (!doc) {
		return;
	}

	const { data } = doc;
	const currentUpvotes = data.upvotes ?? [];
	const currentDownvotes = data.downvotes ?? [];
	const hasUpvoted = currentUpvotes.includes(userPrincipal);

	const upvotes = hasUpvoted
		? currentUpvotes.filter((u) => u !== userPrincipal)
		: [...currentUpvotes, userPrincipal];
	const downvotes = hasUpvoted
		? currentDownvotes
		: currentDownvotes.filter((u) => u !== userPrincipal);

	await setDoc({
		collection: Collection.COMMENTS,
		doc: {
			...doc,
			data: {
				...data,
				upvotes,
				downvotes
			}
		}
	});
};

export const downvoteComment = async ({
	commentKey,
	userPrincipal
}: {
	commentKey: string;
	userPrincipal: string;
}): Promise<void> => {
	const doc = await getDoc<Comment>({
		collection: Collection.COMMENTS,
		key: commentKey
	});

	if (!doc) {
		return;
	}

	const { data } = doc;
	const currentUpvotes = data.upvotes ?? [];
	const currentDownvotes = data.downvotes ?? [];
	const hasDownvoted = currentDownvotes.includes(userPrincipal);

	const downvotes = hasDownvoted
		? currentDownvotes.filter((u) => u !== userPrincipal)
		: [...currentDownvotes, userPrincipal];
	const upvotes = hasDownvoted ? currentUpvotes : currentUpvotes.filter((u) => u !== userPrincipal);

	await setDoc({
		collection: Collection.COMMENTS,
		doc: {
			...doc,
			data: {
				...data,
				upvotes,
				downvotes
			}
		}
	});
};
