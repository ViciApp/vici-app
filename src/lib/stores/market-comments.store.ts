import type { Comment } from '#lib/types/comment.ts';
import { writable } from 'svelte/store';

/**
 * Cache of `marketId → Comment[]`. Populated on demand by
 * `loadMarketComments` (in `discussion.services`) and read by
 * `MarketDiscussion`. `Map.has(marketId)` doubles as the "already loaded
 * once" flag: an empty list is still a valid cached result.
 *
 * Per-market caching (rather than a single shared list) keeps memory bounded
 * to "markets the user has actually opened" and lets us invalidate exactly
 * one entry after a comment is posted / voted on.
 *
 * Keyed by raw `string` (not `MarketId`) because `Comment.marketId` is also
 * a raw string: the discussion subsystem doesn't carry the branded type.
 */
export const marketCommentsStore = writable<Map<string, Comment[]>>(new Map());
