import { browser } from '$app/env';
import { isNullish } from '@dfinity/utils';
import { writable } from 'svelte/store';

/**
 * Global default for how market metadata (title / description / resolution /
 * outcomes) renders across every surface:
 *
 * - `translated` — show the stored translation for the reader's resolved
 *   locale when one exists (the default).
 * - `original` — always show the on-chain original language.
 *
 * Client-persisted in `localStorage` (identity-agnostic, like the theme
 * preference) rather than the satellite `preferences` schema, which would
 * require a Candid + Rust binding regen. Cross-device sync is a later change.
 */
export type MarketLanguagePreference = 'translated' | 'original';

const MARKET_LANGUAGE_KEY = 'vici.market-language.v1';
const PREFERENCES: readonly MarketLanguagePreference[] = ['translated', 'original'] as const;
const DEFAULT_PREFERENCE: MarketLanguagePreference = 'translated';

const isPreference = (value: unknown): value is MarketLanguagePreference =>
	PREFERENCES.includes(value as MarketLanguagePreference);

const getInitialPreference = (): MarketLanguagePreference => {
	if (!browser) {
		return DEFAULT_PREFERENCE;
	}

	const value = localStorage.getItem(MARKET_LANGUAGE_KEY);

	return isPreference(value) ? value : DEFAULT_PREFERENCE;
};

export const marketLanguagePreference = writable<MarketLanguagePreference>(getInitialPreference());

if (browser) {
	marketLanguagePreference.subscribe((value) => {
		localStorage.setItem(MARKET_LANGUAGE_KEY, value);
	});

	// Multi-tab sync (mirrors `theme.store`). When another tab flips the
	// preference the `storage` event fires here with the new value; mirror it
	// into the local writable so all open tabs render markets consistently
	// without a reload.
	window.addEventListener('storage', (event) => {
		if (event.key !== MARKET_LANGUAGE_KEY || isNullish(event.newValue)) {
			return;
		}

		if (isPreference(event.newValue)) {
			marketLanguagePreference.set(event.newValue);
		}
	});
}
