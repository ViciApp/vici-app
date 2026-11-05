import { cachedListOrEmpty, cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { marketsStore } from '#lib/stores/markets.store.ts';
import type { Market } from '#lib/types/market.ts';
import type { Readable } from 'svelte/store';

export const markets: Readable<Market[]> = cachedListOrEmpty(marketsStore);

export const marketsNotInitialized: Readable<boolean> = cachedNotInitialized(marketsStore);
