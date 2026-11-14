/**
 * Light-weight country-of-origin heuristic derived from the user's
 * `navigator.language` (and `navigator.languages` fallback chain). Used
 * by onboarding to promote a locally-relevant team into the WC favourite
 * grid: a Brazilian visitor sees Brazil in position 1 without scrolling
 * through 48 nations.
 *
 * We deliberately scope the API to "return a single ISO-3166 alpha-2 or
 * null": every caller wants the first match, and SSR safety is handled
 * here so consumers don't have to remember the `typeof navigator` guard.
 */

/**
 * Pull the user's preferred ISO-3166 alpha-2 country code from
 * `navigator.languages` / `navigator.language`. Returns `null` when
 * called outside a browser, when the navigator exposes no region tag,
 * or when the region tag is malformed.
 *
 * `en-US` → `'US'`, `pt-BR` → `'BR'`, `en` (no region) → `null`.
 */
export const detectUserCountryCode = (): string | null => {
	if (typeof navigator === 'undefined') {
		return null;
	}

	const tags: readonly string[] =
		navigator.languages && navigator.languages.length > 0
			? navigator.languages
			: navigator.language
				? [navigator.language]
				: [];

	for (const tag of tags) {
		const region = (tag.split('-')[1] ?? '').toUpperCase();

		// A valid region subtag is exactly two ASCII letters (ISO-3166-1
		// alpha-2). Anything else (three-letter UN codes, M.49 numerics,
		// empty) we ignore.
		if (/^[A-Z]{2}$/.test(region)) {
			return region;
		}
	}

	return null;
};
