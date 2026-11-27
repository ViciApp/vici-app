import {
	getMarketMetadata as getMarketMetadataApi,
	upsertMarketMetadata as upsertMarketMetadataApi
} from '#lib/api-client/client.ts';
import type { MarketMetadata, MarketMetadataInput } from '#lib/types/market-metadata.ts';

export const getMarketMetadata = async (seriesId: string): Promise<MarketMetadata | undefined> =>
	await getMarketMetadataApi(seriesId);

/**
 * The API enforces the curator gate (admin or series creator) and returns the
 * stored doc.
 */
export const upsertMarketMetadata = async ({
	seriesId,
	data
}: {
	seriesId: string;
	data: MarketMetadataInput;
}): Promise<MarketMetadata> => await upsertMarketMetadataApi({ seriesId, data });
