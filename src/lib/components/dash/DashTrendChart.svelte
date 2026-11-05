<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	/**
	 * Swipeable accuracy-trend chart for the performance hero. Renders the
	 * synthesised trail for the active window (7 / 30 / 90 days) as a filled
	 * area + stroked line with a trailing dot, and exposes window navigation
	 * via swipe, prev/next chevrons, and a dot strip.
	 *
	 * The series is deterministic from the user's current accuracy (see
	 * `dash-trend.utils`) and always ends exactly on the live number, so the
	 * line never contradicts the headline figure above it.
	 */
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		buildAccuracyTrend,
		buildTrendPath,
		TREND_WINDOW_ORDER
	} from '#lib/utils/dash-trend.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Current accuracy as a 0..100 percentage — anchors every window. */
		accuracyPct: number;
	}

	let { accuracyPct }: Props = $props();

	const W = 360;
	const H = 86;
	const SWIPE_THRESHOLD_PX = 28;

	// Default to the 30-day window (index 1) — the most representative span.
	let index = $state(1);
	let pointerDownX: number | null = null;

	const trend = $derived(buildAccuracyTrend(accuracyPct));
	const activeKey = $derived(TREND_WINDOW_ORDER[index]);
	const active = $derived(trend[activeKey]);
	const path = $derived(buildTrendPath({ ys: active.ys, width: W, height: H }));

	const go = (direction: number): void => {
		index = Math.min(TREND_WINDOW_ORDER.length - 1, Math.max(0, index + direction));
	};

	const onPointerDown = (event: PointerEvent): void => {
		pointerDownX = event.clientX;
	};

	const onPointerUp = (event: PointerEvent): void => {
		if (isNullish(pointerDownX)) {
			return;
		}

		const dx = event.clientX - pointerDownX;
		pointerDownX = null;

		if (Math.abs(dx) > SWIPE_THRESHOLD_PX) {
			go(dx < 0 ? 1 : -1);
		}
	};

	const onPointerLeave = (): void => {
		pointerDownX = null;
	};

	const windowLabel = $derived(
		t({
			locale: $localeStore,
			key: 'dash.build.trend_window',
			params: { days: active.days }
		})
	);
</script>

<div
	class="db-areachart"
	aria-label={t({ locale: $localeStore, key: 'dash.build.trend_chart_label' })}
	onpointerdown={onPointerDown}
	onpointerleave={onPointerLeave}
	onpointerup={onPointerUp}
	role="img"
>
	<svg preserveAspectRatio="none" viewBox="0 0 {W} {H}">
		<path d={path.area} fill="var(--accent)" fill-opacity="0.15" />
		<path
			d={path.line}
			fill="none"
			stroke="var(--accent)"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
		/>
		{#if path.last}
			<circle cx={path.last.x} cy={path.last.y} fill="var(--accent)" r="3.4" />
		{/if}
	</svg>
</div>

<div class="db-trendfoot">
	<span class="db-period num">
		{t({
			locale: $localeStore,
			key: 'dash.build.trend_foot',
			params: { window: windowLabel, start: active.start }
		})}
	</span>
	<span class="db-trendnav">
		<button
			class="db-sc"
			aria-label={t({ locale: $localeStore, key: 'dash.build.trend_shorter' })}
			disabled={index === 0}
			onclick={() => go(-1)}
			type="button"
		>
			‹
		</button>
		<span class="db-dots" aria-hidden="true">
			{#each TREND_WINDOW_ORDER as key, i (key)}
				<i class:on={i === index}></i>
			{/each}
		</span>
		<button
			class="db-sc"
			aria-label={t({ locale: $localeStore, key: 'dash.build.trend_longer' })}
			disabled={index === TREND_WINDOW_ORDER.length - 1}
			onclick={() => go(1)}
			type="button"
		>
			›
		</button>
	</span>
</div>
