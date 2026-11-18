import { functions } from '#declarations/satellite/satellite.api.ts';
import type { MarketMetadata, MarketMetadataInput } from '#lib/types/market-metadata.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	getMarketMetadata as getMarketMetadataWeb2,
	upsertMarketMetadata as upsertMarketMetadataWeb2
} from '#lib/web2/client.ts';

export const getMarketMetadata = async (seriesId: string): Promise<MarketMetadata | undefined> => {
	if (isWeb2Backend()) {
		return await getMarketMetadataWeb2(seriesId);
	}

	const { metadata } = await functions.getMarketMetadata({ seriesId });

	return metadata;
};

export const upsertMarketMetadata = async ({
	seriesId,
	data
}: {
	seriesId: string;
	data: MarketMetadataInput;
}): Promise<MarketMetadata> => {
	// Both transports enforce the same curator gate (admin or series creator)
	// server-side and return the stored doc.
	if (isWeb2Backend()) {
		return await upsertMarketMetadataWeb2({ seriesId, data });
	}

	const { metadata } = await functions.upsertMarketMetadata({ seriesId, data });

	return metadata;
};
