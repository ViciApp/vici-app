import {
	DEFAULT_LOCALE,
	localeFallbackChain,
	type AppLocale
} from '#lib/constants/locale.constants.ts';
import { markets } from '#lib/derived/markets.derived.ts';
import { listMarketTranslationsForLocales } from '#lib/services/market-translation.services.ts';
import { localeStore } from '#lib/stores/locale.store.ts';
import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
import type { MarketTranslation } from '#lib/types/market-translation.ts';
import type { Market } from '#lib/types/market.ts';
import {
	marketDisplayText,
	resolveMarketTranslation,
	type MarketDisplayOriginal,
	type MarketDisplayText
} from '#lib/utils/market-translation.utils.ts';
import { isNullish } from '@dfinity/utils';
import { SvelteMap } from 'svelte/reactivity';
import { derived, get, writable } from 'svelte/store';

/**
 * Bulk-hydrated market-translation overlay shared by the list/deck surfaces.
 * Keyed by `seriesId`, each value is the translation resolved for the
 * **active** locale (via `resolveMarketTranslation`'s fallback chain), or
 * `undefined` when the market has no translation for that locale — which is
 * also what gates the per-card quick toggle.
 *
 * The list/deck owners call `hydrate(visibleSeriesIds)` when their data loads;
 * a single bulk read covers a whole page (the N+1 the detail-page spec called
 * out). The raw docs are cached per series so an app-locale change re-resolves
 * from cache instantly and only fetches series whose new candidate locales
 * weren't already pulled.
 */
const resolved = writable<SvelteMap<string, MarketTranslation | undefined>>(new SvelteMap());

export const marketTranslations = resolved;

// Raw docs per series across every locale fetched so far — lets a locale
// change re-resolve without a round-trip when the new chain is already covered.
const rawBySeriesId = new Map<string, MarketTranslation[]>();
// Per-series record of which locales have been requested, so a re-hydrate only
// fetches genuinely-new `(seriesId, locale)` pairs.
const fetchedLocalesBySeriesId = new Map<string, Set<string>>();

// Must stay ≤ the satellite query's `MAX_BULK_SERIES_IDS` cap. `hydrate`
// chunks the visible set to this bound so a larger page isn't truncated.
const BULK_SERIES_ID_LIMIT = 200;

const candidateLocales = (locale: AppLocale): AppLocale[] => [...localeFallbackChain(locale)];

const reResolve = (locale: AppLocale): void => {
	resolved.update((map) => {
		for (const [seriesId, docs] of rawBySeriesId.entries()) {
			map.set(seriesId, resolveMarketTranslation({ translations: docs, locale })?.translation);
		}

		return map;
	});
};

/**
 * Fetch + resolve translations for the visible series ids. Idempotent per
 * `(seriesId, locale-chain)`: ids whose current candidate locales were already
 * pulled are skipped, so calling this on every data refresh is cheap. Fails
 * open — any error leaves the existing overlay untouched, so surfaces simply
 * render the original text.
 */
export const hydrate = async (seriesIds: string[]): Promise<void> => {
	const locale = get(localeStore);
	const locales = candidateLocales(locale);

	const pending = seriesIds.filter((seriesId) => {
		const seen = fetchedLocalesBySeriesId.get(seriesId);

		return locales.some((candidate) => !(seen?.has(candidate) ?? false));
	});

	if (pending.length === 0) {
		// Still re-resolve so a locale switch reflects cached docs immediately.
		reResolve(locale);

		return;
	}

	for (const seriesId of pending) {
		const seen = fetchedLocalesBySeriesId.get(seriesId) ?? new Set<string>();

		for (const candidate of locales) {
			seen.add(candidate);
		}

		fetchedLocalesBySeriesId.set(seriesId, seen);
	}

	try {
		// The satellite query caps `seriesIds` per call (`MAX_BULK_SERIES_IDS`);
		// chunk to that bound so a visible set larger than the cap isn't silently
		// truncated — which would seed the dropped ids with empty lists and pin
		// them as "fetched" with no translation forever.
		const batches: string[][] = [];

		for (let i = 0; i < pending.length; i += BULK_SERIES_ID_LIMIT) {
			batches.push(pending.slice(i, i + BULK_SERIES_ID_LIMIT));
		}

		const docs = (
			await Promise.all(
				batches.map((seriesIds) => listMarketTranslationsForLocales({ seriesIds, locales }))
			)
		).flat();

		for (const doc of docs) {
			const existing = rawBySeriesId.get(doc.seriesId) ?? [];
			const next = existing.filter((entry) => entry.locale !== doc.locale);
			next.push(doc);
			rawBySeriesId.set(doc.seriesId, next);
		}

		// Series with no returned doc still need an entry so the overlay reads
		// `undefined` (rather than re-fetching forever) — seed an empty list.
		for (const seriesId of pending) {
			if (!rawBySeriesId.has(seriesId)) {
				rawBySeriesId.set(seriesId, []);
			}
		}

		reResolve(get(localeStore));
	} catch {
		// Fail open: drop the optimistic "fetched" marks for the pending ids so
		// a later hydrate retries, and leave the overlay as-is.
		for (const seriesId of pending) {
			fetchedLocalesBySeriesId.delete(seriesId);
		}
	}
};

/**
 * Reactive display-text resolver for a market the caller already holds, when it
 * also needs the per-item toggle state (the on-card / detail quick switch). Most
 * surfaces don't — they read the whole translated market from {@link
 * displayMarkets} instead. Always returns a {@link MarketDisplayText} for the
 * active locale + global preference; when the id has no overlay entry (not
 * hydrated, or no translation exists) every field falls back to the on-chain
 * original.
 */
export const marketDisplay = derived(
	[resolved, marketLanguagePreference],
	([$resolved, $preference]) =>
		(market: MarketDisplayOriginal & { id: string }): MarketDisplayText =>
			marketDisplayText({
				market,
				translation: $resolved.get(market.id),
				showOriginal: $preference === 'original'
			})
);

/**
 * The whole market catalog, each market presented in the reader's language:
 * `title`, `description`, `resolution`, and per-outcome `title` swapped to the
 * stored translation for the active locale (every other field — ids, prices,
 * status, volumes — is the untouched canonical value, so the view is safe for
 * the math/inference helpers too). Keyed by `id`, mirroring `marketById`.
 *
 * This is the global "translated markets" store every list / post-prediction
 * surface reads, so they keep their plain `market.title` /
 * `outcome.title` rendering and never merge translations themselves. The
 * canonical `markets` store stays the on-chain source of truth — consumers that
 * MUST show the original (admin resolution, the WC-art template-matching key,
 * market search) keep reading `markets`, not this.
 *
 * With the global preference set to original — or for a market with no
 * translation for the locale — the original `Market` object is returned
 * as-is (same reference, no allocation).
 */
export const displayMarkets = derived(
	[markets, resolved, marketLanguagePreference],
	([$markets, $resolved, $preference]): Map<string, Market> => {
		const showOriginal = $preference === 'original';
		const map = new Map<string, Market>();

		for (const market of $markets) {
			const translation = $resolved.get(market.id);

			if (showOriginal || isNullish(translation)) {
				// No translation to apply — keep the canonical object (same reference).
				map.set(market.id, market);
			} else {
				const display = marketDisplayText({ market, translation, showOriginal: false });

				map.set(market.id, {
					...market,
					title: display.title,
					description: display.description,
					resolution: display.resolution,
					outcomes: market.outcomes?.map((outcome) => ({
						...outcome,
						title: display.outcomeTitle(outcome.id)
					}))
				});
			}
		}

		return map;
	}
);

// Keep the overlay populated for the whole markets catalog, so `displayMarkets`
// and every surface reading it have translations without each surface firing
// its own fetch. One chunked bulk read covers the catalog; skipped for English
// readers (their fallback chain has nothing to fetch).
//
// Gated on genuinely-new `(locale, id)` pairs rather than calling `hydrate` on
// every emission: the markets store re-emits on each price tick, and an
// unconditional `hydrate` would `reResolve` the overlay every time, rebuilding
// `displayMarkets` for the whole catalog on a timer. The id set is cleared on a
// locale change so the new language is fetched once.
let autoHydrateLocale: AppLocale | undefined;
const autoHydratedIds = new Set<string>();
derived([markets, localeStore], ([$markets, $locale]) => ({
	markets: $markets,
	locale: $locale
})).subscribe(({ markets: $markets, locale }) => {
	if (locale !== autoHydrateLocale) {
		autoHydrateLocale = locale;
		autoHydratedIds.clear();
	}

	if (locale === DEFAULT_LOCALE) {
		return;
	}

	const fresh = $markets.map((market) => market.id).filter((id) => !autoHydratedIds.has(id));

	if (fresh.length === 0) {
		return;
	}

	for (const id of fresh) {
		autoHydratedIds.add(id);
	}

	void hydrate(fresh);
});

// Re-resolve every known series whenever the app locale changes. The first
// emission (current locale) is a no-op against an empty cache; subsequent
// changes re-pick the best translation per series and pull any series whose
// new candidate locales weren't covered yet.
let lastLocale: AppLocale | undefined;
localeStore.subscribe((locale) => {
	if (locale === lastLocale) {
		return;
	}

	lastLocale = locale;
	reResolve(locale);

	const knownIds = [...rawBySeriesId.keys()];

	if (knownIds.length > 0) {
		void hydrate(knownIds);
	}
});
