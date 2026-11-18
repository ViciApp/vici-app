import { routeMarketId } from '#lib/derived/nav.derived.ts';
import type { MarketId } from '#lib/types/market.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import { nonNullish } from '@dfinity/utils';
import { derived, type Readable } from 'svelte/store';

export const pageMarketId: Readable<MarketId | undefined> = derived(
	[routeMarketId],
	([$routeMarketId]) => (nonNullish($routeMarketId) ? parseMarketId($routeMarketId) : undefined)
);
