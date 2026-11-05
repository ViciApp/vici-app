import { cachedListOrEmpty, cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { positionsStore } from '#lib/stores/positions.store.ts';
import type { Position } from '#lib/types/position.ts';
import type { Readable } from 'svelte/store';

export const positions: Readable<Position[]> = cachedListOrEmpty(positionsStore);

export const positionsNotInitialized: Readable<boolean> = cachedNotInitialized(positionsStore);
