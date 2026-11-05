import type { AppLocale } from '#lib/constants/locale.constants.ts';
import type { WorldsAffiliationOption } from '#lib/constants/worlds-affiliations.constants.ts';
import type { AffiliationKind } from '#lib/types/affiliation.ts';

/**
 * Locale-aware display names for Worlds affiliations.
 *
 * Country roster ids are ISO-3166 alpha-2 codes, so country names resolve
 * through `Intl.DisplayNames` — every registered locale (including the
 * `soon` tier) gets native-language country names without a per-country
 * catalog entry to keep aligned across catalogs. University names are
 * proper nouns and render as-is.
 *
 * FE-only on purpose: the satellite shares the roster constants, and its
 * runtime must not be assumed to ship `Intl.DisplayNames` — keep this
 * module out of `src/satellite/**` imports.
 */

// One `Intl.DisplayNames` per locale — construction is the expensive part,
// `of()` is cheap. `null` marks a locale whose construction failed (engine
// without `Intl.DisplayNames` support) so we don't retry per call.
const regionNamesCache = new Map<AppLocale, Intl.DisplayNames | null>();

const regionNamesFor = (locale: AppLocale): Intl.DisplayNames | null => {
	// `has` (not a nullish check on `get`): a cached `null` is a valid entry —
	// it marks a locale whose construction already failed and must not retry.
	if (regionNamesCache.has(locale)) {
		return regionNamesCache.get(locale) ?? null;
	}

	let names: Intl.DisplayNames | null;

	try {
		// `fallback: 'none'` so an unknown region yields `undefined` and the
		// caller's English fallback wins — the default would echo the raw code.
		names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
	} catch {
		names = null;
	}

	regionNamesCache.set(locale, names);

	return names;
};

/**
 * Localized country name for an ISO-3166 alpha-2 code. Falls back to the
 * provided (English roster) name when the engine lacks `Intl.DisplayNames`
 * or rejects the code.
 */
export const countryDisplayName = ({
	code,
	locale,
	fallback
}: {
	code: string;
	locale: AppLocale;
	fallback: string;
}): string => {
	try {
		return regionNamesFor(locale)?.of(code.toUpperCase()) ?? fallback;
	} catch {
		return fallback;
	}
};

/**
 * Display name for a roster option of either kind — localized for
 * countries, the roster's own name for universities.
 */
export const affiliationDisplayName = ({
	option,
	kind,
	locale
}: {
	option: WorldsAffiliationOption;
	kind: AffiliationKind;
	locale: AppLocale;
}): string =>
	kind === 'country'
		? countryDisplayName({ code: option.id, locale, fallback: option.name })
		: option.name;
