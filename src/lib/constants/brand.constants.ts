/**
 * Brand literals that are NOT translatable copy; the same in every
 * locale (the wordmark). Keep these out of the i18n catalogs, so the brand
 * lives in exactly one place.
 */

/** The wordmark, as document titles and the `Logo` mark carry it. */
export const BRAND_WORDMARK = 'VICI';

/**
 * The standard document title: the page's localized name, then the
 * wordmark. The market-detail page keeps its own SEO-specific title shape.
 */
export const pageTitle = (name: string): string => `${name} · ${BRAND_WORDMARK}`;
