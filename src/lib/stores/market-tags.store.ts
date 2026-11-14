import { writable } from 'svelte/store';

/**
 * Per-market tag projections: `seriesId → string[]` (0..N stored tags per
 * market: micro ids first, then Layer-3 free tags). Tags live on
 * `MarketMetadata` (collection `MARKET_METADATA`) but most consumers
 * (FlowMode, MarketsPage, PortfolioPage, signals) only need the lookup and
 * never the rest of the metadata payload, so we project once into this
 * cached lookup at app boot. The taxonomy layers (micros / macros / free
 * tags) are derived on read via `#lib/constants/market-taxonomy.constants.ts`.
 *
 * Public read (no identity, no balance domain). Populated by
 * `LoaderMarketTags` and reused across every surface that previously
 * relied on `categoriesStore` / the deleted `series_categories`
 * collection.
 */
export const marketTagsStore = writable<Record<string, string[]> | undefined>(undefined);
