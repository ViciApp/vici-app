/**
 * Real contact addresses — the single source of truth for every
 * outward-facing email the product surfaces (FAQ, footer, account
 * deletion, legal copy, the public Info docs).
 *
 * These are contact identifiers, not translatable copy: keep them out
 * of the i18n catalogs and reference these constants wherever a real
 * address appears, so the domain lives in exactly one place. Illustrative
 * placeholders (`you@example.com` and friends) are intentionally NOT
 * defined here — those stay inline as examples.
 */

/** Apex domain all contact mailboxes hang off. */
export const CONTACT_DOMAIN = 'vici.market';

/**
 * Assembles a full address from its local-part and the apex domain,
 * joining them with an `@` produced at runtime. This is an anti-harvest
 * measure: the served source must never carry a contiguous `local@domain`
 * string — nor an `@` glued directly to the domain literal — for naive
 * scrapers to lift, while every consumer still gets the exact same address
 * at runtime.
 *
 * The glue is stored REVERSED (the `@` plus the reversed domain) and
 * un-reversed at runtime via `split/reverse/join`. The bundler's
 * constant-folder evaluates pure expressions like `String.fromCharCode(64)`
 * at build time — which would re-emit a literal `@` adjacent to the domain
 * literal, defeating the measure — but it does NOT execute string-instance
 * methods (`reverse()`) on literals, so the `@<domain>` tail never appears
 * contiguously in the shipped bundle. Keep any change here verified against
 * the built output, not just the source.
 */
const reverse = (value: string): string => value.split('').reverse().join('');
/**
 * `@vici.market`, stored REVERSED as a single literal. The reversed form
 * carries neither a contiguous `@vici.market` tail nor a `vici.market`
 * substring, so a scraper reading the served source finds no anchor; the
 * runtime `reverse()` rebuilds the exact `@` + apex-domain suffix. (Must
 * stay in sync with `CONTACT_DOMAIN` above.)
 */
const REVERSED_AT_DOMAIN = 'tekram.iciv@';
const buildEmail = (local: string): string => `${local}${reverse(REVERSED_AT_DOMAIN)}`;

/** General info / support / help inbox — the public-facing contact address. */
export const INFO_EMAIL = buildEmail('info');

/** General hello / press inbox. */
export const HELLO_EMAIL = buildEmail('hello');

/** Resolution-dispute filings (referenced from the resolution rules). */
export const RESOLUTION_EMAIL = buildEmail('resolution');
