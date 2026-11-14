<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import MarketsBeyondCupCard from '#lib/components/market/MarketsBeyondCupCard.svelte';
	import MarketsCarousel from '#lib/components/market/MarketsCarousel.svelte';
	import MarketsCategoryChips from '#lib/components/market/MarketsCategoryChips.svelte';
	import MarketsListRow from '#lib/components/market/MarketsListRow.svelte';
	import WorldCupRecapCard from '#lib/components/market/WorldCupRecapCard.svelte';
	import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import {
		classificationMacros,
		classificationMicros,
		primaryMicro,
		type MacroId,
		type MicroId
	} from '#lib/constants/market-taxonomy.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { marketTags, marketTagsNotInitialized } from '#lib/derived/market-tags.derived.ts';
	import { markets, marketsNotInitialized } from '#lib/derived/markets.derived.ts';
	import { minuteTick_ms } from '#lib/derived/time.derived.ts';
	import { worldCupPhase } from '#lib/derived/world-cup.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { hydrate as hydrateMarketTranslations } from '#lib/stores/market-translations.store.ts';
	import { preferencesStore } from '#lib/stores/preferences.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { filterScheduledWcMarkets } from '#lib/utils/wc-schedule.utils.ts';

	/**
	 * Markets screen: a section-based board with a category browse nav. The
	 * macro bar (+ micro sub-chips) filters every board section; the World-Cup
	 * arc chrome (eyebrow, recap, and the "Beyond the Cup" skill gate,
	 * `MarketsBeyondCupCard`) still rides on top. The board itself is three
	 * sections: Saved (the viewer's watchlist), Resolving soon (the
	 * soonest-closing available lines), and Available predictions.
	 *
	 * Placing a call happens in Flow; this board has no buy path; rows deep-link
	 * to market detail. Saved-ids persist under `vici.saved-markets` via
	 * `$preferencesStore.savedMarketIds`.
	 */

	// A market counts as "resolving soon" when it closes within this window.
	// Our market type has no curated `fast` flag, so we proxy it by closeness to
	// the `expiryDate`: the soonest-closing lines surface first, framing the
	// board as "what settles soon" for new users.
	const RESOLVING_SOON_WINDOW_MS = 7 * DAY_IN_MS;
	const TRENDING_LIMIT = 8;

	// The retention-arc phase drives the WC chrome live. `wc-focus` / `bridge`
	// keep the laser focus on the World Cup; `open` (the Cup resolved) and `off`
	// widen the board to every category (there's no focused event to anchor on).
	const phase = $derived($worldCupPhase);
	const wcFocus = $derived(phase === 'wc-focus' || phase === 'bridge');
	const isOpen = $derived(phase === 'open');

	// Header context eyebrow: the featured event, surfaced as a mono-uppercase
	// eyebrow line (matching the Dash accuracy / Arena standing eyebrow) while
	// the board is laser-focused on it. Omitted once no event is in focus
	// (`open` / `off`).
	const eventEyebrow = $derived(
		wcFocus ? t({ locale: $localeStore, key: 'markets.wc_eyebrow' }) : undefined
	);

	// Loading covers both feeds the board depends on: the markets list and the
	// tag metadata. Tags are required in *every* phase now, not just World-Cup
	// focus: the discovery feeds (available + trending) run through the WC
	// release schedule, which identifies WC markets by tag: an empty tag map
	// would make every market look non-WC and let unreleased WC markets leak in.
	// Without the guard the board also flashes the "no markets" empty state over
	// loaded markets while tags fetch. Tags load globally in the (app) shell and
	// resolve to `{}` even on failure, so this never stalls.
	const loading = $derived($marketsNotInitialized || $marketTagsNotInitialized);

	const savedSet = $derived(new Set($preferencesStore.savedMarketIds));
	// Saved = the viewer's watchlist, kept even if an entry isn't World Cup.
	const savedMarkets = $derived($markets.filter((m) => savedSet.has(m.id)));

	const tagsByMarket = $derived($marketTags);

	// Category browse selection. `undefined` macro = the "All" board;
	// selecting a macro narrows to it and (optionally) to one of its micros.
	let selectedMacro = $state<MacroId | undefined>(undefined);
	let selectedMicro = $state<MicroId | undefined>(undefined);

	const onSelectMacro = (macro: MacroId | undefined): void => {
		selectedMacro = macro;
		// A macro switch resets any drilled-in micro so the sub-filter never
		// dangles under a different (or the "All") macro.
		selectedMicro = undefined;
	};

	const onSelectMicro = (micro: MicroId | undefined): void => {
		selectedMicro = micro;
	};

	// Does a market pass the active category selection? Micro wins when set;
	// otherwise the macro; otherwise (All) everything passes.
	const matchesSelection = (market: Market): boolean => {
		const tags = tagsByMarket[market.id] ?? [];

		if (nonNullish(selectedMicro)) {
			return classificationMicros(tags).includes(selectedMicro);
		}

		if (nonNullish(selectedMacro)) {
			return classificationMacros(tags).includes(selectedMacro);
		}

		return true;
	};

	// Release gating: any scheduled market surfaces only once its on-chain
	// trading start (`start_ns`) has arrived; markets with no start are live.
	// Applied to the discovery feeds (available + trending) below; the viewer's
	// explicit Saved watchlist is intentionally left ungated. Re-derives on the
	// minute tick so a market appears the moment its release lands.
	const visibleMarkets = $derived(
		filterScheduledWcMarkets({ markets: $markets, tagsByMarket, now: $minuteTick_ms })
	);

	// Volume-sort helper: the same trending signal the carousel uses, applied
	// to give a stable deck that doesn't reshuffle as the user scans it.
	// eslint-disable-next-line local-rules/prefer-object-params -- Array.sort comparators take two positional args by contract
	const byVolumeDesc = (a: Market, b: Market): number => {
		if (b.totalVolume === a.totalVolume) {
			return 0;
		}

		return b.totalVolume > a.totalVolume ? 1 : -1;
	};

	// The "available" board: every open (callable) line, narrowed by the
	// active category selection. Listing only `Open` lines matches the section
	// label and the Open-only Trending rail, so resolved / expired markets
	// never surface under "Available predictions". The board is volume-sorted
	// for a stable deck that doesn't reshuffle as the user scans it.
	const availableMarkets = $derived.by((): Market[] =>
		[...visibleMarkets.filter((m) => m.status === 'Open' && matchesSelection(m))].sort(byVolumeDesc)
	);

	// Resolving soon: available lines closing within the window, soonest first.
	const resolvingSoon = $derived.by((): Market[] => {
		const now = $minuteTick_ms;

		return availableMarkets
			.filter((m) => {
				const expiry = Number(m.expiryDate);

				return expiry > now && expiry - now <= RESOLVING_SOON_WINDOW_MS;
			})
			.sort((a, b) => Number(a.expiryDate) - Number(b.expiryDate));
	});

	const resolvingSoonIds = $derived(new Set(resolvingSoon.map((m) => m.id)));

	// Available predictions: the rest of the available board (everything not
	// already surfaced in "Resolving soon"), volume-sorted.
	const restMarkets = $derived(
		[...availableMarkets].filter((m) => !resolvingSoonIds.has(m.id)).sort(byVolumeDesc)
	);

	// Trending rail: highest-volume open markets within the active category
	// selection. Our backend carries no curated "hot" flag, so volume is the
	// proxy.
	const trendingMarkets = $derived(
		[...visibleMarkets]
			.filter((m) => m.status === 'Open' && matchesSelection(m))
			.sort(byVolumeDesc)
			.slice(0, TRENDING_LIMIT)
	);

	// Every market with a row on the board, deduped. Drives one bulk
	// translation read for the whole page so each card resolves its overlay
	// from cache instead of firing its own per-series fetch (the N+1 the
	// detail-page spec called out).
	const visibleSeriesIds = $derived([
		...new Set([
			...savedMarkets.map((m) => m.id),
			...trendingMarkets.map((m) => m.id),
			...resolvingSoon.map((m) => m.id),
			...restMarkets.map((m) => m.id)
		])
	]);

	$effect(() => {
		if (visibleSeriesIds.length > 0) {
			void hydrateMarketTranslations(visibleSeriesIds);
		}
	});

	// "See all" on the trending rail scrolls to the main list rather than a
	// separate route; the list is sorted by the same volume signal.
	let mainListEl: HTMLElement | undefined = $state();

	const scrollToMainList = (): void => {
		mainListEl?.scrollIntoView({
			behavior: prefersReducedMotion() ? 'auto' : 'smooth',
			block: 'start'
		});
	};
</script>

<div class="screen-scroll" data-tid={TestId.MarketFeed}>
	<!-- Header context eyebrow: the featured event as a mono-uppercase eyebrow
	     line, matching the Dash / Arena eyebrow treatment, omitted entirely
	     once no event is in focus. -->
	{#if eventEyebrow}
		<div class="markets-eyebrow-row">
			<span class="markets-eyebrow">{eventEyebrow}</span>
		</div>
	{/if}

	<!-- `open` phase: the Cup has resolved. Recap the viewer's World-Cup run at
	     the top of the board and convert it into broader play. -->
	{#if isOpen}
		<WorldCupRecapCard onExplore={scrollToMainList} />
	{/if}

	<!-- Beyond the Cup: the skill-gate unlock goal, surfaced high. -->
	<MarketsBeyondCupCard
		markets={$markets}
		{tagsByMarket}
		tagsInitialized={!$marketTagsNotInitialized}
	/>

	<!-- Category browse nav: macro bar + micro sub-chips (populated only). -->
	<MarketsCategoryChips {onSelectMacro} {onSelectMicro} {selectedMacro} {selectedMicro} />

	<!-- Trending rail. -->
	{#if trendingMarkets.length > 0}
		<MarketsCarousel
			markets={trendingMarkets}
			moreLabel={t({ locale: $localeStore, key: 'markets.see_all' })}
			onMore={scrollToMainList}
			tagsBySeries={tagsByMarket}
			title={t({ locale: $localeStore, key: 'markets.section.trending' })}
		/>
	{/if}

	<!-- Saved (primary): the viewer's watchlist. -->
	<div class="section-h">
		<h3>{t({ locale: $localeStore, key: 'markets.section.saved' })}</h3>
		<span class="mute t-sub">{savedMarkets.length}</span>
	</div>
	{#if loading}
		<!-- Suppress the "nothing saved yet" card while markets load: saved IDs
		     may exist but their markets haven't resolved into the list yet. -->
		<div style="gap: 8px; padding: 0 20px 20px;" class="col">
			{#each Array(2) as _, index (index)}
				<div
					style="height: 88px; border: 1px dashed var(--border-base); border-radius: 12px; opacity: 0.7;"
					aria-hidden="true"
					data-tid={TestId.MarketCardSkeleton}
				></div>
			{/each}
		</div>
	{:else if savedMarkets.length === 0}
		<div style="margin: 4px 20px 20px;" class="card-empty">
			<span class="c-eyebrow">{t({ locale: $localeStore, key: 'markets.section.saved' })}</span>
			<span style="line-height: 1.25;" class="c-title"
				>{t({ locale: $localeStore, key: 'markets.saved_empty.title' })}</span
			>
			<p class="c-body">
				{t({ locale: $localeStore, key: 'markets.saved_empty.body' })}
			</p>
		</div>
	{:else}
		<div style="gap: 0; padding: 0 20px 20px;" class="col">
			{#each savedMarkets as m (m.id)}
				<MarketsListRow market={m} tag={primaryMicro(tagsByMarket[m.id] ?? [])} />
			{/each}
		</div>
	{/if}

	<!-- Resolving soon: the soonest-closing available lines first. -->
	{#if resolvingSoon.length > 0}
		<div class="section-h">
			<h3>{t({ locale: $localeStore, key: 'markets.section.resolving_soon' })}</h3>
			<span class="mute t-sub">{resolvingSoon.length}</span>
		</div>
		<div style="gap: 0; padding: 0 20px 20px;" class="col">
			{#each resolvingSoon as m (m.id)}
				<MarketsListRow market={m} tag={primaryMicro(tagsByMarket[m.id] ?? [])} />
			{/each}
		</div>
	{/if}

	<!-- Available predictions: the rest of the available board. -->
	<div bind:this={mainListEl} style="scroll-margin-top: 12px;" class="section-h">
		<h3>{t({ locale: $localeStore, key: 'markets.section.available' })}</h3>
		<span class="mute t-sub">{restMarkets.length}</span>
	</div>

	{#if loading}
		<div style="gap: 8px; padding: 0 20px 20px;" class="col">
			{#each Array(4) as _, index (index)}
				<div
					style="height: 88px; border: 1px dashed var(--border-base); border-radius: 12px; opacity: 0.7;"
					aria-hidden="true"
					data-tid={TestId.MarketCardSkeleton}
				></div>
			{/each}
		</div>
	{:else if restMarkets.length === 0}
		<div style="margin: 0 20px 20px;" class="card-empty">
			<p class="c-body">
				{t({ locale: $localeStore, key: 'markets.empty' })}
			</p>
		</div>
	{:else}
		<div style="gap: 0; padding: 0 20px calc(96px + env(safe-area-inset-bottom, 0px));" class="col">
			{#each restMarkets as m (m.id)}
				<MarketsListRow market={m} tag={primaryMicro(tagsByMarket[m.id] ?? [])} />
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	/* Featured-event eyebrow row: sits where the header bar would, padded to
	   the screen edge so it lines up with the section headers below. */
	.markets-eyebrow-row {
		padding: 10px var(--spacing-edge);
	}

	/* Mono-uppercase eyebrow matching the Dash accuracy / Arena standing
	   eyebrow treatment, so the World Cup context reads as a section eyebrow
	   rather than a pill chip. */
	.markets-eyebrow {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
</style>
