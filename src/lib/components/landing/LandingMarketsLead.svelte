<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingCallSide } from '#lib/types/landing-call.ts';
	import type { Market } from '#lib/types/market.ts';
	import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		dailyMoveCopy,
		formatSettleCountdown,
		sidePercents
	} from '#lib/utils/landing-markets.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';
	import { vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	/**
	 * The "Trending" market at the top of Markets: its art, the question,
	 * the price in large type with today's move, Yes / No at the live price
	 * and what each earns at the current call size. The card opens the
	 * market's detail; Yes / No hand the call to the page.
	 */
	interface Props {
		market: Market;
		title: string;
		artCategory: FlowArtCategory;
		categoryLabel?: string;
		move?: number;
		nowMs: number;
		size: number;
		selected: boolean;
		detailId: string;
		onselect: () => void;
		oncall: (side: LandingCallSide) => void;
	}

	const {
		market,
		title,
		artCategory,
		categoryLabel,
		move,
		nowMs,
		size,
		selected,
		detailId,
		onselect,
		oncall
	}: Props = $props();

	const percents = $derived(sidePercents(market.yesProbability));
	const moveCopy = $derived(nonNullish(move) ? dailyMoveCopy(move) : undefined);
	const settlesWhen = $derived(
		formatSettleCountdown({ expiryMs: Number(market.expiryDate), nowMs, locale: $localeStore })
	);

	const earns = (action: 'YES' | 'NO'): string =>
		formatWholeVxpMagnitude(
			vxpNetWin({ amount: size, pWin: resolveOutcomeExecutionPrice({ market, action }) })
		);
</script>

<article class="lml" class:is-selected={selected}>
	<button
		class="lml-open"
		aria-controls={detailId}
		aria-current={selected ? 'true' : undefined}
		aria-label={title}
		data-series-id={market.id}
		onclick={onselect}
		type="button"
	></button>

	<span class="lml-art" aria-hidden="true">
		<MarketArtwork bleed category={artCategory} fill seed={market.id} size={320} {title} />
	</span>

	<div class="lml-body">
		<span class="lml-meta">
			{nonNullish(categoryLabel)
				? t({
						locale: $localeStore,
						key: 'landing.markets.lead.meta',
						params: { category: categoryLabel, when: settlesWhen }
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
		<div class="lml-cta">
			<button
				class="is-yes"
				disabled={isNullish(percents)}
				onclick={() => oncall('yes')}
				type="button"
			>
				{nonNullish(percents)
					? t({
							locale: $localeStore,
							key: 'landing.markets.yes_at',
							params: { pct: percents.yes }
						})
					: t({ locale: $localeStore, key: 'landing.markets.side.yes' })}
			</button>
			<button
				class="is-no"
				disabled={isNullish(percents)}
				onclick={() => oncall('no')}
				type="button"
			>
				{nonNullish(percents)
					? t({ locale: $localeStore, key: 'landing.markets.no_at', params: { pct: percents.no } })
					: t({ locale: $localeStore, key: 'landing.markets.side.no' })}
			</button>
		</div>
		{#if nonNullish(percents)}
			<p class="lml-pay">
				{t({
					locale: $localeStore,
					key: 'landing.markets.lead.payout',
					params: { amount: size, yes: earns('YES'), no: earns('NO') }
				})}
				<span>{t({ locale: $localeStore, key: 'signin.legal.line1' })}</span>
			</p>
		{/if}
	</div>
</article>

<style lang="postcss">
	.lml {
		position: relative;
		display: grid;
		grid-template-columns: 150px minmax(0, 1fr);
		gap: 16px;
		margin: 0 2px 6px;
		padding: 10px;
		border-radius: 24px;
		background: color-mix(in srgb, var(--parchment) 6%, transparent);
		box-shadow:
			var(--lm-ring),
			0 40px 70px -50px color-mix(in srgb, var(--ink-deep) 90%, transparent);
		animation: lml-in 320ms var(--ease-vici) both;
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
		min-height: 132px;
		overflow: hidden;
		border-radius: 16px;
		background: linear-gradient(140deg, var(--ink-elevated), var(--ink));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--parchment) 14%, transparent);
		pointer-events: none;
		container-type: size;
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
		gap: 10px;
		min-width: 0;
		padding: 2px 8px 2px 0;
		pointer-events: none;
	}

	.lml-meta {
		font: 500 14px/1 var(--font-display);
		color: var(--lm-quiet);
	}

	h3 {
		margin: 0;
		font: 800 clamp(20px, 1.7vw, 26px) / 1.08 var(--font-headline, var(--font-display));
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.lml-big {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-variant-numeric: tabular-nums;
	}

	.lml-big b {
		font: 800 34px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.045em;
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

	.lml-cta {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		pointer-events: auto;
	}

	.lml-cta button {
		height: 40px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-pill);
		font: 700 15px/1 var(--font-display);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			transform 140ms var(--ease-vici),
			background 160ms ease;
	}

	.lml-cta button:active:not(:disabled) {
		transform: scale(0.96);
	}

	.lml-cta button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.lml-cta button:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	.is-yes {
		background: color-mix(in srgb, var(--yes) 18%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--yes) 24%, transparent);
		color: var(--yes);
	}

	.is-no {
		background: color-mix(in srgb, var(--no) 18%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--no) 24%, transparent);
		color: var(--no);
	}

	@media (hover: hover) and (pointer: fine) {
		.is-yes:hover:not(:disabled) {
			background: color-mix(in srgb, var(--yes) 24%, transparent);
		}

		.is-no:hover:not(:disabled) {
			background: color-mix(in srgb, var(--no) 24%, transparent);
		}
	}

	.lml-pay {
		margin: -6px 0 0;
		min-height: 18px;
		font: 500 13px/1.4 var(--font-display);
		color: var(--lm-quiet);
	}

	.lml-pay span {
		display: block;
	}

	@media (max-width: 900px) {
		.lml {
			grid-template-columns: minmax(0, 1fr);
			gap: 12px;
		}

		.lml-art {
			min-height: 0;
			aspect-ratio: 16 / 9;
		}

		.lml-body {
			padding: 0 4px 6px;
		}
	}

	@media (pointer: coarse) {
		.lml-cta button {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lml {
			animation-duration: 160ms;
		}

		.lml-cta button {
			transition: none;
		}
	}
</style>
