import { cachedListOrEmpty, cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { globalActivitiesStore } from '#lib/stores/activities.store.ts';
import type { Activity } from '#lib/types/social.ts';
import type { Readable } from 'svelte/store';

export const globalActivities: Readable<Activity[]> = cachedListOrEmpty(globalActivitiesStore);

export const globalActivitiesNotInitialized: Readable<boolean> =
	cachedNotInitialized(globalActivitiesStore);
