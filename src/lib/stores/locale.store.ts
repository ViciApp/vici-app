import {
	isRegisteredLocale,
	LOCALE_STORAGE_KEY,
	type AppLocale
} from '#lib/constants/locale.constants.ts';
import { initStorageStore } from '#lib/stores/storage.store.ts';
import { ensureLocaleCatalogs } from '#lib/utils/i18n.utils.ts';
import { detectBrowserLocale } from '#lib/utils/locale.utils.ts';
import {
	del as delStorage,
	get as getStorage,
	has as hasStorage,
	set as setStorage
} from '#lib/utils/storage.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';
import { readonly, writable } from 'svelte/store';

// First visit: "catch" the device language and match it to a locale we ship.
// `initStorageStore` performs the authoritative "stored value wins, else
// default" read, so we hand it the detected locale as the default and let it
// own the single parse of LOCALE_STORAGE_KEY.
//
// Exported so the picker can surface the auto-detected locale under its
// "Suggested" section and label the "Use automatic" reset with the region it
// would fall back to.
export const detectedLocale = detectBrowserLocale();

export const localeStore = initStorageStore<AppLocale>({
	key: LOCALE_STORAGE_KEY,
	defaultValue: detectedLocale
});

// Separate flag marking that the active locale is an explicit user pick rather
// than the auto-detected seed. The locale value itself is always persisted
// (the first-visit catch below), so its mere presence can't distinguish a seed
// from a choice — this boolean does. The picker reads it to decide whether to
// show the "Use automatic" reset, and clearing it falls the app back to
// detection.
const LOCALE_EXPLICIT_KEY = 'vici.locale.explicit.v1';

const explicitChoice = writable<boolean>(
	browser ? hasStorage({ key: LOCALE_EXPLICIT_KEY }) : false
);

/** Whether the active locale is an explicit user choice (vs. the detected seed). */
export const localeChoiceExplicit = readonly(explicitChoice);

// Persist that first catch so it becomes the durable default: every later
// visit then resolves straight from storage and never re-detects, and an
// explicit pick from the picker simply overwrites it. A presence check (no
// parse, silent on failure) is enough to tell a first visit from a returning
// one — we don't need the stored value here, only whether one exists.
if (browser && !hasStorage({ key: LOCALE_STORAGE_KEY })) {
	setStorage({ key: LOCALE_STORAGE_KEY, value: detectedLocale });
}

// Monotonic pick token: catalogs load async before a switch applies, so two
// rapid picks could otherwise resolve out of order and land the app on the
// earlier (slower-loading) locale. Only the latest pick may commit.
let localeSwitchToken = 0;

const switchLocale = ({ locale, commit }: { locale: AppLocale; commit: () => void }): void => {
	const token = ++localeSwitchToken;

	// Load the catalog chain BEFORE flipping the store — the flip is what
	// re-renders every `t()` consumer, and a flip that beats the chunk fetch
	// would paint the `en` fallback with no later re-render to correct it.
	// (`ensureLocaleCatalogs` resolves even when a chunk fetch fails — the
	// switch still commits and renders `en` copy until a later retry — but
	// that trades a wrong-language paint on a flaky network for never
	// wedging the picker.)
	void ensureLocaleCatalogs(locale).then(() => {
		if (token === localeSwitchToken) {
			commit();
		}
	});
};

/**
 * Apply an explicit locale choice from the picker: persist the locale and mark
 * it as a deliberate pick so the "Use automatic" reset becomes available.
 * The switch commits once `ensureLocaleCatalogs` settles, so on a healthy
 * network the UI never paints the fallback copy mid-switch; if a catalog
 * chunk fails to fetch, the switch still commits and `t()` renders `en`
 * until a later load retries.
 */
export const setLocale = (locale: AppLocale): void => {
	switchLocale({
		locale,
		commit: () => {
			localeStore.set({ key: LOCALE_STORAGE_KEY, value: locale });
			setStorage({ key: LOCALE_EXPLICIT_KEY, value: true });
			explicitChoice.set(true);
		}
	});
};

/**
 * Drop the explicit choice and fall the app back to the auto-detected locale.
 * Clears the explicit flag and resets the active locale to what the device
 * language resolves to today, so a later visit re-detects from a clean slate.
 */
export const clearLocaleChoice = (): void => {
	delStorage({ key: LOCALE_EXPLICIT_KEY });
	explicitChoice.set(false);

	// `reset` removes the persisted locale (not just overwrites it) and sets the
	// in-memory store back to the detected seed. Removing the key is what lets a
	// later visit re-detect from a clean slate — the first-visit catch above
	// re-persists a fresh detection on next load. Overwriting with the current
	// `detectedLocale` would instead leave a stored value that pins the locale.
	switchLocale({
		locale: detectedLocale,
		commit: () => {
			localeStore.reset({ key: LOCALE_STORAGE_KEY });
		}
	});
};

// Startup guard. `initStorageStore` JSON-parses the stored value but cannot
// know which locales are registered, so a corrupted / foreign payload would
// otherwise seed the in-memory store — and a garbage BCP-47 tag can throw in
// `Intl` consumers (`new Intl.DateTimeFormat($localeStore)`). Overwrite it
// with the detected seed, in memory and in storage, via the persisting `set`.
if (browser) {
	const stored: unknown = getStorage({ key: LOCALE_STORAGE_KEY });

	if (nonNullish(stored) && !isRegisteredLocale(stored)) {
		localeStore.set({ key: LOCALE_STORAGE_KEY, value: detectedLocale });
	}
}

// Storage values are JSON-encoded (see `storage.utils`), and a `storage` event
// carries the raw string — parse and gate it against the registry so a
// corrupted or foreign value can never put the app in an unknown locale.
const parseStoredLocale = (raw: string | null): AppLocale | undefined => {
	if (isNullish(raw)) {
		return;
	}

	try {
		const value: unknown = JSON.parse(raw);

		if (isRegisteredLocale(value)) {
			return value;
		}
	} catch {
		// Unparseable payload — treated as absent by falling through.
	}
};

// Multi-tab sync (mirrors `theme.store`). The `storage` event fires only in
// the *other* tabs of the origin — the writing tab already updated itself via
// `setLocale` / `clearLocaleChoice` — so mirroring the new value into the
// in-memory store keeps every open tab on the chosen locale without a reload.
// `update` deliberately bypasses the store's persisting `set`: the value is
// already in storage, and re-writing it from here would be redundant.
if (browser) {
	window.addEventListener('storage', (event) => {
		if (event.key === LOCALE_STORAGE_KEY) {
			// A removed key (`newValue === null`) is `clearLocaleChoice` in another
			// tab — fall back to this tab's detected seed, like `reset` does. An
			// unparseable / unregistered value is ignored rather than reset: no
			// code path writes one, so treat it as noise instead of a choice.
			if (isNullish(event.newValue)) {
				switchLocale({
					locale: detectedLocale,
					commit: () => {
						localeStore.update(() => detectedLocale);
					}
				});

				return;
			}

			const next = parseStoredLocale(event.newValue);

			if (nonNullish(next)) {
				switchLocale({
					locale: next,
					commit: () => {
						localeStore.update(() => next);
					}
				});
			}

			return;
		}

		if (event.key === LOCALE_EXPLICIT_KEY) {
			explicitChoice.set(nonNullish(event.newValue));
		}
	});
}
