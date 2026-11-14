import type { MarketMetadata } from '#lib/types/market-metadata.ts';
import { writable } from 'svelte/store';

/**
 * Per-market `MarketMetadata` projection: `seriesId → MarketMetadata`.
 * Populated once at app boot by `LoaderMarketMetadata` from the public
 * `MARKET_METADATA` collection (same source the tag projection reads
 * from), kept fresh via the `REFRESH_MARKET_METADATA` event.
 *
 * Consumers should read this through the `marketMetadata` derived store
 * so they get a stable empty-object fallback while the first fetch is
 * in flight. Per-market lookups (`map[seriesId]`) are O(1).
 *
 * Drives editorial-signal surfaces (suggested-market boost in
 * `rankMarkets`, the "Suggested for you" rail, the per-card Featured
 * chip) without forcing a per-card round-trip.
 */
export const marketMetadataStore = writable<Record<string, MarketMetadata> | undefined>(undefined);
