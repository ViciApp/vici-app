<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { Snippet } from 'svelte';
	import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { formatRelativeAgoFromNs } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		isEvenOddsTick,
		nearestPointIndex,
		PRICE_CHART_HEIGHT,
		PRICE_CHART_WIDTH,
		priceChartChange,
		priceChartPath,
		priceChartScale,
		priceChartTicks,
		priceChartYFraction,
		type PriceChartSeries
	} from '#lib/utils/landing-price-chart.utils.ts';

	/**
	 * The landing price chart, pure: draws a 0–100 YES series and lets the
	 * visitor drag (pointer or touch) or arrow-key a cursor along it to read
	 * any point. The line takes the colour of the window's direction. Data
	 * loading lives in `LandingPriceChart`; the deck's card back can render
	 * this directly from points it already holds.
	 *
	 * `card` fills its host's height (the card back sets it); `panel` has a
	 * fixed plot height for the Markets detail.
	 */
	interface Props {
		series: PriceChartSeries;
		/** Start of the time axis; omit when unknown (the readout then shows values only). */
		windowStartMs?: number;
		windowEndMs: number;
		/** The window in words ("past month"), for the readout and the accessible name. */
		rangeLabel: string;
		variant?: 'panel' | 'card';
		/** Reveal the line left to right on mount (skipped under reduced motion). */
		draw?: boolean;
		/** Rendered beside the readout, e.g. the time-range buttons. */
		controls?: Snippet;
	}

	const {
		series,
		windowStartMs,
		windowEndMs,
		rangeLabel,
		variant = 'panel',
		draw = false,
		controls
	}: Props = $props();

	const uid = $props.id();

	const scale = $derived(priceChartScale(series.values));
	const ticks = $derived(priceChartTicks(scale));
	const path = $derived(priceChartPath({ series, scale }));
	const change = $derived(priceChartChange(series.values));
	const direction = $derived(change > 0 ? 'up' : change < 0 ? 'dn' : 'fl');
	const lastIndex = $derived(series.values.length - 1);
	const latest = $derived(series.values[lastIndex]);

	const yPercent = (value: number): number => priceChartYFraction({ value, scale }) * 100;

	// Index under the cursor while the visitor reads the line; `undefined` at rest.
	let scrubIndex = $state<number | undefined>(undefined);

	const pointTimeMs = (index: number): number | undefined =>
		isNullish(windowStartMs)
			? undefined
			: windowStartMs + series.xs[index] * (windowEndMs - windowStartMs);

	const relativeTime = (index: number): string | undefined => {
		const atMs = pointTimeMs(index);

		return isNullish(atMs)
			? undefined
			: formatRelativeAgoFromNs({
					timestampNs: BigInt(Math.round(atMs)) * MILLISECOND_IN_NANOSECONDS,
					locale: $localeStore,
					nowMs: windowEndMs
				});
	};

	const scrubValue = $derived(nonNullish(scrubIndex) ? series.values[scrubIndex] : undefined);
	const scrubTime = $derived(nonNullish(scrubIndex) ? relativeTime(scrubIndex) : undefined);

	const changeText = $derived(
		change === 0
			? t({
					locale: $localeStore,
					key: 'landing.markets.chart.no_change',
					params: { range: rangeLabel }
				})
			: t({
					locale: $localeStore,
					key:
						Math.abs(change) === 1
							? 'landing.markets.chart.points_one'
							: 'landing.markets.chart.points_other',
					params: { range: rangeLabel }
				})
	);

	const valueText = $derived(
		nonNullish(scrubValue)
			? [`${scrubValue}%`, scrubTime].filter(nonNullish).join(' ')
			: `${latest}%`
	);

	const startLabel = $derived(
		nonNullish(windowStartMs)
			? new Date(windowStartMs).toLocaleDateString($localeStore, { day: 'numeric', month: 'short' })
			: undefined
	);

	const scrubAt = ({ clientX, target }: { clientX: number; target: HTMLElement }): void => {
		const { left, width } = target.getBoundingClientRect();

		if (width > 0) {
			scrubIndex = nearestPointIndex({ xs: series.xs, x: (clientX - left) / width });
		}
	};

	const onpointerdown = (event: PointerEvent): void => {
		scrubAt({ clientX: event.clientX, target: event.currentTarget as HTMLElement });
	};

	const onpointermove = (event: PointerEvent): void => {
		// A mouse reads on hover; touch and pen read while pressed.
		if (event.pointerType === 'mouse' || event.buttons > 0) {
			scrubAt({ clientX: event.clientX, target: event.currentTarget as HTMLElement });
		}
	};

	const rest = (): void => {
		scrubIndex = undefined;
	};

	const onpointerup = (event: PointerEvent): void => {
		if (event.pointerType !== 'mouse') {
			rest();
		}
	};

	const STEP_KEYS: Record<string, (index: number) => number> = {
		ArrowLeft: (index) => index - 1,
		ArrowDown: (index) => index - 1,
		ArrowRight: (index) => index + 1,
		ArrowUp: (index) => index + 1,
		Home: () => 0,
		End: () => Number.MAX_SAFE_INTEGER
	};

	const onkeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && nonNullish(scrubIndex)) {
			event.stopPropagation();
			rest();

			return;
		}

		const step = STEP_KEYS[event.key];

		if (isNullish(step)) {
			return;
		}

		event.preventDefault();
		scrubIndex = Math.max(0, Math.min(lastIndex, step(scrubIndex ?? lastIndex)));
	};
</script>

<div class="lpch" class:is-card={variant === 'card'}>
	<div class="lpch-top">
		<p class="lpch-read" aria-hidden="true">
			{#if nonNullish(scrubValue)}
				<b>{scrubValue}%</b>
				{scrubTime ?? ''}
			{:else}
				{#if change !== 0}
					<b class={direction}>
						<span class="lpch-arrow">{change > 0 ? '▲' : '▼'}</span>{Math.abs(change)}
					</b>
				{/if}
				{changeText}
			{/if}
		</p>
		{@render controls?.()}
	</div>

	<div
		class="lpch-plot {direction}"
		class:is-draw={draw}
		class:is-scrub={nonNullish(scrubIndex)}
		aria-describedby="{uid}-desc"
		aria-label={t({
			locale: $localeStore,
			key: 'landing.markets.chart.label',
			params: { range: rangeLabel }
		})}
		aria-valuemax={lastIndex}
		aria-valuemin={0}
		aria-valuenow={scrubIndex ?? lastIndex}
		aria-valuetext={valueText}
		onblur={rest}
		{onkeydown}
		onpointercancel={rest}
		{onpointerdown}
		onpointerleave={rest}
		{onpointermove}
		{onpointerup}
		role="slider"
		tabindex="0"
	>
		<div class="lpch-line">
			<svg
				aria-hidden="true"
				preserveAspectRatio="none"
				viewBox="0 0 {PRICE_CHART_WIDTH} {PRICE_CHART_HEIGHT}"
			>
				<defs>
					<linearGradient id="{uid}-fill" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0" stop-color="currentColor" stop-opacity=".26" />
						<stop offset="1" stop-color="currentColor" stop-opacity="0" />
					</linearGradient>
				</defs>
				{#each ticks as tick (tick)}
					{@const y = ((yPercent(tick) / 100) * PRICE_CHART_HEIGHT).toFixed(1)}
					<line
						class="lpch-guide"
						class:is-even={isEvenOddsTick(tick)}
						x1="0"
						x2={PRICE_CHART_WIDTH}
						y1={y}
						y2={y}
					/>
				{/each}
				<path
					d="{path} L{PRICE_CHART_WIDTH},{PRICE_CHART_HEIGHT} L0,{PRICE_CHART_HEIGHT} Z"
					fill="url(#{uid}-fill)"
				/>
				<path class="lpch-stroke" d={path} />
			</svg>
		</div>
		{#each ticks as tick (tick)}
			<span style:top="{yPercent(tick)}%" class="lpch-tick" aria-hidden="true">
				{isEvenOddsTick(tick)
					? t({
							locale: $localeStore,
							key: 'landing.markets.chart.even',
							params: { pct: `${tick}%` }
						})
					: `${tick}%`}
			</span>
		{/each}
		<span style:top="{yPercent(latest)}%" class="lpch-end" aria-hidden="true"></span>
		{#if nonNullish(scrubIndex) && nonNullish(scrubValue)}
			<span style:left="{series.xs[scrubIndex] * 100}%" class="lpch-cursor" aria-hidden="true">
				<i style:top="{yPercent(scrubValue)}%"></i>
			</span>
		{/if}
	</div>

	<p id="{uid}-desc" class="sr-only">
		{t({
			locale: $localeStore,
			key: 'landing.markets.chart.summary',
			params: { from: series.values[0], to: latest }
		})}
	</p>

	<div class="lpch-axis" aria-hidden="true">
		<span>{startLabel ?? ''}</span>
		<span>{t({ locale: $localeStore, key: 'landing.markets.chart.now' })}</span>
	</div>
</div>

<style lang="postcss">
	.lpch {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 10px;
		min-width: 0;
	}

	.lpch-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-width: 0;
		min-height: 36px;
	}

	.lpch-read {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font: 500 14px/1.3 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
		font-variant-numeric: tabular-nums;
		text-wrap: balance;
	}

	.lpch-read b {
		font-weight: 700;
		color: var(--parchment);
	}

	.lpch-read b.up {
		color: var(--yes);
	}

	.lpch-read b.dn {
		color: var(--no);
	}

	.lpch-arrow {
		margin-right: 0.3em;
		font-size: 0.72em;
	}

	.lpch-plot {
		--lpch-line: var(--parchment);
		position: relative;
		height: 168px;
		margin-right: 6px;
		touch-action: pan-y;
		cursor: crosshair;
		outline: none;
	}

	.lpch-plot.up {
		--lpch-line: var(--yes);
	}

	.lpch-plot.dn {
		--lpch-line: var(--no);
	}

	.lpch-plot:focus-visible {
		border-radius: var(--r-8);
		box-shadow: 0 0 0 2px var(--parchment);
	}

	.lpch-line {
		position: absolute;
		inset: 0;
		color: var(--lpch-line);
	}

	.lpch-line svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.lpch-stroke {
		fill: none;
		stroke: var(--lpch-line);
		stroke-width: 2.25;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}

	.lpch-guide {
		stroke: color-mix(in srgb, var(--parchment) 10%, transparent);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.lpch-guide.is-even {
		stroke: color-mix(in srgb, var(--parchment) 28%, transparent);
		stroke-dasharray: 2 4;
	}

	.lpch-tick {
		position: absolute;
		left: 0;
		translate: 0 -100%;
		padding-bottom: 3px;
		font: 500 12px/1 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}

	.lpch-end {
		position: absolute;
		left: 100%;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		translate: -50% -50%;
		background: var(--lpch-line);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--lpch-line) 22%, transparent);
		pointer-events: none;
	}

	.lpch-end::after {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		box-shadow: 0 0 0 1.5px var(--lpch-line);
		opacity: 0;
		animation: lpch-ping 2.4s var(--ease-vici) infinite;
	}

	.lpch-plot.is-scrub .lpch-end::after {
		animation: none;
	}

	@keyframes lpch-ping {
		0% {
			opacity: 0.6;
			transform: scale(0.6);
		}
		70%,
		100% {
			opacity: 0;
			transform: scale(1.7);
		}
	}

	.lpch-cursor {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 1;
		width: 0;
		border-left: 1px solid color-mix(in srgb, var(--parchment) 45%, transparent);
		pointer-events: none;
	}

	.lpch-cursor i {
		position: absolute;
		left: 0;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		translate: -50% -50%;
		background: var(--parchment);
		box-shadow: 0 0 0 3px var(--ink);
	}

	.lpch-axis {
		display: flex;
		justify-content: space-between;
		margin-right: 6px;
		font: 500 12px/1 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
	}

	.lpch-plot.is-draw .lpch-line {
		animation: lpch-draw 720ms var(--ease-vici) both;
	}

	.lpch-plot.is-draw .lpch-end {
		animation: lpch-in 300ms var(--ease-vici) 520ms both;
	}

	@keyframes lpch-draw {
		from {
			clip-path: inset(-8px 100% -8px 0);
		}
		to {
			clip-path: inset(-8px -8px -8px 0);
		}
	}

	@keyframes lpch-in {
		from {
			opacity: 0;
		}
	}

	/* Card back: the host sets the height; the plot takes what is left. */
	.lpch.is-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
	}

	.lpch.is-card .lpch-top {
		min-height: 0;
	}

	.lpch.is-card .lpch-read {
		font-size: 13px;
	}

	.lpch.is-card .lpch-plot {
		flex: 1 1 auto;
		height: auto;
		min-height: 44px;
	}

	@media (max-width: 900px) {
		.lpch-plot {
			height: 150px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lpch-end::after,
		.lpch-plot.is-draw .lpch-line,
		.lpch-plot.is-draw .lpch-end {
			animation: none;
		}
	}
</style>
