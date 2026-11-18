/**
 * Brand literals that are NOT translatable copy; the same in every
 * locale (Latin motto, wordmark). Keep these out of the i18n catalogs
 * and reference the constants wherever the motto appears, so the brand
 * lives in exactly one place.
 */

/** Leading part of the Latin motto: "Veni · Vidi · ". */
export const LATIN_MOTTO_LEAD = 'Veni · Vidi · ';

/** Accented tail of the Latin motto: "Vici." (rendered in the gold accent). */
export const LATIN_MOTTO_TAIL = 'Vici.';

/** The wordmark: the landing's whole document title. */
export const BRAND_WORDMARK = 'VICI';

/**
 * The standard document title: the page's localized name, then the
 * wordmark. The market-detail page keeps its own SEO-specific title shape.
 */
export const pageTitle = (name: string): string => `${name} · ${BRAND_WORDMARK}`;
