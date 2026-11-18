import { Collection } from '#lib/constants/collections.constants.ts';
import { normalizeStoredTags } from '#lib/constants/market-taxonomy.constants.ts';
import type { MarketMetadata } from '#lib/types/market-metadata.ts';
import { listDocs } from '@junobuild/core';

/**
 * Projects every `MarketMetadata` doc down to `{ seriesId → tags }` so the
 * UI can resolve a market's tags without paying for the full metadata
 * payload (whyNow / events / suggested are not needed for tag lookup).
 *
 * `MARKET_METADATA` is `read: 'public'`, so this works for anonymous
 * viewers too. Stored tags are trimmed / de-duplicated through
 * {@link normalizeStoredTags} on the client (order-preserving, primary
 * micro first): defense in depth so a stale blank value can never leak
 * into the UI. Both micro ids and Layer-3 free tags are retained.
 */
export const listMarketTagsBySeries = async (): Promise<Record<string, string[]>> => {
	const { items } = await listDocs<MarketMetadata>({
		collection: Collection.MARKET_METADATA
	});

	return items.reduce<Record<string, string[]>>((acc, { data }) => {
		const tags = normalizeStoredTags(data.tags ?? []);

		if (tags.length > 0) {
			acc[data.seriesId] = tags;
		}

		return acc;
	}, {});
};

/**
 * Full `seriesId → MarketMetadata` projection for the same public
 * `MARKET_METADATA` collection. Powers surfaces that need the entire
 * payload (suggested-market boost, the per-card Featured chip, the
 * "Suggested for you" rail) without forcing a per-card round-trip.
 *
 * Tags on each entry are re-normalised on the client for the same
 * defense-in-depth reason as {@link listMarketTagsBySeries}.
 */
export const listMarketMetadataBySeries = async (): Promise<Record<string, MarketMetadata>> => {
	const { items } = await listDocs<MarketMetadata>({
		collection: Collection.MARKET_METADATA
	});

	return items.reduce<Record<string, MarketMetadata>>((acc, { data }) => {
		acc[data.seriesId] = {
			...data,
			tags: normalizeStoredTags(data.tags ?? [])
		};

		return acc;
	}, {});
};

/**
 * Projects an already-fetched `seriesId → MarketMetadata` map down to the
 * same `seriesId → tags` shape that {@link listMarketTagsBySeries} returns
 * but without a second `listDocs(MARKET_METADATA)` round-trip.
 *
 * `listMarketTagsBySeries` and `listMarketMetadataBySeries` scan the exact
 * same public collection, so a caller that already holds the full metadata
 * map (e.g. `prepareFlow`) can derive the tag map locally instead of paying
 * for a duplicate full-collection scan. Tags are re-normalised for the same
 * defense-in-depth reason as the two list helpers; entries with no tags are
 * omitted to match `listMarketTagsBySeries` exactly.
 */
export const deriveTagsBySeries = (
	metadataBySeries: Record<string, MarketMetadata>
): Record<string, string[]> =>
	Object.entries(metadataBySeries).reduce<Record<string, string[]>>((acc, [seriesId, meta]) => {
		const tags = normalizeStoredTags(meta.tags ?? []);

		if (tags.length > 0) {
			acc[seriesId] = tags;
		}

		return acc;
	}, {});
