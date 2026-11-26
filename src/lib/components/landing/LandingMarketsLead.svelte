<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import LandingMarketsLeadCall from '#lib/components/landing/LandingMarketsLeadCall.svelte';
	import LandingMarketsLeadChart from '#lib/components/landing/LandingMarketsLeadChart.svelte';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		dailyMoveCopy,
		formatSettleCountdown,
		sidePercents
	} from '#lib/utils/landing-markets.utils.ts';

	/**
	 * The "Trending" market at the top of Markets: its art, the question, the
	 * price in large type with today's move, a small chart of the week on the
	 * front page, and the lead's call. In the table it is compact and opens
	 * the side panel (`onselect`).
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
		nowMs: number;
		size: number;
		compact?: boolean;
		selected?: boolean;
		detailId?: string;
		onselect?: () => void;
	}

	const {
		market,
		view,
		nowMs,
		size,
		compact = false,
		selected = false,
		detailId,
		onselect
	}: Props = $props();

	const title = $derived(view.titleOf(market));
	const category = $derived(view.categoryOf(market));
	const percents = $derived(sidePercents(market.yesProbability));
	const move = $derived(view.moveOf(market));
	const moveCopy = $derived(nonNullish(move) ? dailyMoveCopy(move) : undefined);
	const history = $derived(view.historyOf(market));
	const settlesWhen = $derived(
		formatSettleCountdown({ expiryMs: Number(market.expiryDate), nowMs, locale: $localeStore })
	);
</script>

<article class="lml" class:is-compact={compact}>
	{#if nonNullish(onselect)}
		<button
			class="lml-open"
			aria-controls={detailId}
			aria-current={selected ? 'true' : undefined}
			aria-label={title}
			data-series-id={market.id}
			onclick={onselect}
			type="button"
		></button>
	{/if}

	<span class="lml-art" aria-hidden="true">
		<MarketArtwork bleed category={view.artOf(market)} fill seed={market.id} size={320} {title} />
	</span>

	<div class="lml-body" class:is-passive={nonNullish(onselect)}>
		<span class="lml-meta">
			{nonNullish(category)
				? t({
						locale: $localeStore,
						key: 'landing.markets.lead.meta',
						params: { category, when: settlesWhen }
					})
				: t({
						locale: $localeStore,
						key: 'landing.markets.settles',
						params: { when: settlesWhen }
					})}
		</span>
		<h3>{title}</h3>
		<div class="lml-big">
			{#if nonNullish(percents)}
				<b>{percents.yes}%</b>
			{:else}
				<b><MarketProbabilitySkeleton variant={market.priceLoaded ? 'empty' : 'loading'} /></b>
			{/if}
			<span>{t({ locale: $localeStore, key: 'landing.markets.side.yes' })}</span>
		</div>
		<p class="lml-say">
			<b>{t({ locale: $localeStore, key: 'landing.markets.lead.chance' })}</b>
			{#if nonNullish(moveCopy)}
				{t({ locale: $localeStore, key: moveCopy.key, params: { points: moveCopy.points } })}
			{/if}
		</p>
		{#if !compact && nonNullish(history)}
			<LandingMarketsLeadChart {history} livePercent={percents?.yes} />
		{/if}
		<LandingMarketsLeadCall {market} {size} {view} />
	</div>
</article>

<style lang="postcss">
	.lml {
		--lml-cta-height: 46px;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
		gap: clamp(18px, 2.4vw, 36px);
		padding: 14px;
		border-radius: 30px;
		background: color-mix(in srgb, var(--parchment) 6%, transparent);
		box-shadow:
			var(--lm-ring),
			0 40px 70px -50px color-mix(in srgb, var(--ink-deep) 90%, transparent);
		animation: lml-in 320ms var(--ease-vici) both;
	}

	.lml.is-compact {
		--lml-cta-height: 40px;
		grid-template-columns: 150px minmax(0, 1fr);
		gap: 16px;
		margin: 0 2px 6px;
		padding: 10px;
		border-radius: 24px;
	}

	@keyframes lml-in {
		from {
			opacity: 0;
		}
	}

	.lml-open {
		position: absolute;
		inset: 0;
		border: 0;
		border-radius: inherit;
		background: none;
		cursor: pointer;
	}

	.lml-open:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	.lml-art {
		position: relative;
		display: block;
		width: 100%;
		min-height: clamp(160px, 34vh, 300px);
		overflow: hidden;
		border-radius: 22px;
		background: linear-gradient(140deg, var(--ink-elevated), var(--ink));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--parchment) 14%, transparent);
		pointer-events: none;
		container-type: size;
	}

	.is-compact .lml-art {
		min-height: 132px;
		border-radius: 16px;
	}

	/* The art is square: size it to the larger side and centre it, so it
	   covers the frame like a poster instead of letterboxing. */
	.lml-art :global(.market-artwork) {
		position: absolute;
		top: 50%;
		left: 50%;
		width: max(100cqw, 100cqh);
		height: max(100cqw, 100cqh);
		translate: -50% -50%;
	}

	.lml-body {
		display: grid;
		align-content: center;
		gap: 14px;
		min-width: 0;
		padding: 8px 12px 8px 0;
	}

	.is-compact .lml-body {
		gap: 10px;
		padding: 2px 8px 2px 0;
	}

	/* The whole card opens the panel; only the call buttons sit above it. */
	.lml-body.is-passive {
		pointer-events: none;
	}

	.lml-meta {
		font: 500 14px/1 var(--font-display);
		color: var(--lm-quiet);
	}

	h3 {
		margin: 0;
		font: 800 clamp(26px, 2.8vw, 44px) / 1.02 var(--font-headline, var(--font-display));
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.is-compact h3 {
		font-size: clamp(20px, 1.7vw, 26px);
		line-height: 1.08;
	}

	.lml-big {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-variant-numeric: tabular-nums;
	}

	.lml-big b {
		font: 800 48px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.045em;
	}

	.is-compact .lml-big b {
		font-size: 34px;
	}

	.lml-big span {
		font: 600 16px/1 var(--font-display);
	}

	.lml-say {
		margin: 2px 0 0;
		font: 500 15px/1.45 var(--font-display);
		color: var(--lm-quiet);
		text-wrap: pretty;
	}

	.lml-say b {
		font-weight: 600;
		color: var(--parchment);
	}

	/* Short windows keep the lead on the first screen. */
	@media (max-height: 700px) {
		.lml:not(.is-compact) .lml-body {
			gap: 10px;
		}

		.lml:not(.is-compact) h3 {
			font-size: clamp(22px, 2.4vw, 34px);
		}

		.lml:not(.is-compact) .lml-big b {
			font-size: 38px;
		}
	}

	@media (max-width: 900px) {
		.lml,
		.lml.is-compact {
			grid-template-columns: minmax(0, 1fr);
			gap: 12px;
			padding: 10px;
		}

		.lml-art,
		.is-compact .lml-art {
			min-height: 0;
			aspect-ratio: 16 / 9;
		}

		.lml-body,
		.is-compact .lml-body {
			padding: 0 4px 6px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lml {
			animation-duration: 160ms;
		}
	}
</style>
