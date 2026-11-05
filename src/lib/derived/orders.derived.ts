import type { ClearingDid } from '#declarations';
import { cachedListOrEmpty, cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { ordersStore } from '#lib/stores/orders.store.ts';
import type { Readable } from 'svelte/store';

export const orders: Readable<ClearingDid.LimitOrder[]> = cachedListOrEmpty(ordersStore);

export const ordersNotInitialized: Readable<boolean> = cachedNotInitialized(ordersStore);
