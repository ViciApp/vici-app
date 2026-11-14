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
