/**
 * Country flag asset map: keyed by upper-case ISO-3166 alpha-2 codes.
 *
 * Source: lipis/flag-icons 4x3 set (v7.5.0), mirrored under
 * [`#lib/assets/flags/`](../assets/flags/). Each filename is the
 * lower-case ISO-2 code (e.g. `ar.svg`, `gb.svg`).
 *
 * Vite emits each SVG as its own static asset (via `import.meta.glob`
 * with `?url`) and gives us the public URL via the default export.
 * Browsers only fetch the SVG when an `<img>` is actually rendered, so
 * shipping the full ~250-entry set has effectively zero runtime cost.
 *
 * Same pattern as the `control-panel` repo
 * (`src/main/constants/country-flags.constants.ts`): keep the two in
 * sync if the upstream `flag-icons` set changes.
 */

const FLAG_MODULES = import.meta.glob<string>('../assets/flags/*.svg', {
	eager: true,
	query: '?url',
	import: 'default'
});

export const COUNTRY_FLAGS: Record<string, string> = Object.fromEntries(
	Object.entries(FLAG_MODULES).map(([path, url]) => {
		const filename = path.split('/').pop() ?? '';
		const code = filename.replace(/\.svg$/, '').toUpperCase();

		return [code, url];
	})
);

/**
 * Whether we ship a flag SVG for the given country code. Always check
 * before rendering `<CountryFlag>` if the caller doesn't already
 * constrain the input to a known ISO-2 set: unknown codes resolve to
 * `undefined` in `COUNTRY_FLAGS` and the `<img>` would render a broken
 * icon.
 */
export const hasCountryFlag = (countryCode: string | undefined | null): boolean =>
	typeof countryCode === 'string' && countryCode.toUpperCase() in COUNTRY_FLAGS;
