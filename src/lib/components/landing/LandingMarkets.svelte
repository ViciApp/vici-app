<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import { tick, untrack, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import LandingMarketsBoard from '#lib/components/landing/LandingMarketsBoard.svelte';
	import LandingMarketsDetail from '#lib/components/landing/LandingMarketsDetail.svelte';
	import LandingMarketsFilters from '#lib/components/landing/LandingMarketsFilters.svelte';
	import LandingMarketsGround from '#lib/components/landing/LandingMarketsGround.svelte';
	import LandingMarketsLoader from '#lib/components/landing/LandingMarketsLoader.svelte';
	import LandingMarketsNote from '#lib/components/landing/LandingMarketsNote.svelte';
	import LandingMarketsPanel from '#lib/components/landing/LandingMarketsPanel.svelte';
	import LandingMarketsSearch from '#lib/components/landing/LandingMarketsSearch.svelte';
	import {
		LANDING_MARKETS_DEFAULT_LAYOUT,
		LANDING_MARKETS_LAYOUT_STORAGE_KEY,
		LANDING_MARKETS_LAYOUTS,
		LANDING_MOVERS_CANDIDATES,
		LANDING_MOVERS_LIMIT,
		type LandingMarketsLayout
	} from '#lib/constants/landing-markets.constants.ts';
	import {
		classificationMacros,
		MACRO_IDS,
		primaryMacro,
		type MacroId
	} from '#lib/constants/market-taxonomy.constants.ts';
	import { VXP_DEFAULT_CALL_SIZE } from '#lib/constants/vxp-economy.constants.ts';
	import { minuteTick_ms } from '#lib/derived/time.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import {
		hydrate as hydrateMarketTranslations,
		marketTranslations
	} from '#lib/stores/market-translations.store.ts';
	import type {
		LandingCall,
		LandingCallSide,
		LandingMarketsCall
	} from '#lib/types/landing-call.ts';
	import type {
		LandingMarketsCalled,
		LandingMarketsHistory,
		LandingMarketsView
	} from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { resolveFlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import {
		callableMarkets,
		compareBySoonest,
		groupBySettlement,
		matchesSearchQuery,
		pickMovers,
		pickTrendingMarket,
		sidePercents
	} from '#lib/utils/landing-markets.utils.ts';
	import { priceMove24h } from '#lib/utils/market-price-move.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { marketDisplayText } from '#lib/utils/market-translation.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { get as getStored, set as setStored } from '#lib/utils/storage.utils.ts';
	import { vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	/**
	 * The landing Markets view: every open market on real data, for a
	 * signed-out visitor. The front page (the default, and the only layout on
	 * phones): the most traded market as the lead, "Moving now", the list in
	 * sections by when markets settle, a row opening in place with the call
	 * confirmed in the row. On wide screens a switch offers the table: the
	 * list with a side panel. It places no order: a confirmed call goes to the
	 * page through `oncall` and the claim through `onclaim`; after one call,
	 * further calls lead to the claim. `focusSeriesId` makes a market the lead
	 * (a deck card floating in, landing on the lead's artwork,
	 * `[data-landing-markets-lead-art]`); `calls` shows calls already made
	 * elsewhere on the page. It fills its positioned parent; the page's top bar floats
	 * over its first 72px (124px on phones), where the search sits.
	 */
	interface Props {
		oncall?: (call: LandingMarketsCall) => void;
		onclaim?: () => void;
		/** Escape with nothing left to dismiss (no pending call, empty search). */
		onclose?: () => void;
		focusSeriesId?: string;
		calls?: LandingCall[];
		/** A market's link was shared or copied (the table's detail header). */
		onshare?: (seriesId: string) => void;
		/** The page's footer, at the end of the list. */
		footer?: Snippet;
	}

	const {
		oncall = () => {},
		onclaim = () => {},
		onclose = () => {},
		focusSeriesId,
		calls = [],
		onshare,
		footer
	}: Props = $props();

	const uid = $props.id();
	const panelId = `${uid}-panel`;
	const titleId = `${uid}-title`;

	const phone = new MediaQuery('(max-width: 900px)');

	const readLayout = (): LandingMarketsLayout => {
		const stored = getStored<string>({ key: LANDING_MARKETS_LAYOUT_STORAGE_KEY });

		return (
			LANDING_MARKETS_LAYOUTS.find((value) => value === stored) ?? LANDING_MARKETS_DEFAULT_LAYOUT
		);
	};

	let allMarkets = $state<Market[] | undefined>(undefined);
	let tagsById = $state<Record<string, string[]>>({});
	let histories = $state<Record<string, LandingMarketsHistory>>({});
	let query = $state('');
	let category = $state<MacroId | undefined>(undefined);
	let size = $state<number>(VXP_DEFAULT_CALL_SIZE);
	let chosenLayout = $state<LandingMarketsLayout>(readLayout());
	let selectedId = $state<string | undefined>(undefined);
	let leadId = $state<string | undefined>(undefined);
	let pending = $state<{ id: string; side: LandingCallSide } | undefined>(undefined);
	let madeCalls = $state<Record<string, LandingMarketsCalled>>({});
	let searchInput: HTMLInputElement | undefined;
	let mainEl = $state<HTMLElement | undefined>(undefined);

	const layout = $derived<LandingMarketsLayout>(phone.current ? 'front' : chosenLayout);

	const nowMs = $derived($minuteTick_ms);
	const open = $derived(
		isNullish(allMarkets) ? [] : callableMarkets({ markets: allMarkets, nowMs })
	);
	// Volume is public for signed-out visitors on the web2 build (the HTTP
	// bridge reads it server-side). On a web3 build the engine refuses the
	// anonymous volume read, so every market carries none and the lead and
	// the mover candidates fall to the soonest to settle.
	const trending = $derived(pickTrendingMarket(open));

	const tagsOf = (id: string): string[] => tagsById[id] ?? [];
	const macrosOf = (id: string): MacroId[] => classificationMacros(tagsOf(id));
	const labelOf = (macro: MacroId): string =>
		categoryLabel({ category: macro, variant: 'full', locale: $localeStore });

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

	const filtering = $derived(nonNullish(category) || notEmptyString(query.trim()));

	const matches = (market: Market): boolean =>
		(isNullish(category) || macrosOf(market.id).includes(category)) &&
		matchesSearchQuery({
			texts: [display(market).title, market.title, ...macrosOf(market.id).map(labelOf)],
			query
		});

	const lead = $derived(filtering ? undefined : (open.find(({ id }) => id === leadId) ?? trending));

	const groundMarket = $derived(lead ?? trending);

	const sections = $derived.by(() => {
		if (filtering) {
			return [{ markets: open.filter(matches).sort(compareBySoonest) }];
		}

		const rest = open.filter(({ id }) => id !== lead?.id);

		return layout === 'front'
			? groupBySettlement({ markets: rest, nowMs })
			: [{ markets: [...rest].sort(compareBySoonest) }];
	});

	const moveOf = (market: Market): number | undefined => {
		const history = histories[market.id];

		return isNullish(history)
			? undefined
			: priceMove24h({
					yes: history.yes,
					xs: history.xs,
					windowMs: history.windowEndMs - history.windowStartMs,
					currentPercent: sidePercents(market.yesProbability)?.yes
				});
	};

	// The 24h move is read for the most traded markets only: one history read
	// each, bounded however large the catalog.
	const moverCandidates = $derived(
		[...open]
			.sort((a, b) =>
				a.totalVolume === b.totalVolume ? 0 : a.totalVolume > b.totalVolume ? -1 : 1
			)
			.slice(0, LANDING_MOVERS_CANDIDATES)
	);

	const movers = $derived(
		layout === 'front' && !filtering
			? pickMovers({
					candidates: moverCandidates
						.filter(({ id }) => id !== lead?.id)
						.map((market) => ({ market, move: moveOf(market) })),
					limit: LANDING_MOVERS_LIMIT
				}).map(({ market }) => market)
			: []
	);

	const historyIds = $derived(
		[
			lead?.id,
			selectedId,
			...(layout === 'front' ? moverCandidates.map(({ id }) => id) : [])
		].filter(nonNullish)
	);

	// The table always shows a detail: the lead's until a row is picked.
	const panelMarket = $derived(
		layout === 'table' ? open.find(({ id }) => id === (selectedId ?? lead?.id)) : undefined
	);

	let focusedFor: string | undefined;

	$effect(() => {
		const id = focusSeriesId;

		if (nonNullish(id) && id !== focusedFor && open.some((market) => market.id === id)) {
			focusedFor = id;
			untrack(() => pick(id));
		}
	});

	const scrollToTop = (): void => {
		if (nonNullish(mainEl)) {
			mainEl.scrollTop = 0;
		}
	};

	const pick = (id: string): void => {
		leadId = id;
		selectedId = undefined;
		pending = undefined;
		scrollToTop();
	};

	const select = (market: Market): void => {
		pending = undefined;
		selectedId = layout === 'front' && selectedId === market.id ? undefined : market.id;
	};

	const setLayout = (next: LandingMarketsLayout): void => {
		chosenLayout = next;
		setStored({ key: LANDING_MARKETS_LAYOUT_STORAGE_KEY, value: next });
		selectedId = undefined;
		pending = undefined;
		scrollToTop();
	};

	const focusRow = async (id: string): Promise<void> => {
		await tick();
		mainEl
			?.querySelector<HTMLElement>(`[data-series-id="${CSS.escape(id)}"]`)
			?.focus({ preventScroll: true });
	};

	const used = $derived(Object.keys(madeCalls).length > 0);

	const makeCall = ({ market, side }: { market: Market; side: LandingCallSide }): void => {
		const percents = sidePercents(market.yesProbability);

		if (isNullish(percents)) {
			return;
		}

		const pricePercent = side === 'yes' ? percents.yes : percents.no;
		const action = side === 'yes' ? 'YES' : 'NO';
		const earnsVxp = vxpNetWin({
			amount: size,
			pWin: resolveOutcomeExecutionPrice({ market, action })
		});

		madeCalls[market.id] = { side, pricePercent, amountVxp: size, earnsVxp };
		pending = undefined;
		oncall({ seriesId: market.id, side, pricePercent, amountVxp: size, atMs: Date.now() });
	};

	const earlierCall = (market: Market): LandingMarketsCalled | undefined => {
		const call = calls.findLast(({ seriesId }) => seriesId === market.id);

		if (isNullish(call)) {
			return;
		}

		const amountVxp = call.amountVxp ?? VXP_DEFAULT_CALL_SIZE;

		return {
			side: call.side,
			pricePercent: call.pricePercent,
			amountVxp,
			earnsVxp: vxpNetWin({ amount: amountVxp, pWin: call.pricePercent / 100 })
		};
	};

	const view: LandingMarketsView = {
		titleOf: (market) => display(market).title,
		resolutionOf: (market) => display(market).resolution,
		artOf: (market) => resolveFlowArtCategory({ tags: tagsOf(market.id), seed: market.id }),
		categoryOf: (market) => {
			const macro = primaryMacro(tagsOf(market.id));

			return nonNullish(macro) ? labelOf(macro) : undefined;
		},
		moveOf,
		historyOf: (market) => histories[market.id],
		calledOf: (market) => madeCalls[market.id] ?? earlierCall(market),
		pendingOf: (market) => (pending?.id === market.id ? pending.side : undefined),
		used: () => used,
		onside: ({ market, side }) => {
			if (used) {
				onclaim();

				return;
			}

			pending = { id: market.id, side };
		},
		onconfirm: () => {
			const market = open.find(({ id }) => id === pending?.id);

			if (nonNullish(market) && nonNullish(pending)) {
				makeCall({ market, side: pending.side });
				void focusRow(market.id);
			}
		},
		oncancel: () => {
			const id = pending?.id;

			pending = undefined;

			if (nonNullish(id)) {
				void focusRow(id);
			}
		},
		oncall: ({ market, side }) => (used ? onclaim() : makeCall({ market, side }))
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

		if (nonNullish(pending)) {
			view.oncancel();
		} else if (event.target === searchInput && notEmptyString(query)) {
			query = '';
		} else {
			onclose();
		}
	};

	// Arrow keys walk the markets, as in any list.
	const onListKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
			return;
		}

		const rows = [...(mainEl?.querySelectorAll<HTMLElement>('.lm-wrap [data-series-id]') ?? [])];
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

<LandingMarketsLoader
	{historyIds}
	onhistory={({ seriesId, history }) => (histories[seriesId] = history)}
	onmarkets={(markets) => (allMarkets = markets)}
	ontags={(tags) => (tagsById = tags)}
/>

<div class="lm" class:is-table={layout === 'table'}>
	{#if nonNullish(groundMarket)}
		<LandingMarketsGround market={groundMarket} {view} />
	{/if}

	<LandingMarketsSearch
		onquery={(value) => (query = value)}
		onready={(input) => (searchInput = input)}
		{query}
	/>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={mainEl} class="lm-main" onkeydown={onListKeydown}>
		<div class="lm-wrap">
			<LandingMarketsFilters
				canSwitch={!phone.current}
				{categories}
				{category}
				{layout}
				oncategory={(value) => (category = value)}
				onlayout={setLayout}
			/>

			{#if used}
				<LandingMarketsNote called {onclaim} />
			{/if}

			<LandingMarketsBoard
				{filtering}
				{layout}
				lead={isNullish(allMarkets) ? undefined : lead}
				loading={isNullish(allMarkets)}
				{movers}
				{nowMs}
				onpick={(market) => pick(market.id)}
				onselect={select}
				onsizechange={(value) => (size = value)}
				{panelId}
				{sections}
				selectedId={layout === 'table' ? (panelMarket?.id ?? selectedId) : selectedId}
				{size}
				{uid}
				{view}
			/>

			{#if nonNullish(allMarkets)}
				<LandingMarketsNote {onclaim} />
			{/if}

			{@render footer?.()}
		</div>
	</div>

	{#if nonNullish(panelMarket)}
		<LandingMarketsPanel id={panelId} {titleId}>
			<LandingMarketsDetail
				market={panelMarket}
				{nowMs}
				{onshare}
				onsizechange={(value) => (size = value)}
				{size}
				{titleId}
				{view}
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
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		overflow: hidden;
		isolation: isolate;
		background: var(--ink);
		color: var(--parchment);
		font-family: var(--font-display);
		color-scheme: dark;
	}

	.lm.is-table {
		grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
	}

	.lm-main {
		min-height: 0;
		padding: calc(var(--lm-top) + 10px) var(--lm-pad) calc(32px + var(--docked-footer-inset));
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

	.is-table .lm-main {
		padding: calc(var(--lm-top) + 10px) 12px calc(20px + var(--docked-footer-inset))
			calc(var(--lm-pad) - 2px);
	}

	.lm-main::-webkit-scrollbar {
		display: none;
	}

	.lm-wrap {
		display: grid;
		align-content: start;
		gap: 20px;
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
	}

	.is-table .lm-wrap {
		gap: 12px;
		max-width: none;
	}

	@media (min-width: 901px) and (max-width: 1240px) {
		.lm.is-table {
			grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
		}
	}

	@media (max-width: 900px) {
		.lm {
			--lm-top: calc(124px + env(safe-area-inset-top, 0px));
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lm-main {
			mask-image: none;
		}
	}

	@media (prefers-contrast: more) {
		.lm {
			--lm-ring: inset 0 0 0 1px color-mix(in srgb, var(--parchment) 50%, transparent);
		}
	}
</style>
