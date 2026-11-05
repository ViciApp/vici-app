import type { UserProfile } from '#lib/types/profile.ts';
import { writable } from 'svelte/store';

/**
 * Top-N leaderboard ranked by points. Public read (no identity), polled
 * slowly by `LoaderLeaderboard`. Cached across navigation so revisiting the
 * Leaderboard page shows the previous ranks instantly while a refresh runs.
 */
export const leaderboardStore = writable<UserProfile[] | undefined>(undefined);
