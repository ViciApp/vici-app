<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import type { LandingMarketsHistory } from '#lib/types/landing-markets.ts';
	import {
		buildPriceChartSeries,
		PRICE_CHART_HEIGHT,
		PRICE_CHART_WIDTH,
		priceChartPath,
		priceChartYFraction
	} from '#lib/utils/price-chart.utils.ts';

	/**
	 * The lead's small chart on the front page: last week's real line, a
	 * dashed guide at where the week opened and a dot on the live price.
	 * Decorative: the lead's text already states the price and the move, and
	 * the readable chart lives in the expanded detail.
	 */
	interface Props {
		history: LandingMarketsHistory;
		livePercent?: number;
	}

	const { history, livePercent }: Props = $props();

	// Tight headroom: this line shows the week's shape, not where it sits on 0–100.
	const HEADROOM = 3;

	const series = $derived(buildPriceChartSeries({ yes: history.yes, xs: history.xs, livePercent }));
	const scale = $derived(
		nonNullish(series)
			? {
					lo: Math.min(...series.values) - HEADROOM,
					hi: Math.max(...series.values) + HEADROOM
				}
			: undefined
	);
	const y = (value: number): number =>
		nonNullish(scale) ? priceChartYFraction({ value, scale }) * PRICE_CHART_HEIGHT : 0;
</script>

{#if nonNullish(series) && nonNullish(scale)}
	{@const path = priceChartPath({ series, scale })}
	{@const opening = y(series.values[0]).toFixed(1)}
	<div class="lmlc" aria-hidden="true">
		<svg preserveAspectRatio="none" viewBox="0 0 {PRICE_CHART_WIDTH} {PRICE_CHART_HEIGHT}">
			<path
				class="lmlc-area"
				d="{path} L{PRICE_CHART_WIDTH},{PRICE_CHART_HEIGHT} L0,{PRICE_CHART_HEIGHT} Z"
			/>
			<line class="lmlc-open" x1="0" x2={PRICE_CHART_WIDTH} y1={opening} y2={opening} />
			<path class="lmlc-line" d={path} />
		</svg>
		<span
			style:top="{(y(series.values[series.values.length - 1]) / PRICE_CHART_HEIGHT) * 100}%"
			class="lmlc-end"
		></span>
	</div>
{/if}

<style lang="postcss">
	.lmlc {
		position: relative;
		height: 112px;
		margin: 2px 10px 0 0;
	}

	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.lmlc-area {
		fill: color-mix(in srgb, var(--parchment) 6%, transparent);
	}

	.lmlc-open {
		stroke: color-mix(in srgb, var(--parchment) 30%, transparent);
		stroke-width: 1;
		stroke-dasharray: 3 4;
		vector-effect: non-scaling-stroke;
	}

	.lmlc-line {
		fill: none;
		stroke: var(--parchment);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}

	.lmlc-end {
		position: absolute;
		left: 100%;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		translate: -50% -50%;
		background: var(--parchment);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--parchment) 14%, transparent);
	}

	/* Short windows keep the lead on the first screen. */
	@media (max-height: 700px) {
		.lmlc {
			display: none;
		}
	}
</style>
