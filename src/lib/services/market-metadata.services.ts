import type { MarketMetadata, MarketMetadataInput } from '#lib/types/market-metadata.ts';
import {
	getMarketMetadata as getMarketMetadataWeb2,
	upsertMarketMetadata as upsertMarketMetadataWeb2
} from '#lib/web2/client.ts';

export const getMarketMetadata = async (seriesId: string): Promise<MarketMetadata | undefined> =>
	await getMarketMetadataWeb2(seriesId);

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
}): Promise<MarketMetadata> => await upsertMarketMetadataWeb2({ seriesId, data });
