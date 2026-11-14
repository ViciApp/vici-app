import {
	DEFAULT_LOCALE,
	REGISTERED_LOCALE_IDS,
	SUPPORTED_LOCALES,
	type AppLocale
} from '#lib/constants/locale.constants.ts';
import { browser } from '$app/env';
import { nonNullish } from '@dfinity/utils';

/**
 * Resolve the locale to seed the app with on a first-time visit: before the
 * visitor has ever made an explicit choice. The device language is "caught"
 * from `navigator.languages` / `navigator.language` and matched against the
 * locales we know about, falling back to English when nothing fits.
 *
 * Matching is two-tier and walks the navigator list in priority order:
 *
 * 1. **Exact tag** (case-insensitive): a browser tag that exactly matches any
 *    registered locale wins, `live` and `soon` alike. So a `pt-BR` browser
 *    seeds `pt-BR` and an `es-MX` browser seeds `es-MX`, even though those
 *    catalogs are still `soon`: they render their language via the fallback
 *    chain while their own deltas land, which is closer to the visitor's
 *    variant than collapsing onto the base.
 * 2. **Primary subtag**: scoped to the `live` set: `pt-PT` / `pt` resolve to
 *    `pt`, and `de-DE` / `de-AT` / `de` to `de`, so a regional tag with no
 *    registered catalog maps onto its shipped base instead of dropping to
 *    English.
 *
 * This is the seed only: once a choice exists in storage it always wins, so
 * detection never overrides an explicit pick.
 */
export const detectBrowserLocale = (): AppLocale => {
	if (!browser || typeof navigator === 'undefined') {
		return DEFAULT_LOCALE;
	}

	const tags: readonly string[] =
		navigator.languages && navigator.languages.length > 0
			? navigator.languages
			: navigator.language
				? [navigator.language]
				: [];

	const liveIds = SUPPORTED_LOCALES.map(({ id }) => id);

	for (const tag of tags) {
		const exact = REGISTERED_LOCALE_IDS.find((id) => id.toLowerCase() === tag.toLowerCase());

		if (nonNullish(exact)) {
			return exact;
		}

		const primary = tag.split('-')[0].toLowerCase();
		const base = liveIds.find((id) => id.split('-')[0].toLowerCase() === primary);

		if (nonNullish(base)) {
			return base;
		}
	}

	return DEFAULT_LOCALE;
};
