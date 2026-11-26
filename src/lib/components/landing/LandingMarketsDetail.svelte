<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import LandingMarketsCallBar from '#lib/components/landing/LandingMarketsCallBar.svelte';
	import LandingPriceChart from '#lib/components/landing/LandingPriceChart.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingCallSide } from '#lib/types/landing-call.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		dailyMoveCopy,
		formatSettleCountdown,
		sidePercents
	} from '#lib/utils/landing-markets.utils.ts';

	/**
	 * Market detail, in the order a visitor decides: the question and its
	 * price, the price history to drag through, today's move, how and when it
	 * settles, then Yes / No with the call size, fixed under the scrolling
	 * body. Hosted by `LandingMarkets` as a side panel on wide screens and a
	 * bottom sheet on phones.
	 */
	interface Props {
		market: Market;
		title: string;
		resolution: string;
		/** Today's move in points; omitted while unknown. */
		move?: number;
		nowMs: number;
		size: number;
		titleId: string;
		onsizechange: (size: number) => void;
		oncall: (side: LandingCallSide) => void;
		/** Shown as the close button of the phone sheet. */
		onclose?: () => void;
	}

	const {
		market,
		title,
		resolution,
		move,
		nowMs,
		size,
		titleId,
		onsizechange,
		oncall,
		onclose
	}: Props = $props();

	const percents = $derived(sidePercents(market.yesProbability));
	const moveCopy = $derived(nonNullish(move) ? dailyMoveCopy(move) : undefined);
	const settlesWhen = $derived(
		formatSettleCountdown({ expiryMs: Number(market.expiryDate), nowMs, locale: $localeStore })
	);
	const settleDate = $derived(
		new Date(Number(market.expiryDate)).toLocaleDateString($localeStore, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		})
	);
</script>

{#if nonNullish(onclose)}
	<button
		class="lmd-close"
		aria-label={t({ locale: $localeStore, key: 'a11y.close' })}
		onclick={onclose}
		type="button"
	>
		<span aria-hidden="true">×</span>
	</button>
{/if}

<div class="lmd-scroll">
	<div class="lmd-head" class:has-close={nonNullish(onclose)}>
		<h3 id={titleId}>{title}</h3>
		<p class="lmd-sub">
			{#if nonNullish(percents)}
				<b>{percents.yes}%</b>
			{:else}
				<b><MarketProbabilitySkeleton variant={market.priceLoaded ? 'empty' : 'loading'} /></b>
			{/if}
			{t({
				locale: $localeStore,
				key: 'landing.markets.detail.sub',
				params: { when: settlesWhen }
			})}
		</p>
	</div>

	<LandingPriceChart
		livePercent={percents?.yes}
		openedAtMs={Number(market.startDate ?? market.createdAt)}
		seriesId={market.id}
	/>

	{#if nonNullish(moveCopy)}
		<p class="lmd-why">
			{t({ locale: $localeStore, key: moveCopy.key, params: { points: moveCopy.points } })}
		</p>
	{/if}

	<p class="lmd-set">
		{t({
			locale: $localeStore,
			key: 'landing.markets.detail.settles_on',
			params: { date: settleDate }
		})}
	</p>

	<details class="lmd-more">
		<summary>{t({ locale: $localeStore, key: 'landing.markets.detail.full_rule' })}</summary>
		<p>{resolution}</p>
	</details>

	<p class="lmd-legal">{t({ locale: $localeStore, key: 'signin.legal.line1' })}</p>
</div>

<LandingMarketsCallBar {market} {oncall} {onsizechange} {size} />

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

	.lmd-scroll::-webkit-scrollbar {
		display: none;
	}

	.lmd-head {
		display: grid;
		gap: 8px;
	}

	h3 {
		margin: 0;
		font: 800 clamp(20px, 1.7vw, 26px) / 1.12 var(--font-headline, var(--font-display));
		letter-spacing: -0.03em;
		color: var(--parchment);
		text-wrap: balance;
	}

	.lmd-head.has-close h3 {
		padding-right: 44px;
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

	.lmd-close {
		position: absolute;
		top: 8px;
		right: 10px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: inherit;
		font: 400 26px/1 var(--font-display);
		cursor: pointer;
	}

	.lmd-close:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: -4px;
	}
</style>
