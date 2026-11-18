import { browser } from '$app/env';
import { isNullish } from '@dfinity/utils';
import { writable } from 'svelte/store';

export type Theme = 'dark' | 'light' | 'peach';

const THEME_KEY = 'vici-theme';
export const THEMES: readonly Theme[] = ['dark', 'light', 'peach'] as const;

/**
 * Theme-label i18n keys consumed by `AppearancePicker` (settings tile +
 * dropdown dots) and the `WelcomeNav` theme control. Centralised so the
 * pickers share the same labelling without each carrying its own literal
 * map.
 */
export type ThemeLabelKey = 'ui.theme.dark' | 'ui.theme.light' | 'ui.theme.peach';

/**
 * Background / dot hex pairs for theme preview chips. Single source of
 * truth for `AppearancePicker` (settings + dropdown variants) and the
 * `WelcomeNav` theme control. Hex values intentionally diverge from the
 * runtime `--bg-base` / `--text-base` tokens; these are static preview
 * swatches that must read correctly even when the *opposite* theme is
 * currently active.
 */
export interface ThemeSwatch {
	readonly id: Theme;
	readonly labelKey: ThemeLabelKey;
	readonly bg: string;
	readonly dot: string;
}

export const THEME_SWATCHES: readonly ThemeSwatch[] = [
	{ id: 'dark', labelKey: 'ui.theme.dark', bg: '#0E0D0B', dot: '#F2ECDC' },
	{ id: 'light', labelKey: 'ui.theme.light', bg: '#F2ECDC', dot: '#0E0D0B' },
	{ id: 'peach', labelKey: 'ui.theme.peach', bg: '#FAE0CC', dot: '#3D2419' }
] as const;

const getInitialTheme = (): Theme => {
	if (!browser) {
		return 'dark';
	}

	const value = localStorage.getItem(THEME_KEY);

	return THEMES.includes(value as Theme) ? (value as Theme) : 'dark';
};

export const theme = writable<Theme>(getInitialTheme());

if (browser) {
	theme.subscribe((value) => {
		localStorage.setItem(THEME_KEY, value);
		document.documentElement.setAttribute('data-theme', value);
	});

	// Multi-tab sync. When another tab toggles the theme, the `storage`
	// event fires on the document with the new key/value pair. Mirror
	// the change into the local writable so all open tabs render the
	// same theme without a reload.
	window.addEventListener('storage', (event) => {
		if (event.key !== THEME_KEY || isNullish(event.newValue)) {
			return;
		}

		if (THEMES.includes(event.newValue as Theme)) {
			theme.set(event.newValue as Theme);
		}
	});
}
