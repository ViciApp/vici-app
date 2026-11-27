import type { PrincipalText } from '@dfinity/zod-schemas';
import { writable } from 'svelte/store';

/**
 * Principals the viewer follows. Cached so the "Friends" tab on the
 * Leaderboard (and any future follow-aware surface) renders without a
 * loading flash on navigation. Repopulated by `LoaderFollowing` whenever the
 * viewer signs in / out.
 */
export const followingStore = writable<PrincipalText[] | undefined>(undefined);
