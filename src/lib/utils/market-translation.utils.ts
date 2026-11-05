import {
	DEFAULT_LOCALE,
	localeFallbackChain,
	SUPPORTED_LOCALES,
	type AppLocale
} from '#lib/constants/locale.constants.ts';
import type { MarketTranslation } from '#lib/types/market-translation.ts';
import { nonNullish, notEmptyString } from '@dfinity/utils';

const supportedLocaleIds = new Set<string>(SUPPORTED_LOCALES.map(({ id }) => id));

/**
 * Pick the translation to show a reader on a given locale, walking the
 * locale's fallback chain (itself → registered fallbacks → `en`) and taking
 * the first entry that is both a `live` (`SUPPORTED_LOCALES`) locale and has a
 * stored translation.
 *
 * `DEFAULT_LOCALE` (`en`) is treated as the original-authoring language, never
 * a translation: a reader whose chain resolves only to `en` is already seeing
 * the source text, so there is nothing to toggle and the result is `undefined`.
 */
export const resolveMarketTranslation = ({
	translations,
	locale
}: {
	translations: readonly MarketTranslation[];
	locale: AppLocale;
}): { translation: MarketTranslation; locale: AppLocale } | undefined => {
	const byLocale = new Map(translations.map((entry) => [entry.locale, entry]));

	for (const candidate of localeFallbackChain(locale)) {
		if (candidate !== DEFAULT_LOCALE && supportedLocaleIds.has(candidate)) {
			const translation = byLocale.get(candidate);

			if (translation) {
				return { translation, locale: candidate };
			}
		}
	}
};

/**
 * Native label of a translation's language (e.g. `Español`), for the
 * "View in {language}" control. Falls back to the bare locale id if it's
 * somehow not in the live set. Shared by the detail page and the card/deck
 * quick toggle so the label resolution lives in one place.
 */
export const translatedLanguageLabel = (locale: string): string =>
	SUPPORTED_LOCALES.find(({ id }) => id === locale)?.label ?? locale;

export interface MarketDisplayOriginal {
	title: string;
	description: string;
	resolution: string;
	outcomes?: { id: string; title: string }[];
}

export interface MarketDisplayText {
	title: string;
	description: string;
	resolution: string;
	/** Translated outcome title for `id`, falling back to the original. */
	outcomeTitle: (id: string) => string;
}

/**
 * Single place that decides which text a market surface renders, so the eight
 * display surfaces never scatter ad-hoc `translation?.title ?? market.title`
 * fallbacks. Each field is the translated value when showing translated and a
 * non-blank translation exists, otherwise the on-chain original — translations
 * are user-authored, so a stray empty field can never blank out a title.
 *
 * `showOriginal` is the per-item toggle state (seeded from the global
 * preference); when `translation` is `undefined` there is nothing to show but
 * the original regardless.
 */
export const marketDisplayText = ({
	market,
	translation,
	showOriginal
}: {
	market: MarketDisplayOriginal;
	translation: MarketTranslation | undefined;
	showOriginal: boolean;
}): MarketDisplayText => {
	const showTranslated = !showOriginal && nonNullish(translation);

	const pick = ({
		translated,
		original
	}: {
		translated: string | undefined;
		original: string;
	}): string =>
		showTranslated && nonNullish(translated) && notEmptyString(translated.trim())
			? translated
			: original;

	const translatedOutcomeById = new Map(
		(translation?.outcomes ?? []).map((entry) => [entry.id, entry.title])
	);

	return {
		title: pick({ translated: translation?.title, original: market.title }),
		description: pick({ translated: translation?.description, original: market.description }),
		resolution: pick({ translated: translation?.resolution, original: market.resolution }),
		outcomeTitle: (id: string): string => {
			const original = market.outcomes?.find((entry) => entry.id === id)?.title ?? '';

			return pick({ translated: translatedOutcomeById.get(id), original });
		}
	};
};
