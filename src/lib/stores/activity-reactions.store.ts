import type { ActivityReaction } from '#lib/types/social.ts';
import { writable } from 'svelte/store';

/**
 * Count-on-read reaction docs for the friend feed — the most-recent page across all users,
 * populated by `LoaderGlobalActivities`. Consumers derive per-activity counts **and** the viewer's
 * own likes from this raw list, keeping the viewer reactive (`$authPrincipal`) so persisted likes
 * highlight as soon as auth resolves rather than only after a manual refresh. `undefined`
 * distinguishes "not yet loaded" from "loaded but no reactions".
 */
export const activityReactionsStore = writable<ActivityReaction[] | undefined>(undefined);

/**
 * Per-activity like counts (`Map<activityKey, count>`) from the server-maintained
 * `activity_reaction_counts` rollup, populated by `LoaderGlobalActivities`. Replaces the former
 * count-on-read tally over {@link activityReactionsStore} — the feed reads the count in O(1) per
 * activity. `undefined` until first load.
 */
export const activityReactionCountsStore = writable<Map<string, number> | undefined>(undefined);

/**
 * Likes other users left on the viewer's OWN activities — the source for the like-received inbox
 * card (spec B). Populated by `LoaderReceivedReactions` via a key-prefix read scoped to the viewer's
 * principal. `undefined` until first load, which the inbox toast gate keys off so a cold-start
 * backlog of likes doesn't replay as arrival toasts.
 */
export const receivedReactionsStore = writable<ActivityReaction[] | undefined>(undefined);
