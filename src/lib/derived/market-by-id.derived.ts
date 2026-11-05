import { markets } from '#lib/derived/markets.derived.ts';
import type { Market, MarketId } from '#lib/types/market.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * `id → Market` lookup over the full markets catalog, built once per `markets`
 * change and shared by every consumer that needs to join a record to its
 * market (resolved positions, the settled inbox cards, the away digest).
 * Centralising it avoids rebuilding the same Map in each derived store on
 * unrelated ticks (locale switch, read-set update).
 */
export const marketById: Readable<Map<MarketId, Market>> = derived(
	markets,
	($markets) => new Map($markets.map((m) => [m.id, m]))
);
