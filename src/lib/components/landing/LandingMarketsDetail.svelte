<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import LandingMarketsCallBar from '#lib/components/landing/LandingMarketsCallBar.svelte';
	import LandingMarketsShare from '#lib/components/landing/LandingMarketsShare.svelte';
	import LandingPriceChart from '#lib/components/landing/LandingPriceChart.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { sidePercents } from '#lib/utils/landing-markets.utils.ts';
	import { formatPriceMove24h } from '#lib/utils/market-price-move.utils.ts';
	import { formatSettlesIn, formatSettlesOn } from '#lib/utils/market-settle.utils.ts';

	/**
	 * Market detail, in the order a visitor decides: the question and its
	 * price, the price history to drag through, the 24h move, how and when it
	 * settles, then Yes / No with the call size. In the table's side panel the
	 * call bar is fixed under the scrolling body; opened in a front-page row
	 * (`inRow`) the row already names the question and price, so the detail
	 * starts at the chart and the call bar sticks to the bottom of the list.
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
		nowMs: number;
		size: number;
		onsizechange: (size: number) => void;
		inRow?: boolean;
		titleId?: string;
		/** A share or copy of the market's link completed (header only, not inside a row). */
		onshare?: (seriesId: string) => void;
	}

	const {
		market,
		view,
		nowMs,
		size,
		onsizechange,
		inRow = false,
		titleId,
		onshare
	}: Props = $props();

	const percents = $derived(sidePercents(market.yesProbability));
	const move = $derived(view.moveOf(market));
	const settlesIn = $derived(
		formatSettlesIn({ expiryMs: Number(market.expiryDate), nowMs, locale: $localeStore })
	);
</script>

<div class="lmd-scroll" class:is-row={inRow}>
	{#if !inRow}
		<div class="lmd-head">
			<LandingMarketsShare {market} {onshare} title={view.titleOf(market)} />
			<h3 id={titleId}>{view.titleOf(market)}</h3>
			<p class="lmd-sub">
				{#if nonNullish(percents)}
					<b>{percents.yes}%</b>
				{:else}
					<b><MarketProbabilitySkeleton variant={market.priceLoaded ? 'empty' : 'loading'} /></b>
				{/if}
				{t({
					locale: $localeStore,
					key: 'landing.markets.detail.sub',
					params: { settles: settlesIn }
				})}
			</p>
		</div>
	{/if}

	<LandingPriceChart
		livePercent={percents?.yes}
		openedAtMs={Number(market.startDate ?? market.createdAt)}
		seriesId={market.id}
	/>

	{#if nonNullish(move)}
		<p class="lmd-why">{formatPriceMove24h({ move, locale: $localeStore })}</p>
	{/if}

	<p class="lmd-set">
		{formatSettlesOn({ expiryMs: Number(market.expiryDate), locale: $localeStore })}
	</p>

	<details class="lmd-more">
		<summary>{t({ locale: $localeStore, key: 'landing.markets.detail.full_rule' })}</summary>
		<p>{view.resolutionOf(market)}</p>
	</details>

	<p class="lmd-legal">{t({ locale: $localeStore, key: 'signin.legal.line1' })}</p>
</div>

<LandingMarketsCallBar
	{market}
	oncall={(side) => view.oncall({ market, side })}
	{onsizechange}
	{size}
	sticky={inRow}
/>

<style lang="postcss">
	.lmd-scroll {
		display: grid;
		flex: 1 1 auto;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 14px;
		min-height: 0;
		padding: 24px 22px 16px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: none;
	}

	/* Inside a row the list scrolls, not the detail. */
	.lmd-scroll.is-row {
		max-width: 680px;
		padding: 6px 18px 14px;
		overflow: visible;
	}

	.lmd-scroll::-webkit-scrollbar {
		display: none;
	}

	.lmd-head {
		position: relative;
		display: grid;
		gap: 8px;
	}

	.lmd-head h3 {
		padding-right: 56px;
	}

	h3 {
		margin: 0;
		font: 800 clamp(20px, 1.7vw, 26px) / 1.12 var(--font-headline, var(--font-display));
		letter-spacing: -0.03em;
		color: var(--parchment);
		text-wrap: balance;
	}

	.lmd-sub {
		margin: 0;
		font: 500 15px/1.3 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
	}

	.lmd-sub b {
		margin-right: 2px;
		font: 800 22px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.03em;
		color: var(--parchment);
		font-variant-numeric: tabular-nums;
	}

	.lmd-why {
		margin: -4px 0 0;
		font: 500 14px/1.4 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
	}

	.lmd-set {
		margin: 0;
		padding-top: 14px;
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--parchment) 10%, transparent);
		font: 500 14px/1.45 var(--font-display);
		color: var(--parchment);
		text-wrap: pretty;
	}

	.lmd-more {
		font: 500 14px/1.5 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
	}

	.lmd-more summary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--parchment);
		font-weight: 600;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 5px;
		list-style: none;
		cursor: pointer;
	}

	.lmd-more summary::-webkit-details-marker {
		display: none;
	}

	.lmd-more summary:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	.lmd-more[open] summary {
		margin-bottom: 4px;
	}

	.lmd-more p {
		margin: 0 0 10px;
		white-space: pre-line;
	}

	.lmd-legal {
		margin: 0;
		font: 500 13px/1.4 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
	}
</style>
