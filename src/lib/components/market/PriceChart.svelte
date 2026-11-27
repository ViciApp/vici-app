<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import PriceChartPlot from '#lib/components/market/PriceChartPlot.svelte';
	import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
	import { loadMarketPriceCandles } from '#lib/services/trade.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { MarketEvent } from '#lib/types/market-metadata.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import {
		priceHistoryQueryWindow,
		type PriceHistoryPeriod
	} from '#lib/utils/market-price-history.utils.ts';
	import {
		buildPriceChartSeries,
		priceChartEventMarkers,
		type PriceChartMarker,
		type PriceChartSeries
	} from '#lib/utils/price-chart.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	/**
	 * The price chart for one series: loads its real, market-wide history
	 * (the anonymous / public engine read) and renders `PriceChartPlot`,
	 * with the 1W / 1M / All window buttons when `ranges` is on. The one
	 * chart of the app: the market detail page, the landing's Markets
	 * detail and, through its `backChart` slot, the landing deck's card back.
	 * A series with no trades yet draws a flat line at `livePercent`.
	 */
	interface Props {
		seriesId: string;
		/** Live YES price (0–100) the line ends on; the last trade when omitted. */
		livePercent?: number;
		/** When trading opened (ms): the axis start of an "All" window with no trades yet. */
		openedAtMs?: number;
		/** Show the window buttons; off draws the past month only. */
		ranges?: boolean;
		variant?: 'panel' | 'card';
		/**
		 * The market's "this week" events. Their days only have a date on a
		 * window that ends now, so they are drawn on 1W, and only over real
		 * trades: never on a cold-start line.
		 */
		events?: MarketEvent[];
		/** Change it to load the history again, e.g. after the viewer's own trade. */
		refreshKey?: number;
	}

	const {
		seriesId,
		livePercent,
		openedAtMs,
		ranges = true,
		variant = 'panel',
		events = [],
		refreshKey = 0
	}: Props = $props();

	type Range = Extract<PriceHistoryPeriod, '7d' | '30d' | 'all'>;

	const RANGES: { range: Range; shortKey: MessageKey; labelKey: MessageKey }[] = [
		{
			range: '7d',
			shortKey: 'market.chart.range_short.week',
			labelKey: 'market.chart.range.week'
		},
		{
			range: '30d',
			shortKey: 'market.chart.range_short.month',
			labelKey: 'market.chart.range.month'
		},
		{
			range: 'all',
			shortKey: 'market.chart.range_short.all',
			labelKey: 'market.chart.range.all'
		}
	];

	let range = $state<Range>('30d');

	interface Loaded {
		seriesId: string;
		range: Range;
		yes: number[];
		xs: number[];
		windowStartMs?: number;
		windowEndMs: number;
	}

	let loaded = $state<Loaded | undefined>(undefined);

	// Read once per mount: the line draws in on mount and on each window switch.
	const draw = !prefersReducedMotion();

	$effect(() => {
		// A refresh reloads the same window; the line stays up until it lands.
		void refreshKey;
		const requested = { seriesId, range };
		const { startTimeNs, endTimeNs } = priceHistoryQueryWindow(requested.range);
		const windowEndMs = Number(endTimeNs / MILLISECOND_IN_NANOSECONDS);
		const coldStartMs = nonNullish(startTimeNs)
			? Number(startTimeNs / MILLISECOND_IN_NANOSECONDS)
			: openedAtMs;

		const isCurrent = (): boolean => requested.seriesId === seriesId && requested.range === range;

		void loadMarketPriceCandles({
			seriesId: requested.seriesId,
			period: requested.range,
			// The points sit on the loader's axis ("All" starts at the first
			// candle), so the dates read from the same start.
			onLoad: ({ response: { yes, xs }, windowStartNs }) => {
				if (isCurrent()) {
					const windowStartMs =
						xs.length > 0 ? Number(windowStartNs / MILLISECOND_IN_NANOSECONDS) : coldStartMs;
					loaded = { ...requested, yes, xs, windowStartMs, windowEndMs };
				}
			},
			// The read fails open: the chart keeps a flat cold-start line.
			onUpdateError: () => {
				if (isCurrent()) {
					loaded = { ...requested, yes: [], xs: [], windowStartMs: coldStartMs, windowEndMs };
				}
			}
		});
	});

	// A window switch keeps the previous line up until the new one lands; a
	// different series never shows another market's line.
	const current = $derived(loaded?.seriesId === seriesId ? loaded : undefined);

	const series = $derived<PriceChartSeries | undefined>(
		nonNullish(current)
			? buildPriceChartSeries({ yes: current.yes, xs: current.xs, livePercent })
			: undefined
	);

	const markers = $derived<PriceChartMarker[]>(
		nonNullish(current) &&
			current.range === '7d' &&
			current.xs.length > 0 &&
			nonNullish(current.windowStartMs)
			? priceChartEventMarkers({
					events,
					windowStartMs: current.windowStartMs,
					windowEndMs: current.windowEndMs
				})
			: []
	);

	const selectRange = (next: Range): void => {
		range = next;
	};

	const labelKey = (value: Range): MessageKey =>
		RANGES.find((entry) => entry.range === value)?.labelKey ?? 'market.chart.range.month';
</script>

{#if nonNullish(series) && nonNullish(current)}
	{#key `${current.seriesId}:${current.range}`}
		<PriceChartPlot
			{draw}
			{markers}
			rangeLabel={t({ locale: $localeStore, key: labelKey(current.range) })}
			{series}
			{variant}
			windowEndMs={current.windowEndMs}
			windowStartMs={current.windowStartMs}
		>
			{#snippet controls()}
				{#if ranges}
					<div
						class="pch-ranges"
						aria-label={t({ locale: $localeStore, key: 'market.chart.ranges' })}
						role="group"
					>
						{#each RANGES as entry (entry.range)}
							<button
								class:is-on={entry.range === range}
								aria-label={t({ locale: $localeStore, key: entry.labelKey })}
								aria-pressed={entry.range === range}
								onclick={() => selectRange(entry.range)}
								type="button"
							>
								{t({ locale: $localeStore, key: entry.shortKey })}
							</button>
						{/each}
					</div>
				{/if}
			{/snippet}
		</PriceChartPlot>
	{/key}
{:else}
	<div class="pch-skeleton" class:is-card={variant === 'card'} aria-busy="true"></div>
{/if}

<style lang="postcss">
	.pch-ranges {
		display: flex;
		flex: none;
		gap: 2px;
		padding: 2px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--text-base) 7%, transparent);
	}

	.pch-ranges button {
		height: 32px;
		min-width: 40px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-8);
		background: none;
		color: color-mix(in srgb, var(--text-base) 64%, transparent);
		font: 600 13px/1 var(--font-display);
		cursor: pointer;
		transition:
			background 160ms var(--ease-vici),
			color 160ms var(--ease-vici);
	}

	.pch-ranges button.is-on {
		background: color-mix(in srgb, var(--text-base) 14%, transparent);
		color: var(--text-base);
	}

	.pch-ranges button:focus-visible {
		outline: 2px solid var(--text-base);
		outline-offset: 2px;
	}

	@media (hover: hover) and (pointer: fine) {
		.pch-ranges button:not(.is-on):hover {
			color: var(--text-base);
		}
	}

	.pch-skeleton {
		height: 232px;
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
	}

	.pch-skeleton.is-card {
		height: 100%;
		min-height: 118px;
	}

	@media (max-width: 900px) {
		.pch-ranges button {
			height: 40px;
			min-width: 44px;
		}

		.pch-skeleton {
			height: 214px;
		}
	}

	@media (pointer: coarse) {
		.pch-ranges button {
			height: 44px;
			min-width: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pch-ranges button {
			transition: none;
		}
	}
</style>
