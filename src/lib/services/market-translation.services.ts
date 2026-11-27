import type { AppLocale } from '#lib/constants/locale.constants.ts';
import type { MarketTranslation, MarketTranslationInput } from '#lib/types/market-translation.ts';
import {
	getMarketTranslation as getMarketTranslationApi,
	listMarketTranslations as listMarketTranslationsApi,
	listMarketTranslationsForLocales as listMarketTranslationsForLocalesApi,
	upsertMarketTranslation as upsertMarketTranslationApi
} from '#lib/web2/client.ts';

export const getMarketTranslation = async ({
	seriesId,
	locale
}: {
	seriesId: string;
	locale: AppLocale;
}): Promise<MarketTranslation | undefined> => await getMarketTranslationApi({ seriesId, locale });

export const listMarketTranslations = async (seriesId: string): Promise<MarketTranslation[]> =>
	await listMarketTranslationsApi(seriesId);

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
}): Promise<MarketTranslation[]> =>
	await listMarketTranslationsForLocalesApi({ seriesIds, locales });

/**
 * The API enforces the curator gate (admin or series creator) and returns the
 * stored doc.
 */
export const upsertMarketTranslation = async ({
	seriesId,
	locale,
	data
}: {
	seriesId: string;
	locale: AppLocale;
	data: MarketTranslationInput;
}): Promise<MarketTranslation> => await upsertMarketTranslationApi({ seriesId, locale, data });
