import type { AppLocale } from '#lib/constants/locale.constants.ts';
import type { MarketTranslation, MarketTranslationInput } from '#lib/types/market-translation.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	getMarketTranslation as getMarketTranslationWeb2,
	listMarketTranslationsForLocales as listMarketTranslationsForLocalesWeb2,
	listMarketTranslations as listMarketTranslationsWeb2,
	upsertMarketTranslation as upsertMarketTranslationWeb2
} from '#lib/web2/client.ts';
import { functions } from '$declarations/satellite/satellite.api';
import { fromWireMarketTranslation } from '$satellite/utils/wire-format.utils';

export const getMarketTranslation = async ({
	seriesId,
	locale
}: {
	seriesId: string;
	locale: AppLocale;
}): Promise<MarketTranslation | undefined> => {
	if (isWeb2Backend()) {
		return await getMarketTranslationWeb2({ seriesId, locale });
	}

	const { translation } = await functions.getMarketTranslation({ seriesId, locale });

	return translation;
};

export const listMarketTranslations = async (seriesId: string): Promise<MarketTranslation[]> => {
	// The HTTP API already speaks the app's camelCase shape; only the satellite
	// wire needs the snake_case unwrap.
	if (isWeb2Backend()) {
		return await listMarketTranslationsWeb2(seriesId);
	}

	const { items } = await functions.listMarketTranslations({ seriesId });

	return items.map(fromWireMarketTranslation);
};

/**
 * Bulk overlay read for a set of markets across a set of candidate locales
 * (the reader's fallback chain). Returns every stored translation doc whose
 * `(seriesId, locale)` is in the cartesian set; the caller resolves
 * best-per-series with `resolveMarketTranslation`. One round-trip for a whole
 * list/deck rather than one per card.
 */
export const listMarketTranslationsForLocales = async ({
	seriesIds,
	locales
}: {
	seriesIds: string[];
	locales: AppLocale[];
}): Promise<MarketTranslation[]> => {
	if (isWeb2Backend()) {
		return await listMarketTranslationsForLocalesWeb2({ seriesIds, locales });
	}

	const { items } = await functions.listMarketTranslationsForLocales({ seriesIds, locales });

	return items.map(fromWireMarketTranslation);
};

export const upsertMarketTranslation = async ({
	seriesId,
	locale,
	data
}: {
	seriesId: string;
	locale: AppLocale;
	data: MarketTranslationInput;
}): Promise<MarketTranslation> => {
	// Both transports enforce the same curator gate (admin or series creator)
	// server-side and return the stored doc.
	if (isWeb2Backend()) {
		return await upsertMarketTranslationWeb2({ seriesId, locale, data });
	}

	const { translation } = await functions.upsertMarketTranslation({ seriesId, locale, data });

	return translation;
};
