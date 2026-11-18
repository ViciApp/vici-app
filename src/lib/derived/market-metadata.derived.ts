import { marketMetadataStore } from '#lib/stores/market-metadata.store.ts';
import type { MarketMetadata } from '#lib/types/market-metadata.ts';
import { derived, type Readable } from 'svelte/store';

const EMPTY_METADATA: Record<string, MarketMetadata> = {};

/**
 * Cached `seriesId → MarketMetadata` lookup. Falls back to an empty
 * object so consumers can read it without a nullish-check on every
 * render.
 */
export const marketMetadata: Readable<Record<string, MarketMetadata>> = derived(
	marketMetadataStore,
	($store) => $store ?? EMPTY_METADATA
);
