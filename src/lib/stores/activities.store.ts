import type { Activity } from '#lib/types/social.ts';
import { writable } from 'svelte/store';

/**
 * Cached global activity feed (latest social actions across all users).
 * Public read: populated by `LoaderGlobalActivities` and consumed by
 * `ActivityFeed` (Leaderboard "Activity" tab) and `MarketRecentTrades`
 * (market detail page). One fetch backs both surfaces.
 */
export const globalActivitiesStore = writable<Activity[] | undefined>(undefined);
