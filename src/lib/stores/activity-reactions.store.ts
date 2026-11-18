import type { ActivityReaction } from '#lib/types/social.ts';
import { writable } from 'svelte/store';

/**
 * Likes other users left on the viewer's OWN activities; the source for the like-received inbox
 * card (spec B). Populated by `LoaderReceivedReactions` via a key-prefix read scoped to the viewer's
 * principal. `undefined` until first load, which the inbox toast gate keys off so a cold-start
 * backlog of likes doesn't replay as arrival toasts.
 */
export const receivedReactionsStore = writable<ActivityReaction[] | undefined>(undefined);
