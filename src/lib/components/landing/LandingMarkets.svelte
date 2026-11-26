<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import { tick, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import LandingMarketsChips from '#lib/components/landing/LandingMarketsChips.svelte';
	import LandingMarketsDetail from '#lib/components/landing/LandingMarketsDetail.svelte';
	import LandingMarketsLead from '#lib/components/landing/LandingMarketsLead.svelte';
	import LandingMarketsNote from '#lib/components/landing/LandingMarketsNote.svelte';
	import LandingMarketsPanel from '#lib/components/landing/LandingMarketsPanel.svelte';
	import LandingMarketsRow from '#lib/components/landing/LandingMarketsRow.svelte';
	import LandingMarketsSearch from '#lib/components/landing/LandingMarketsSearch.svelte';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import {
		classificationMacros,
		MACRO_IDS,
		primaryMacro,
		type MacroId
	} from '#lib/constants/market-taxonomy.constants.ts';
	import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
	import { VXP_DEFAULT_CALL_SIZE } from '#lib/constants/vxp-economy.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { minuteTick_ms } from '#lib/derived/time.derived.ts';
	import { listMarketTagsBySeries } from '#lib/services/market-tags.services.ts';
	import { loadMarketsProgressive } from '#lib/services/market.services.ts';
	import { loadMarketPriceCandles } from '#lib/services/trade.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import {
		hydrate as hydrateMarketTranslations,
		marketTranslations
	} from '#lib/stores/market-translations.store.ts';
	import type { LandingCallSide, LandingMarketsCall } from '#lib/types/landing-call.ts';
	import type { Market } from '#lib/types/market.ts';
	import { resolveFlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		callableMarkets,
		compareBySoonest,
		matchesSearchQuery,
		pickTrendingMarket,
		sidePercents
	} from '#lib/utils/landing-markets.utils.ts';
	import { dailyPriceMove } from '#lib/utils/landing-price-chart.utils.ts';
	import { priceHistoryQueryWindow } from '#lib/utils/market-price-history.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { marketDisplayText } from '#lib/utils/market-translation.utils.ts';

	/**
	 * The landing Markets view: every open market on real data, for a
	 * signed-out visitor. A "Trending" lead (the most traded market), the
	 * list soonest-to-settle first, search and categories, and a detail
	 * with the draggable price chart and the call size. It places no order:
	 * Yes / No hand a {@link LandingMarketsCall} to the page through
	 * `oncall`, and the claim note calls `onclaim`. `focusSeriesId` opens a
	 * market's detail. It fills its positioned parent; the page's top bar
	 * floats over its first 72px (124px on phones), where the search sits.
	 */
	interface Props {
		oncall?: (call: LandingMarketsCall) => void;
		onclaim?: () => void;
		/** Escape with nothing left to dismiss (no sheet, empty search). */
		onclose?: () => void;
		focusSeriesId?: string;
	}

	const {
		oncall = () => {},
		onclaim = () => {},
		onclose = () => {},
		focusSeriesId
	}: Props = $props();

	const uid = $props.id();
	const detailId = `${uid}-detail`;
	const titleId = `${uid}-title`;

	const phone = new MediaQuery('(max-width: 900px)');

	let allMarkets = $state<Market[] | undefined>(undefined);
	let tagsById = $state<Record<string, string[]>>({});
	let query = $state('');
	let category = $state<MacroId | undefined>(undefined);
	let selectedId = $state<string | undefined>(undefined);
	let size = $state<number>(VXP_DEFAULT_CALL_SIZE);
	let searchInput: HTMLInputElement | undefined;
	let listEl = $state<HTMLElement | undefined>(undefined);

	// Prices refresh on the shared minute tick. Each run carries the last set
	// forward so rows keep their price while the books are re-read, and a
	// newer run retires the one before it.
	$effect(() => {
		void $minuteTick_ms;

		let stale = false;

		void loadMarketsProgressive({
			domain: get(balanceDomain),
			previous: untrack(() => allMarkets),
			onUpdate: (markets) => {
				allMarkets = markets;
			},
			isStale: () => stale
		}).catch(() => {
			// An unreadable catalog reads as "nothing open", never a skeleton forever.
			allMarkets ??= [];
		});

		return () => {
			stale = true;
		};
	});

	$effect(() => {
		let stale = false;

		// Tags only add categories, search terms and art; the view works without them.
		void listMarketTagsBySeries()
			.then((tags) => {
				if (!stale) {
					tagsById = tags;
				}
			})
			.catch(() => {});

		return () => {
			stale = true;
		};
	});

	const nowMs = $derived($minuteTick_ms);
	const open = $derived(
		isNullish(allMarkets) ? [] : callableMarkets({ markets: allMarkets, nowMs })
	);
	const trending = $derived(pickTrendingMarket(open));

	const tagsOf = (id: string): string[] => tagsById[id] ?? [];
	const macrosOf = (id: string): MacroId[] => classificationMacros(tagsOf(id));

	const categories = $derived(
		MACRO_IDS.filter((macro) => open.some(({ id }) => macrosOf(id).includes(macro)))
	);

	$effect(() => {
		const ids = open.map(({ id }) => id);

		if (ids.length > 0) {
			void hydrateMarketTranslations(ids);
		}
	});

	const display = (market: Market) =>
		marketDisplayText({
			market,
			translation: $marketTranslations.get(market.id),
			showOriginal: $marketLanguagePreference === 'original'
		});

	const labelOf = (macro: MacroId): string =>
		categoryLabel({ category: macro, variant: 'full', locale: $localeStore });

	const filtering = $derived(nonNullish(category) || notEmptyString(query.trim()));

	const listed = $derived(
		open
			.filter((market) =>
				filtering
					? (isNullish(category) || macrosOf(market.id).includes(category)) &&
						matchesSearchQuery({
							texts: [display(market).title, market.title, ...macrosOf(market.id).map(labelOf)],
							query
						})
					: market.id !== trending?.id
			)
			.sort(compareBySoonest)
	);

	const lead = $derived(filtering ? undefined : trending);
	const leadMacro = $derived(nonNullish(lead) ? primaryMacro(tagsOf(lead.id)) : undefined);

	// Wide screens always show a detail (the lead's until a row is picked);
	// phones show one only as a sheet the visitor opened.
	const detailMarket = $derived(
		open.find(({ id }) => id === (selectedId ?? (phone.current ? undefined : trending?.id)))
	);
	const sheetOpen = $derived(phone.current && nonNullish(detailMarket));

	// The sheet keeps its last market on screen while it slides away.
	let lastDetail = $state<Market | undefined>(undefined);

	$effect(() => {
		if (nonNullish(detailMarket)) {
			lastDetail = detailMarket;
		}
	});

	const panelMarket = $derived(detailMarket ?? (phone.current ? lastDetail : undefined));

	const select = (id: string): void => {
		selectedId = id;
	};

	const closeSheet = async (): Promise<void> => {
		const id = selectedId;
		selectedId = undefined;

		await tick();
		listEl
			?.querySelector<HTMLElement>(`[data-series-id="${CSS.escape(id ?? '')}"]`)
			?.focus({ preventScroll: true });
	};

	// The page floats a deck card into Markets by naming its series: open that
	// market's detail once it is listed, then leave the visitor in charge.
	let focusedFor: string | undefined;

	$effect(() => {
		const id = focusSeriesId;

		if (nonNullish(id) && id !== focusedFor && open.some((market) => market.id === id)) {
			focusedFor = id;
			untrack(() => select(id));
		}
	});

	// Last-week history for the lead and the open detail: enough to tell
	// today's move.
	interface DayHistory {
		yes: number[];
		xs: number[];
		windowStartMs: number;
		windowEndMs: number;
	}

	let histories = $state<Record<string, DayHistory>>({});
	// Plain bookkeeping, not state: a series is asked for once per mount.
	const requestedHistories: Record<string, true> = {};

	const requestHistory = (seriesId: string): void => {
		if (requestedHistories[seriesId]) {
			return;
		}

		requestedHistories[seriesId] = true;

		const { startTimeNs, endTimeNs } = priceHistoryQueryWindow('7d');
		const windowEndMs = Number(endTimeNs / MILLISECOND_IN_NANOSECONDS);
		const windowStartMs = Number((startTimeNs ?? endTimeNs) / MILLISECOND_IN_NANOSECONDS);

		void loadMarketPriceCandles({
			seriesId,
			period: '7d',
			onLoad: ({ response: { yes, xs } }) => {
				histories[seriesId] = { yes, xs, windowStartMs, windowEndMs };
			}
		});
	};

	$effect(() => {
		[trending?.id, detailMarket?.id].filter(nonNullish).forEach(requestHistory);
	});

	const moveOf = (market: Market): number | undefined => {
		const history = histories[market.id];

		return isNullish(history)
			? undefined
			: dailyPriceMove({ ...history, livePercent: sidePercents(market.yesProbability)?.yes });
	};

	const artOf = (market: Market) =>
		resolveFlowArtCategory({ tags: tagsOf(market.id), seed: market.id });

	const call = ({ market, side }: { market: Market; side: LandingCallSide }): void => {
		const percents = sidePercents(market.yesProbability);

		if (isNullish(percents)) {
			return;
		}

		oncall({
			seriesId: market.id,
			side,
			pricePercent: side === 'yes' ? percents.yes : percents.no,
			amountVxp: size,
			atMs: Date.now()
		});
	};

	const isTypingTarget = (target: EventTarget | null): boolean =>
		target instanceof HTMLElement &&
		(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

	const onWindowKeydown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented) {
			return;
		}

		if (event.key === '/' && !isTypingTarget(event.target)) {
			event.preventDefault();
			searchInput?.focus();

			return;
		}

		if (event.key !== 'Escape') {
			return;
		}

		if (sheetOpen) {
			void closeSheet();
		} else if (event.target === searchInput && notEmptyString(query)) {
			query = '';
		} else {
			onclose();
		}
	};

	// Arrow keys walk the rows, as in any list.
	const onListKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
			return;
		}

		const rows = [...(listEl?.querySelectorAll<HTMLElement>('[data-series-id]') ?? [])];
		const from = rows.indexOf(event.target as HTMLElement);

		if (from < 0) {
			return;
		}

		event.preventDefault();
		rows[
			Math.max(0, Math.min(rows.length - 1, from + (event.key === 'ArrowDown' ? 1 : -1)))
		]?.focus();
	};
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="lm">
	{#if nonNullish(trending)}
		<div class="lm-ground" aria-hidden="true">
			<MarketArtwork bleed category={artOf(trending)} fill seed={trending.id} size={240} />
		</div>
	{/if}

	<LandingMarketsSearch
		onquery={(value) => (query = value)}
		onready={(input) => (searchInput = input)}
		{query}
	/>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={listEl} class="lm-main" onkeydown={onListKeydown}>
		<div class="lm-wrap">
			{#if categories.length > 0}
				<LandingMarketsChips
					{categories}
					onselect={(value) => (category = value)}
					selected={category}
				/>
			{/if}

			{#if isNullish(allMarkets)}
				<div class="lm-skeleton is-lead" aria-busy="true"></div>
				{#each [0, 1, 2, 3, 4] as row (row)}
					<div class="lm-skeleton" aria-hidden="true"></div>
				{/each}
			{:else}
				{#if nonNullish(lead)}
					<section class="lm-top" aria-labelledby="{uid}-trending">
						<h2 id="{uid}-trending" class="lm-heading">
							{t({ locale: $localeStore, key: 'markets.section.trending' })}
						</h2>
						<LandingMarketsLead
							artCategory={artOf(lead)}
							categoryLabel={nonNullish(leadMacro) ? labelOf(leadMacro) : undefined}
							{detailId}
							market={lead}
							move={moveOf(lead)}
							{nowMs}
							oncall={(side) => call({ market: lead, side })}
							onselect={() => select(lead.id)}
							selected={detailMarket?.id === lead.id}
							{size}
							title={display(lead).title}
						/>
					</section>
				{/if}

				{#if listed.length > 0}
					<ul class="lm-list" aria-label={t({ locale: $localeStore, key: 'landing.markets.list' })}>
						{#each listed as market, index (market.id)}
							<LandingMarketsRow
								artCategory={artOf(market)}
								{detailId}
								{index}
								{market}
								{nowMs}
								oncall={(side) => call({ market, side })}
								onselect={() => select(market.id)}
								selected={detailMarket?.id === market.id}
								title={display(market).title}
							/>
						{/each}
					</ul>
				{:else if isNullish(lead)}
					<p class="lm-none" role="status">
						{t({
							locale: $localeStore,
							key: filtering ? 'landing.markets.no_match' : 'landing.markets.none_open'
						})}
					</p>
				{/if}

				<LandingMarketsNote {onclaim} />
			{/if}
		</div>
	</div>

	{#if nonNullish(panelMarket)}
		<LandingMarketsPanel
			id={detailId}
			onclose={closeSheet}
			open={sheetOpen}
			sheet={phone.current}
			{titleId}
		>
			<LandingMarketsDetail
				market={panelMarket}
				move={moveOf(panelMarket)}
				{nowMs}
				oncall={(side) => call({ market: panelMarket, side })}
				onclose={phone.current ? closeSheet : undefined}
				onsizechange={(value) => (size = value)}
				resolution={display(panelMarket).resolution}
				{size}
				title={display(panelMarket).title}
				{titleId}
			/>
		</LandingMarketsPanel>
	{/if}
</div>

<style lang="postcss">
	.lm {
		--lm-pad: clamp(16px, 3vw, 32px);
		--lm-top: calc(72px + env(safe-area-inset-top, 0px));
		--lm-quiet: color-mix(in srgb, var(--parchment) 64%, transparent);
		--lm-line: color-mix(in srgb, var(--parchment) 10%, transparent);
		--lm-pane-a: color-mix(in srgb, var(--parchment) 7%, transparent);
		--lm-ring:
			inset 0 1px 0 color-mix(in srgb, var(--parchment) 24%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--parchment) 8%, transparent);
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
		grid-template-rows: minmax(0, 1fr);
		overflow: hidden;
		isolation: isolate;
		background: var(--ink);
		color: var(--parchment);
		font-family: var(--font-display);
		color-scheme: dark;
	}

	/* The lead's art, blurred into the ground, gives the glass a colour to pick up. */
	.lm-ground {
		position: absolute;
		inset: -90px;
		z-index: -1;
		opacity: 0.75;
		filter: blur(70px) saturate(160%);
		pointer-events: none;
		container-type: size;
	}

	/* The art is square: size it to the larger side and centre it, so it
	   covers the frame like a poster instead of letterboxing. */
	.lm-ground :global(.market-artwork) {
		position: absolute;
		top: 50%;
		left: 50%;
		width: max(100cqw, 100cqh);
		height: max(100cqw, 100cqh);
		translate: -50% -50%;
	}

	.lm::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--ink) 50%, transparent) 0%,
			color-mix(in srgb, var(--ink) 74%, transparent) 46%,
			color-mix(in srgb, var(--ink) 90%, transparent) 100%
		);
		pointer-events: none;
	}

	.lm-main {
		min-height: 0;
		padding: calc(var(--lm-top) + 10px) 12px calc(20px + var(--docked-footer-inset))
			calc(var(--lm-pad) - 2px);
		overflow: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		scrollbar-width: none;
		mask-image: linear-gradient(
			180deg,
			transparent 0,
			transparent calc(env(safe-area-inset-top, 0px) + 34px),
			var(--ink) calc(var(--lm-top) + 2px)
		);
	}

	.lm-main::-webkit-scrollbar {
		display: none;
	}

	.lm-wrap {
		display: grid;
		align-content: start;
		gap: 12px;
	}

	.lm-top {
		display: grid;
		gap: 20px;
	}

	.lm-heading {
		margin: 0 0 -6px;
		font: 700 18px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.02em;
	}

	.lm-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.lm-none {
		margin: 0;
		padding: 28px 12px;
		font: 500 15px/1.4 var(--font-display);
		color: var(--lm-quiet);
	}

	.lm-skeleton {
		height: 64px;
		border-radius: 18px;
		background: var(--lm-pane-a);
		opacity: 0.6;
	}

	.lm-skeleton.is-lead {
		height: 220px;
		border-radius: 24px;
	}

	@media (min-width: 901px) and (max-width: 1240px) {
		.lm {
			grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
		}
	}

	@media (max-width: 900px) {
		.lm {
			--lm-top: calc(124px + env(safe-area-inset-top, 0px));
			grid-template-columns: minmax(0, 1fr);
		}

		.lm-main {
			padding-right: var(--lm-pad);
			padding-left: var(--lm-pad);
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lm-ground {
			display: none;
		}

		.lm::after {
			background: var(--ink);
		}

		.lm-main {
			mask-image: none;
		}
	}

	@media (prefers-contrast: more) {
		.lm {
			--lm-ring: inset 0 0 0 1px color-mix(in srgb, var(--parchment) 50%, transparent);
		}

		.lm-ground {
			display: none;
		}
	}
</style>
