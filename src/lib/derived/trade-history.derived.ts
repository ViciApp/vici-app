import type { ClearingDid } from '#declarations';
import { cachedListOrEmpty, cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { tradeHistoryStore } from '#lib/stores/trade-history.store.ts';
import type { Readable } from 'svelte/store';

export const tradeHistory: Readable<ClearingDid.Event[]> = cachedListOrEmpty(tradeHistoryStore);

export const tradeHistoryNotInitialized: Readable<boolean> =
	cachedNotInitialized(tradeHistoryStore);
