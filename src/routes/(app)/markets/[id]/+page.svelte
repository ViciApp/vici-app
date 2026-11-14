<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import { onDestroy, onMount } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import MarketDetailChartCard from '#lib/components/market/MarketDetailChartCard.svelte';
	import MarketDetailCtaBar from '#lib/components/market/MarketDetailCtaBar.svelte';
	import MarketDetailLivePill from '#lib/components/market/MarketDetailLivePill.svelte';
	import MarketDetailLockedToast from '#lib/components/market/MarketDetailLockedToast.svelte';
	import MarketDetailProbHero from '#lib/components/market/MarketDetailProbHero.svelte';
	import MarketDetailResolutionCard from '#lib/components/market/MarketDetailResolutionCard.svelte';
	import MarketDetailShareButton from '#lib/components/market/MarketDetailShareButton.svelte';
	import MarketDetailSkeleton from '#lib/components/market/MarketDetailSkeleton.svelte';
	import MarketDetailStatsGrid from '#lib/components/market/MarketDetailStatsGrid.svelte';
	import MarketDetailTopPredictors from '#lib/components/market/MarketDetailTopPredictors.svelte';
	import MarketDetailWhyNow from '#lib/components/market/MarketDetailWhyNow.svelte';
	import MarketMetadataForm from '#lib/components/market/MarketMetadataForm.svelte';
	import MarketResolutionInterface from '#lib/components/market/MarketResolutionInterface.svelte';
	import MarketTranslationToggle from '#lib/components/market/MarketTranslationToggle.svelte';
	import OutcomeBadge from '#lib/components/market/OutcomeBadge.svelte';
	import TradeModal from '#lib/components/market/TradeModal.svelte';
	import SavedMarketToggle from '#lib/components/saved-markets/SavedMarketToggle.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { MARKET_DETAIL_DIRECT_TRADE_ENABLED } from '#lib/constants/feature-flags.constants.ts';
	import { SUPPORTED_LOCALES } from '#lib/constants/locale.constants.ts';
	import { primaryMicro } from '#lib/constants/market-taxonomy.constants.ts';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { leaderboard } from '#lib/derived/leaderboard.derived.ts';
	import { marketMetadata } from '#lib/derived/market-metadata.derived.ts';
	import { marketTags } from '#lib/derived/market-tags.derived.ts';
	import { pageMarketId } from '#lib/derived/page-market.derived.ts';
	import { resolvedPositions } from '#lib/derived/resolved-positions.derived.ts';
	import {
		authPrincipal,
		userIsAdmin,
		userIsAdminOrSolver,
		userSignedIn
	} from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { getUserMarketSignals } from '#lib/services/market-signals.services.ts';
	import { listMarketTranslations } from '#lib/services/market-translation.services.ts';
	import { loadMarket } from '#lib/services/market.services.ts';
	import { getPositionsForMarket } from '#lib/services/position.services.ts';
	import { getMarketTopPredictors } from '#lib/services/top-predictors.services.ts';
	import { getSeriesTradeVolume, loadMarketPriceCandles } from '#lib/services/trade.services.ts';
	import { showCompanion } from '#lib/stores/companion.store.ts';
	import { startGuestSession } from '#lib/stores/guest.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import type {
		FollowedLeanSignal,
		PriorCallSignal,
		TopPredictorSignal
	} from '#lib/types/market-signals.ts';
	import type { MarketTranslation } from '#lib/types/market-translation.ts';
	import type { CallSide, Market, MarketId } from '#lib/types/market.ts';
	import type { Position, ResolvedPosition } from '#lib/types/position.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type {
		MarketPriceSeries,
		PriceHistoryPeriod
	} from '#lib/utils/market-price-history.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { resolveMarketTranslation } from '#lib/utils/market-translation.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { positionResolvedResult } from '#lib/utils/position.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let market = $state<Market | undefined>();

	let positions = $state<Position[]>([]);

	// Whether the viewer's positions for the current market have been read at
	// least once. Gates the MY CALL tile's loading pulse so it doesn't flash an
	// empty `–` before the (signed-in) position read lands. Reset on a
	// foreground market change, set once the read resolves.
	let positionsLoaded = $state(false);

	// Creator/admin-authored metadata translations for this market (one per
	// `live` locale), read in bulk once per market. Empty until the read
	// resolves and for markets with no translations at all.
	let marketTranslations = $state<MarketTranslation[]>([]);
	// Market id whose translations were read **successfully**: set only after a
	// resolved response so a transient failure retries on the next market write
	// (poll / certified update / re-navigation) instead of disabling for good.
	let translationsFetchedForId = $state<MarketId | undefined>(undefined);
	// In-flight market id: a plain (non-reactive) guard that dedupes the
	// query→certified double load without re-triggering the fetch effect.
	let translationsLoadingId: MarketId | undefined = undefined;

	// Whether the reader has flipped the metadata back to the original
	// (on-chain) language. Seeds from the global market-language preference and
	// snaps back to that default on a market change (see the fetch effect
	// below); a per-market flip stays local and doesn't change the preference.
	let showOriginal = $state($marketLanguagePreference === 'original');

	// Viewer-relative market signals (the prior call they hold here, the
	// lean of the people they follow). Sparse by construction: absent
	// when signed-out or when no signal exists for this market, so the
	// surfaces that read them simply omit their row rather than show
	// invented data.
	let followedLean = $state<FollowedLeanSignal | undefined>();
	let priorCall = $state<PriorCallSignal | undefined>();

	// Leaderboard-ranked predictors holding a live position on this market,
	// with the side they took. Public data (same list for every visitor),
	// resolved against the cached global leaderboard once it and the market
	// are both known. `undefined` while unresolved so the section can tell
	// "still loading" apart from "nobody's here".
	let topPredictors = $state<TopPredictorSignal[] | undefined>();
	let topPredictorsMarketId = $state<MarketId | undefined>();

	// Chart period chip selection. Drives which window of market-wide price
	// history the chart fetches and plots (see priceHistoryByPeriod).
	let chartPeriod = $state<PriceHistoryPeriod>('7d');

	// Real, market-wide price-history series for this market, derived from
	// the clearing canister's OHLC candles (every participant's fills, not
	// just the viewer's). Reflects the true market movement for all viewers,
	// including signed-out visitors. Cached per period so re-selecting a chip
	// is instant; a period is empty once it resolves with no trades in the
	// window (true cold-start flat line) and absent while it hasn't resolved
	// yet, so the chart falls back to its seed shape rather than flashing a
	// misleading flat line.
	let priceHistoryByPeriod = $state<Partial<Record<PriceHistoryPeriod, MarketPriceSeries>>>({});
	const chartPriceHistory = $derived(priceHistoryByPeriod[chartPeriod]);

	// Market-wide traded volume (payout-token base units), aggregated from the
	// executed-trade tape. `undefined` while it drains so the VOLUME tile pulses
	// on first load; `ZERO` once read for an untraded market (cold-start "New").
	// Rides behind the first paint like the other secondary reads and skips the
	// 30s consensus poll. `volumeMarketId` guards the fetch effect against the
	// poll / certified update re-running it.
	let marketVolume = $state<bigint | undefined>(undefined);
	let volumeMarketId = $state<MarketId | undefined>(undefined);

	let loading = $state(true);

	let selectedSide = $state<CallSide | undefined>();

	let lockedToastOpen = $state(false);

	// Market id whose viewer signals we've already pulled on the foreground
	// paint: keeps the certified update's second `onLoad` from re-fetching.
	let signalsFetchedForId: MarketId | undefined;

	const fetchMarket = async ({ id, silent = false }: { id: MarketId; silent?: boolean }) => {
		if (!silent) {
			loading = true;
			// Re-arm the MY CALL loading pulse for the new market until its
			// position read lands (the silent poll keeps the prior value).
			positionsLoaded = false;
			// Drop any history from the previously-viewed market so the
			// chart falls back to its seed shape until the new series
			// resolves, rather than briefly plotting stale prices. The
			// per-period fetch effect repopulates the active period.
			priceHistoryByPeriod = {};

			// Same for the top-predictors list: clearing the resolved
			// market id re-arms the fetch effect for the new market.
			topPredictors = undefined;
			topPredictorsMarketId = undefined;

			// Re-arm the volume read for the new market (pulse until it drains).
			marketVolume = undefined;
			volumeMarketId = undefined;

			// Re-arm the viewer-signals fetch for this foreground load (it
			// fires once, on the first `onLoad`).
			signalsFetchedForId = undefined;
		}

		// Query-then-update: `loadMarket` fires `onLoad` twice, first with the
		// fast uncertified query (drives the first paint, replacing the
		// skeleton), then with the certified update which upgrades the view in
		// place. We clear `loading` and fetch the viewer signals on the FIRST
		// arrival only, so a foreground load paints from the query and the
		// later certified result silently refreshes.
		const [, positionsRes] = await Promise.all([
			loadMarket({
				marketId: id,
				onLoad: ({ response }) => {
					market = response;

					if (!silent) {
						loading = false;

						// Signals only change with the viewer's own activity, not
						// with the 30s consensus poll: fetch them on the first
						// foreground paint and skip the silent refresh so we don't
						// re-pull trade history + friend activity every tick. Guard
						// against the certified update re-firing them.
						if (signalsFetchedForId !== id) {
							signalsFetchedForId = id;
							void fetchSignals(response);
						}
					}
				},
				onUpdateError: (error) => {
					console.error('market detail: certified update failed', error);
				}
			}),
			// Fail open: a positions-read error must not reject the whole load or
			// strand the MY CALL shimmer (positionsLoaded never set); fall back to
			// an empty set so the tile resolves to "–".
			getPositionsForMarket(id).catch((error: unknown) => {
				console.error('market detail: positions read failed', error);

				return [] as Position[];
			})
		]);

		// Drop a late response from a previously-viewed market: a fast navigation
		// can resolve an older market's positions after the current one's, which
		// would otherwise clobber the live set (and its loaded/shimmer state).
		if ($pageMarketId !== id) {
			return;
		}

		positions = positionsRes;
		positionsLoaded = true;
	};

	// Read this market's translations once per market and snap the view back to
	// the translated default on a market change. One bulk call (not a per-locale
	// round-trip) returns every stored locale; `resolveMarketTranslation` then
	// picks the best match for the active locale via the fallback chain.
	$effect(() => {
		const id = market?.id;

		if (isNullish(id) || translationsFetchedForId === id || translationsLoadingId === id) {
			return;
		}

		translationsLoadingId = id;
		showOriginal = $marketLanguagePreference === 'original';
		marketTranslations = [];

		void loadTranslations(id);
	});

	// Fails open: any error simply leaves `marketTranslations` empty, so the
	// page shows the original metadata and no toggle: never a broken state.
	// `translationsFetchedForId` is set only on success, so a failed read is
	// retried the next time this market is loaded rather than disabled for good.
	const loadTranslations = async (id: MarketId) => {
		try {
			const items = await listMarketTranslations(id);

			// Guard against a late response from a previously-viewed market.
			if (market?.id === id) {
				marketTranslations = items;
			}

			translationsFetchedForId = id;
		} catch (err) {
			console.warn('market detail: translations load failed', err);
		} finally {
			if (translationsLoadingId === id) {
				translationsLoadingId = undefined;
			}
		}
	};

	// Fetch the active period's market-wide price history the first time
	// it's needed (and after a market change clears the cache). Independent
	// of the viewer: it's the same series for everyone, so it loads
	// regardless of sign-in. Cache-aware: re-selecting a chip is instant and
	// the 30s consensus poll's market refresh doesn't refetch every tick.
	$effect(() => {
		const id = market?.id;
		const period = chartPeriod;

		if (isNullish(id) || period in priceHistoryByPeriod) {
			return;
		}

		void fetchPriceHistory({ id, period });
	});

	// Real, market-wide price history for one chart period. Fails open: any
	// error simply leaves the period uncached, so the chart stays on its
	// seed-based fallback and a later trigger can retry.
	const fetchPriceHistory = async ({
		id,
		period
	}: {
		id: MarketId;
		period: PriceHistoryPeriod;
	}) => {
		try {
			await loadMarketPriceCandles({
				seriesId: id,
				period,
				onLoad: ({ response }) => {
					// Guard against a late response from a previously-viewed
					// market: the cache is keyed by period and cleared on market
					// change, so writing here without re-checking the id could
					// repopulate it with the prior market's series after the user
					// navigated away. Drop it if the market changed meanwhile.
					if (market?.id !== id) {
						return;
					}

					priceHistoryByPeriod = { ...priceHistoryByPeriod, [period]: response };
				}
			});
		} catch {
			// Leave the period uncached → chart falls back to its seed shape.
		}
	};

	// Resolve the top-predictors list once the market and the cached global
	// leaderboard are both known. Like the price history this is
	// viewer-independent (works signed-out) and rides behind the first paint;
	// the resolved-market guard keeps the 30s poll and unrelated leaderboard
	// ticks from re-probing every run.
	$effect(() => {
		const id = market?.id;
		const candidates = $leaderboard;

		if (isNullish(id) || candidates.length === 0 || topPredictorsMarketId === id) {
			return;
		}

		topPredictorsMarketId = id;
		void fetchTopPredictors({ id, candidates: candidates.map(({ owner }) => owner) });
	});

	// Fails open: an error leaves the list empty rather than blocking the
	// page, and a late response from a previously-viewed market is dropped.
	const fetchTopPredictors = async ({ id, candidates }: { id: MarketId; candidates: string[] }) => {
		try {
			const signals = await getMarketTopPredictors({ marketId: id, candidates });

			if (market?.id !== id) {
				return;
			}

			topPredictors = signals;
		} catch {
			if (market?.id === id) {
				topPredictors = [];
			}
		}
	};

	// Drain the market's traded-volume tape once the market (and its token
	// precision) is known. Viewer-independent (works signed-out) and rides
	// behind the first paint; the resolved-market guard keeps the 30s poll and
	// certified update from re-draining every run.
	$effect(() => {
		const id = market?.id;
		const decimals = market?.token.decimals;

		if (isNullish(id) || isNullish(decimals) || volumeMarketId === id) {
			return;
		}

		volumeMarketId = id;
		void fetchVolume({ id, decimals });
	});

	// Fails open: any error leaves the volume at ZERO (the cold-start "New"
	// state) rather than blocking the page, and a late response from a
	// previously-viewed market is dropped.
	const fetchVolume = async ({ id, decimals }: { id: MarketId; decimals: number }) => {
		try {
			const volume = await getSeriesTradeVolume({ seriesId: id, decimals });

			if (market?.id !== id) {
				return;
			}

			marketVolume = volume;
		} catch {
			if (market?.id === id) {
				marketVolume = ZERO;
			}
		}
	};

	// Viewer-relative signals are a secondary, signed-in-only fetch
	// (trade history + the activity of people the viewer follows). It
	// rides on top of the market load rather than blocking the first
	// paint, and fails open: any error just leaves the prior-call /
	// followed-lean rows hidden.
	const fetchSignals = async (m: Market | undefined) => {
		if (isNullish(m) || !$userSignedIn) {
			followedLean = undefined;
			priorCall = undefined;

			return;
		}

		try {
			const signals = await getUserMarketSignals({
				domain: m.balanceDomain,
				marketIds: [m.id]
			});

			followedLean = signals.followedLean[m.id];
			priorCall = signals.priorCalls[m.id];
		} catch {
			followedLean = undefined;
			priorCall = undefined;
		}
	};

	let intervalId: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		if (nonNullish($pageMarketId)) {
			track({ name: 'market_viewed', source: 'market_detail', marketId: $pageMarketId });

			fetchMarket({ id: $pageMarketId });

			intervalId = setInterval(() => {
				if (nonNullish($pageMarketId)) {
					fetchMarket({ id: $pageMarketId, silent: true });
				}
			}, 30000);
		}

		return () => {
			if (intervalId) {
				clearInterval(intervalId);
			}
		};
	});

	$effect(() => {
		if (nonNullish($pageMarketId) && (isNullish(market) || market.id !== $pageMarketId)) {
			fetchMarket({ id: $pageMarketId });
		}
	});

	const onPredictionPlaced = () => {
		// Confirmation overlay (`Locked in.`): done-state choreography.
		// Held for 1100 ms so the user sees the acknowledgement, then
		// we dismiss the sheet and refetch the market silently.
		lockedToastOpen = true;
		selectedSide = undefined;

		setTimeout(() => {
			lockedToastOpen = false;
		}, 1100);

		if (nonNullish(market)) {
			fetchMarket({ id: market.id, silent: true });

			// The silent refresh deliberately skips `fetchSignals` and the
			// price-history fetch (the 30s consensus poll shouldn't re-pull
			// either every tick), but the viewer just traded, so the chart's
			// real price history and the prior-call / followed-lean signals
			// are now stale. Re-pull signals explicitly, and clear the
			// price-history cache so the fetch effect re-resolves the active
			// period (other periods refetch lazily when reselected).
			void fetchSignals(market);
			priceHistoryByPeriod = {};

			// The viewer may themselves rank on the leaderboard, in which
			// case their fresh call belongs in the top-predictors list;
			// re-arm the fetch effect rather than waiting for a navigation.
			topPredictorsMarketId = undefined;

			// The viewer's trade adds to volume: re-arm the drain to refresh it
			// in place (the existing value stays put, so the tile doesn't pulse).
			volumeMarketId = undefined;
		}
	};

	const tags = $derived(nonNullish(market) ? ($marketTags[market.id] ?? []) : []);
	const primaryTag = $derived(primaryMicro(tags));

	// Curated metadata for this market: the editorial subtitle (the
	// context line under the title) and the "why this card now" cue.
	const metadata = $derived(nonNullish(market) ? $marketMetadata[market.id] : undefined);
	const contextLine = $derived(metadata?.subtitle?.trim() ?? '');
	const whyNow = $derived(metadata?.whyNow);

	// Best translation for the reader's locale (resolved through the fallback
	// chain), or `undefined` when none exists, which is what gates the toggle.
	const activeTranslation = $derived(
		resolveMarketTranslation({ translations: marketTranslations, locale: $localeStore })
	);

	// Native name of the translated language, for the "View in {language}"
	// control. Falls back to the bare locale id if it's somehow not in the list.
	const translatedLanguageLabel = $derived(
		nonNullish(activeTranslation)
			? (SUPPORTED_LOCALES.find(({ id }) => id === activeTranslation.locale)?.label ??
					activeTranslation.locale)
			: ''
	);

	// Show the original (on-chain) text when the reader has flipped the toggle
	// or when there's no translation to show. Each field falls back to the
	// original whenever the translated value is missing/blank: translations
	// are user-authored, so a stray empty field must never blank out the title.
	const showTranslated = $derived(nonNullish(activeTranslation) && !showOriginal);
	const translatedTitle = $derived(activeTranslation?.translation.title ?? '');
	const translatedResolution = $derived(activeTranslation?.translation.resolution ?? '');
	const displayTitle = $derived(
		showTranslated && notEmptyString(translatedTitle.trim())
			? translatedTitle
			: (market?.title ?? '')
	);
	const displayResolution = $derived(
		showTranslated && notEmptyString(translatedResolution.trim())
			? translatedResolution
			: market?.resolution
	);

	const onToggleTranslation = () => {
		showOriginal = !showOriginal;

		if (nonNullish(market)) {
			track({
				name: 'market_translation_toggled',
				marketId: market.id,
				source: 'detail',
				label: showOriginal ? 'original' : 'translated'
			});
		}
	};

	// `yesProbability` is optional: `undefined` while the book hasn't been
	// read (or read empty). Fall back to 0 only for the percent math so we
	// never multiply `undefined` into a NaN; the prob hero renders an odds
	// skeleton (not a 0/100 split) whenever `oddsKnown` is false.
	const oddsKnown = $derived(nonNullish(market?.yesProbability));
	const yesPercent = $derived(
		oddsKnown ? Math.min(100, Math.max(0, Math.round((market?.yesProbability ?? 0) * 100))) : 0
	);
	const noPercent = $derived(100 - yesPercent);

	const isResolved = $derived(market?.status === 'Resolved');
	const isLive = $derived(market?.status === 'Open');

	// The direct-trade CTA bar only ever renders for a live market behind the
	// build-time flag. Drive both the CTA `{#if}` and the read-only padding
	// modifier from this single source so the reserved CTA space collapses
	// whenever the bar is absent: including a flag-on, non-live market.
	const showTradeCta = $derived(MARKET_DETAIL_DIRECT_TRADE_ENABLED && isLive);

	// Resolved binary outcome (YES/NO) when known. Drives the
	// "RESOLVED · YES/NO" tag, the settled banner, and the dimming of the
	// losing side in the probability hero.
	const resolvedOutcome = $derived<CallSide | undefined>(
		isResolved && (market?.outcome === 'YES' || market?.outcome === 'NO')
			? market.outcome
			: undefined
	);

	// True cold-start: a live market nobody has traded yet. Keyed off the real
	// traded volume (Σ qty·price), so it surfaces the "New / be first" cue only
	// once the drain confirms zero: never while it's still loading (the banner
	// would otherwise flash on every market) and never off a synthetic crowd.
	const isColdStart = $derived(isLive && marketVolume === ZERO);

	// Resolved entries from the user's `Settled` event stream that match
	// this market. Used to keep the resolution UX (MY CALL stat,
	// "Called it." beat) working after the clearing canister removes the
	// live `Position` row at settlement.
	const resolvedForMarket = $derived.by<ResolvedPosition[]>(() => {
		const m = market;

		if (isNullish(m)) {
			return [];
		}

		return $resolvedPositions.filter((r) => r.marketId === m.id);
	});

	const wonThisMarket = $derived(resolvedForMarket.some((r) => r.result === 'won'));

	// MY CALL pulses only for a signed-in viewer whose position read for this
	// market hasn't landed yet: signed-out visitors have no call to wait for,
	// so they read `–` immediately rather than a perpetual shimmer.
	const myCallLoading = $derived($userSignedIn && !positionsLoaded);

	const canEditMetadata = $derived(
		nonNullish(market) && ($userIsAdmin || market.creator === $authPrincipal)
	);

	const canResolve = $derived(
		nonNullish(market) && market.status !== 'Resolved' && $userIsAdminOrSolver
	);

	const showAdminActions = $derived(canEditMetadata || canResolve);

	// Resolution choreography: see `docs/ai/frontend/design.md` §7.6.
	// On the first time the user views a resolved market they have a
	// position on:
	//   right call → Oracle 1.2 s, "Called it."
	//   wrong call → no character; the resolved panel + lost-state
	//                crossfade carry the acknowledgement.
	// Tracked in `sessionStorage` per market id so re-navigating to
	// the same page within a session doesn't re-fire.
	const RESOLUTION_BEAT_KEY_PREFIX = 'vici:resolution-beat:';
	let resolutionBeatTimeoutId: ReturnType<typeof setTimeout> | undefined;
	let resolutionBeatScheduledFor: string | undefined;

	$effect(() => {
		if (!browser) {
			return;
		}

		const m = market;

		if (isNullish(m) || m.status !== 'Resolved') {
			return;
		}

		if (resolutionBeatScheduledFor === m.id) {
			return;
		}

		// Win is detected from either source so the beat keeps firing
		// after the clearing canister removes the live `Position`:
		//   - `positions` is fresh during the brief window between trade
		//     and settlement (used for the immediate post-resolve refresh).
		//   - `resolvedForMarket` is the durable record sourced from the
		//     `Settled` event stream.
		const wonLive = positions.some(
			(p) => positionResolvedResult({ market: m, position: p }) === 'won'
		);
		const wonAny = wonLive || wonThisMarket;

		if (!wonAny) {
			return;
		}

		const beatKey = `${RESOLUTION_BEAT_KEY_PREFIX}${m.id}`;

		try {
			if (nonNullish(sessionStorage.getItem(beatKey))) {
				resolutionBeatScheduledFor = m.id;

				return;
			}

			sessionStorage.setItem(beatKey, '1');
		} catch {
			// sessionStorage can throw in privacy modes / sandboxed
			// iframes: fail open, still fire the beat, just lose the
			// once-per-session guard.
		}

		resolutionBeatScheduledFor = m.id;
		resolutionBeatTimeoutId = setTimeout(() => {
			showCompanion({
				who: 'oracle',
				line: t({ locale: $localeStore, key: 'companion.oracle.called_it' }),
				dwell_ms: 1200,
				anchor: 'br'
			});
			resolutionBeatTimeoutId = undefined;
		}, 320);
	});

	onDestroy(() => {
		if (nonNullish(resolutionBeatTimeoutId)) {
			clearTimeout(resolutionBeatTimeoutId);
		}
	});

	const handlePick = (side: 'YES' | 'NO') => {
		// Only an open market accepts calls: expired/resolved short-circuit.
		if (!isLive) {
			return;
		}

		// Public market browse: `/markets/[id]` is exempted from the
		// (app)/+layout auth gate so signed-out visitors can preview a
		// market. Placing a call still requires a session, so we bounce
		// to /signin here at the point of action instead of opening the
		// TradeModal against a missing identity.
		if (!$userSignedIn) {
			void goto(resolve(PublicPath.SignIn));

			return;
		}

		selectedSide = side;
	};

	// Funnel the "predict" intent into Flow, where predictions are placed
	// (direct trading from the detail page is off). A signed-out visitor,
	// e.g. arriving from search, starts a free guest session first, the same
	// no-account preview the onboarding Skip path uses, so they can try
	// predicting immediately; the (app) gate exempts a guest on /flow.
	const onTryFlow = () => {
		if (!$userSignedIn) {
			startGuestSession(null);
		}

		void goto(resolveAppPath(AppPath.Flow));
	};
</script>

<svelte:head>
	<title
		>{market ? displayTitle : t({ locale: $localeStore, key: 'market.detail.fallback_title' })} | Vici
		{t({ locale: $localeStore, key: 'market.detail.head_suffix' })}</title
	>
</svelte:head>

<div class="market-detail-screen" class:market-detail-screen--readonly={!showTradeCta}>
	{#if loading}
		<MarketDetailSkeleton />
	{:else if market}
		{@const m = market}
		{#snippet detailRight()}
			<MarketDetailShareButton title={displayTitle} />
			<!-- Eye / "watch this market" save control. Same shared
			     toggle (and same watchlist backend) as the per-card
			     heart, here wearing the eye glyph and the faint ghost
			     header look so the three app-bar controls read as one
			     set. -->
			<SavedMarketToggle
				icon="eye"
				marketId={m.id}
				size="md"
				stopPropagation={false}
				variant="header-ghost"
			/>
		{/snippet}

		<ScreenHeader
			back={{
				label: t({ locale: $localeStore, key: 'market.detail.back_to_markets' }),
				onBack: () => goBack(resolveAppPath(AppPath.Home))
			}}
			right={detailRight}
		/>

		<section class="market-detail-hero">
			<div class="market-detail-chip-row">
				{#if nonNullish(primaryTag)}
					<span style:color={tagColor(primaryTag)} class="market-detail-tag">
						{categoryLabel({ category: primaryTag, variant: 'full', locale: $localeStore })}
					</span>
				{/if}
				{#if isLive}
					<MarketDetailLivePill />
				{:else if isResolved}
					{#if nonNullish(resolvedOutcome)}
						<!-- RESOLVED · YES/NO: the outcome colour spells out the
						     settled side at a glance, beyond the neutral status
						     badge. -->
						<span
							style:color={resolvedOutcome === 'YES' ? 'var(--yes)' : 'var(--no)'}
							class="market-detail-tag-outcome"
						>
							{t({ locale: $localeStore, key: 'status.resolved' })} · {resolvedOutcome === 'YES'
								? t({ locale: $localeStore, key: 'outcome.yes' })
								: t({ locale: $localeStore, key: 'outcome.no' })}
						</span>
					{:else}
						<span class="market-detail-tag-resolved">
							<OutcomeBadge status={market.status} />
						</span>
					{/if}
				{/if}
			</div>

			<h1 class="market-detail-title">{displayTitle}</h1>

			{#if nonNullish(activeTranslation)}
				<MarketTranslationToggle
					onToggle={onToggleTranslation}
					{showOriginal}
					{translatedLanguageLabel}
				/>
			{/if}

			{#if contextLine !== ''}
				<p class="market-detail-context">{contextLine}</p>
			{/if}

			<MarketDetailWhyNow {priorCall} {whyNow} />
		</section>

		{#if isResolved}
			<!-- Settled banner: closes the loop on the market side with a clear
			     "this is over, here's how it landed" panel tinted by the
			     winning side. Non-binary resolutions (e.g. CANCELED) have no
			     winning side, so the border stays neutral rather than
			     implying a YES win. -->
			<section
				style:border-color={resolvedOutcome === 'YES'
					? 'var(--yes)'
					: resolvedOutcome === 'NO'
						? 'var(--no)'
						: 'var(--border-strong)'}
				class="market-detail-settled"
				aria-label={t({ locale: $localeStore, key: 'market.detail.settled.eyebrow' })}
			>
				<span class="market-detail-settled-eyebrow">
					{t({ locale: $localeStore, key: 'market.detail.settled.eyebrow' })}
				</span>
				<p class="market-detail-settled-line">
					{#if nonNullish(resolvedOutcome)}
						{t({ locale: $localeStore, key: 'market.detail.settled.resolved_prefix' })}
						<b style:color={resolvedOutcome === 'YES' ? 'var(--yes)' : 'var(--no)'}>
							{resolvedOutcome === 'YES'
								? t({ locale: $localeStore, key: 'outcome.yes' })
								: t({ locale: $localeStore, key: 'outcome.no' })}
						</b>
					{:else}
						{t({ locale: $localeStore, key: 'market.detail.settled.resolved_generic' })}
					{/if}
				</p>
			</section>
		{/if}

		<MarketDetailProbHero
			known={oddsKnown}
			{noPercent}
			priceLoaded={market.priceLoaded}
			resolved={isResolved}
			{resolvedOutcome}
			{yesPercent}
		/>

		<MarketDetailChartCard
			marketId={market.id}
			onPeriodChange={(period) => (chartPeriod = period)}
			period={chartPeriod}
			pointXs={chartPriceHistory?.xs}
			points={chartPriceHistory?.yes}
			{yesPercent}
		/>

		<MarketDetailStatsGrid
			{market}
			{myCallLoading}
			{positions}
			{resolvedForMarket}
			volume={marketVolume}
		/>

		{#if isColdStart}
			<!-- Cold-start cue: a fresh market with no real volume yet.
			     Turns the empty state into an invitation rather than a wall
			     of zeros. -->
			<section class="market-detail-coldstart">
				<p class="market-detail-coldstart-line">
					<b>{t({ locale: $localeStore, key: 'market.detail.coldstart.lead' })}</b>
					{t({ locale: $localeStore, key: 'market.detail.coldstart.body' })}
				</p>
			</section>
		{:else if isLive}
			<!-- Maker-liquidity disclosure: once a live market has a line, say
			     where it comes from: a live order book that VICI's market maker
			     seeds with resting liquidity. Keeps a thin market from reading
			     as a crowd of phantom predictors. Gated to live markets (the
			     book is no longer the price source once resolved/expired) and
			     mutually exclusive with the cold-start cue (which itself only
			     fires for live markets). -->
			<p class="market-detail-maker-note">
				{t({ locale: $localeStore, key: 'market.detail.maker.disclosure' })}
			</p>
		{/if}

		<MarketDetailResolutionCard {market} resolution={displayResolution} />

		{#if !isColdStart}
			<!-- Hidden while the cold-start banner is up: a market with no
			     volume has no predictors, so an empty section under the
			     banner would only echo it. -->

			<MarketDetailTopPredictors {followedLean} {topPredictors} />
		{/if}

		{#if showAdminActions}
			<section
				class="market-detail-admin"
				aria-label={t({ locale: $localeStore, key: 'market.detail.admin_actions' })}
			>
				{#if canEditMetadata}
					<MarketMetadataForm canEdit {market} />
				{/if}

				{#if canResolve}
					<MarketResolutionInterface
						{market}
						onSettled={() => {
							if (nonNullish(market)) {
								fetchMarket({ id: market.id, silent: true });
							}
						}}
					/>
				{/if}
			</section>
		{/if}

		<!-- The detail page is a read-only depth view by default: the
		     probability, chart, and stats are on display, while predictions
		     are placed in Flow. The in-page YES/NO CTA bar (and its trade
		     sheet below) is preserved behind a build-time flag so direct
		     trading from the detail page can be restored by flipping it. It
		     only ever shows while the market is still taking calls: expired
		     and resolved markets never expose the actions. -->
		{#if showTradeCta}
			<MarketDetailCtaBar {noPercent} onPick={handlePick} {yesPercent} />
		{:else if isLive}
			<!-- Live market, direct-trade CTA off: predictions are placed in
			     Flow, so close the page with an action into Flow rather than a
			     read-only dead end. A signed-out visitor enters a free guest
			     session (see `onTryFlow`), so search traffic can try predicting
			     with no account. -->
			<div class="flex justify-center pt-1">
				<Button onclick={onTryFlow} variant="primary">
					{$userSignedIn
						? t({ locale: $localeStore, key: 'market.detail.flow_cta.member' })
						: t({ locale: $localeStore, key: 'market.detail.flow_cta.guest' })}
				</Button>
			</div>
		{:else}
			<!-- Read-only footer for a market no longer taking calls: a
			     resolved one states it has settled, an expired one notes it is
			     awaiting resolution. -->
			<p class="market-detail-closed-foot">
				{#if isResolved}
					{t({ locale: $localeStore, key: 'market.detail.readonly.settled' })}
				{:else}
					{t({ locale: $localeStore, key: 'market.detail.closed.expired' })}
				{/if}
			</p>
		{/if}

		{#if MARKET_DETAIL_DIRECT_TRADE_ENABLED && nonNullish(selectedSide)}
			<TradeModal
				{displayTitle}
				{market}
				onClose={() => (selectedSide = undefined)}
				{onPredictionPlaced}
				selectedOutcome={selectedSide}
			/>
		{/if}

		<MarketDetailLockedToast open={lockedToastOpen} />
	{:else}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<h1 class="text-foreground text-4xl font-extrabold">
				{t({ locale: $localeStore, key: 'market.detail.not_found.title' })}
			</h1>
			<p class="text-muted-foreground mt-4">
				{t({ locale: $localeStore, key: 'market.detail.not_found.sub' })}
			</p>
			<a
				class="bg-primary text-primary-foreground hover:bg-primary/90 mt-8 rounded-xl px-8 py-3 font-bold transition-all"
				href={resolveAppPath(AppPath.Home)}
			>
				{t({ locale: $localeStore, key: 'market.detail.not_found.cta' })}
			</a>
		</div>
	{/if}
</div>

<style lang="postcss">
	.market-detail-screen {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0;
		/* Leave room for the floating CTA bar and, when present, the
		   navpill it sits above. `--navpill-h` is injected by the (app)
		   layout: 88px when signed-in mobile, 0px for signed-out visitors
		   and desktop ≥56rem. The CTA bar itself is ~80px, so the bottom
		   pad is: safe-area + navpill + CTA (~5rem) + a little breathing
		   room. */
		padding: 0.25rem 0 calc(env(safe-area-inset-bottom, 0px) + var(--navpill-h, 0px) + 6rem);
	}

	/* Read-only depth view: no floating CTA bar, so the in-flow read-only
	   footer is the last element. Drop the CTA reservation and keep just
	   safe-area + navpill + a small footer margin, so there's no empty gap
	   below the footer. */
	.market-detail-screen--readonly {
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--navpill-h, 0px) + 2rem);
	}

	/* Scope the ghost header look to this detail app-bar only. The
	   global `.appbar-icon-btn` (shared by Profile, Settings, Wallet,
	   etc.) is a transparent borderless circle; here the back chevron
	   picks up a faint resting foreground wash and a softer rounded-rect
	   radius so it reads as one set with the share and save controls.
	   These two selectors are more specific than the base rule and so
	   keep winning. The fill is a foreground wash so it adapts across
	   themes. */
	.market-detail-screen :global(.appbar-icon-btn) {
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	.market-detail-screen :global(.appbar-icon-btn:hover) {
		background: color-mix(in srgb, var(--text-base) 11%, transparent);
	}

	.market-detail-hero {
		padding: 0.5rem 1.25rem 0;
	}

	.market-detail-chip-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	/* Category tag: no background, no border, just coloured text.
	   A bare text chip so the title gets all the visual weight. */
	.market-detail-tag {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-detail-tag-resolved {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
	}

	/* RESOLVED · YES/NO chip: bare coloured text (no fill/border) so it
	   sits in the chip row like the category tag, with the outcome colour
	   carrying the meaning. */
	.market-detail-tag-outcome {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	/* Settled banner: framed panel directly under the hero, its border
	   tinted by the winning side so the resolution reads at a glance. */
	.market-detail-settled {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0.75rem 1.25rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--yes);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		box-shadow: var(--inset-hi);
	}

	.market-detail-settled-eyebrow {
		color: var(--fg-dim);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-detail-settled-line {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 600;
	}

	/* Cold-start cue: soft laurel-washed panel that frames an empty
	   market as an opportunity to set the first line. */
	.market-detail-coldstart {
		margin: 0 1.25rem 0.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid color-mix(in srgb, var(--laurel) 30%, var(--border-base));
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--laurel) 8%, transparent);
	}

	.market-detail-coldstart-line {
		margin: 0;
		color: var(--fg-dim);
		font-size: var(--t-13);
		line-height: 1.45;
	}

	.market-detail-coldstart-line b {
		color: var(--text-base);
		font-weight: 700;
	}

	/* Maker-liquidity disclosure: a quiet caption, not a stat. Sits under
	   the stats grid to answer "how is this priced" without competing with
	   the numbers above it. */
	.market-detail-maker-note {
		margin: 0 1.25rem 0.5rem;
		color: var(--text-muted);
		font-size: var(--t-12);
		line-height: 1.45;
	}

	/* No-longer-trading footer: quiet centred note that stands in for the
	   CTA bar on expired / resolved markets. */
	.market-detail-closed-foot {
		margin: 1rem 1.25rem 0;
		color: var(--text-muted);
		font-size: var(--t-12);
		text-align: center;
	}

	.market-detail-title {
		margin: 0.625rem 0 0;
		color: var(--text-base);
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.22;
	}

	/* Editorial context line under the title: the question's one-line
	   framing (e.g. "Hex contenders · 17.9% favorite"). Dimmed body
	   copy so the title keeps the visual weight. */
	.market-detail-context {
		margin: 0.375rem 0 0;
		color: var(--fg-dim);
		font-size: var(--t-13);
		line-height: 1.45;
	}

	.market-detail-admin {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin: 1rem 1.25rem 0;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border-base);
	}

	@media (min-width: 768px) {
		.market-detail-title {
			font-size: 1.75rem;
		}
	}

	/* On desktop (≥56rem) the navpill is hidden and the CTA bar sits at a
	   fixed 2rem from the bottom, so the scroll clearance only needs to
	   accommodate the CTA bar height plus a standard margin. */
	@media (min-width: 56rem) {
		.market-detail-screen {
			padding-bottom: 8rem;
		}

		/* No floating CTA bar in the read-only view, so the desktop
		   clearance collapses to a standard bottom margin. */
		.market-detail-screen--readonly {
			padding-bottom: 2rem;
		}
	}
</style>
