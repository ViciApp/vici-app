<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { MarketEvent } from '#lib/types/market-metadata.ts';
	import { sparklinePoints } from '#lib/utils/flow-card-display.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Sparkline on the back of a Flow card.
	 *
	 * Shape:
	 *  - 240×56 SVG (with extra 8px overflow for the label area)
	 *  - 14-point random-walk path seeded by `seed`, ending exactly at
	 *    `yesPercent` so the trailing dot reads as "live"
	 *  - filled area beneath the line at 8% opacity
	 *  - line stroke is `--yes` when YES ≥ 50%, else `--no` (not an
	 *    accent prop)
	 *  - trailing 2.5px live-dot at the right edge
	 *
	 * Event markers:
	 *  - All events plotted (not just the first 2)
	 *  - Each marker is tap-to-reveal: idle pulse → active dotted
	 *    vertical line + filled dot
	 *  - When no event is active and the market has events, a hint
	 *    surfaces below: "N events this week · tap a dot"
	 *  - When one is active, a `DAY DOM MONTH · LABEL · ↑/↓` row
	 *    replaces the hint
	 *  - Active state resets whenever the events identity changes
	 *    (handled by Svelte's reactive `$effect` keyed off the seed)
	 *
	 * `event.day` is 1..7 where 7 = today and 1 = a week ago; the
	 * date label is computed live so it stays fresh as the user
	 * lingers in the app.
	 */
	interface Props {
		seed: string;
		yesPercent: number;
		events?: MarketEvent[];
		/**
		 * Optional override for the sparkline stroke + fill colour. When
		 * omitted the line follows the YES/NO lean (`--yes` ≥ 50 %, else
		 * `--no`). The market-detail surface passes the laurel accent so
		 * the chart reads as a neutral "history" rather than a side
		 * signal.
		 */
		lineColor?: string;
		/**
		 * Real, market-wide price-history series (0–100 YES percentages,
		 * oldest first) sourced from the clearing canister's market-wide
		 * trade history: the true movement for every viewer, not the
		 * caller's own fills. When provided the line plots this genuine
		 * history instead of the seed-based fallback shape:
		 *  - a non-empty series traces the actual trade prices, ending at
		 *    the live `yesPercent`;
		 *  - an empty series is a true cold-start; the line reads flat at
		 *    `yesPercent` until the first trade lands.
		 * When `undefined` (surfaces that don't fetch per-market history,
		 * e.g. the swipe deck) the seed-based fallback shape is used.
		 */
		points?: number[];
		/**
		 * Parallel x-fractions (0–1, same length as {@link points}) placing
		 * each point on a real time axis across the chart window, so the line
		 * spacing reflects elapsed time (gaps where no trades landed) and event
		 * markers can be anchored by date. When present the line plots at these
		 * x's instead of uniform per-index steps; when absent (seed fallback or
		 * cold-start) the index-based spacing is used.
		 */
		pointXs?: number[];
	}

	const {
		seed,
		yesPercent,
		events = [],
		lineColor: lineColorProp,
		points: pointsProp,
		pointXs: pointXsProp
	}: Props = $props();

	// One dot per day on the sparkline. Multiple events landing on the
	// same day (production data, unlike the curated 1-per-day test data
	// we render against) would otherwise stack on the same X
	// coordinate and read as a black blob. Group by day, keep the first
	// event's metadata for the dot itself, and track the extras count so
	// the marker can carry a `+N` badge when needed.
	interface DayMarker {
		day: number;
		label: string;
		dir: MarketEvent['dir'];
		extras: number;
		// Index of this marker's primary event in the original `events`
		// array: kept so the active-event sheet still maps back to the
		// original event payload.
		primaryIndex: number;
	}

	const dayMarkers = $derived.by<DayMarker[]>(() => {
		const byDay: Record<number, DayMarker> = {};

		events.forEach((e, i) => {
			const existing = byDay[e.day];

			if (isNullish(existing)) {
				byDay[e.day] = {
					day: e.day,
					label: e.label,
					dir: e.dir,
					extras: 0,
					primaryIndex: i
				};
			} else {
				existing.extras += 1;
			}
		});

		return Object.values(byDay).sort((a, b) => a.day - b.day);
	});

	const w = 240;
	const h = 56;

	// Point series the line plots. When real price history is supplied
	// (`pointsProp`) it wins over the seed-based fallback shape:
	//  - non-empty real history is plotted verbatim, with the live
	//    `yesPercent` appended so the trailing dot reads as "now";
	//  - an empty real series is a true cold-start; a flat line held at
	//    `yesPercent` (two points so the path still renders);
	//  - `undefined` (no per-market fetch on this surface) falls back to
	//    the seed-based shape.
	const points = $derived.by<number[]>(() => {
		if (isNullish(pointsProp)) {
			return sparklinePoints({ yesPercent, seed });
		}

		if (pointsProp.length === 0) {
			return [yesPercent, yesPercent];
		}

		return [...pointsProp, yesPercent];
	});

	// Real time axis: only when we have non-empty history AND its parallel
	// x-fractions. The seed fallback and the true cold-start (empty real
	// series) keep uniform index spacing.
	const timeAxis = $derived(
		nonNullish(pointsProp) &&
			pointsProp.length > 0 &&
			nonNullish(pointXsProp) &&
			pointXsProp.length === pointsProp.length
	);

	const yCoord = (pct: number): number => h - (pct / 100) * h - 2;

	// X for the point at index `i`. On the time axis each real point sits at
	// its fraction of the window; the live `yesPercent` appended as the last
	// point is "now" (the right edge). Otherwise points are evenly spaced.
	const xCoord = (i: number): number => {
		if (timeAxis && nonNullish(pointXsProp)) {
			return (i < pointXsProp.length ? pointXsProp[i] : 1) * w;
		}

		return (i / Math.max(points.length - 1, 1)) * w;
	};

	// Plotted points in render space: the single source for the line, the
	// area fill, and the marker y-interpolation.
	const xy = $derived(points.map((p, i) => ({ x: xCoord(i), y: yCoord(p) })));

	// Build the line path: `M <x0> <y0> L <x1> <y1> ... L <xN> <yN>`
	// with `y = h - (pct/100)*h - 2` so 100 % sits 2 px below the top.
	const linePath = $derived(xy.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' '));

	// Area path closes the line back to the bottom-left corner:
	// `M…L… L${w} ${h} L0 ${h} Z`.
	const areaPath = $derived(linePath.length > 0 ? `${linePath} L${w} ${h} L0 ${h} Z` : '');

	// Line y at an arbitrary x, by linear interpolation over the plotted
	// points: used to sit event markers on the line when their x comes from
	// a date rather than a point index.
	const yAtX = (targetX: number): number => {
		if (xy.length === 0) {
			return h;
		}

		if (targetX <= xy[0].x) {
			return xy[0].y;
		}

		for (let i = 1; i < xy.length; i++) {
			if (targetX <= xy[i].x) {
				const a = xy[i - 1];
				const b = xy[i];
				const dx = b.x - a.x;

				return dx === 0 ? b.y : a.y + ((b.y - a.y) * (targetX - a.x)) / dx;
			}
		}

		return xy[xy.length - 1].y;
	};

	const lineColor = $derived(lineColorProp ?? (yesPercent >= 50 ? 'var(--yes)' : 'var(--no)'));

	const liveDotY = $derived(h - (yesPercent / 100) * h - 2);

	let activeEvent = $state<number | null>(null);

	// Reset the active marker whenever the market changes (events
	// identity follows the seed).
	$effect(() => {
		// Touch `seed` to take a reactive dep.
		void seed;
		activeEvent = null;
	});

	// Map an event's `day` field (1..7, 7 = today) to its index in the
	// 15-point `points` array: `idx = (points.length-1) - (7 - day)`,
	// i.e. the last 7 points are day 1..7. Seed-fallback only.
	const eventIndexForDay = (day: number): number =>
		Math.max(0, Math.min(points.length - 1, points.length - 1 - (7 - day)));

	// Event x. On the real time axis the window is the 7d "this week" span
	// (day 7 = now = right edge), so the day maps directly to its fraction of
	// the width. On the seed shape it maps through the point index instead.
	const eventX = (day: number): number => {
		if (timeAxis) {
			return Math.max(0, Math.min(1, day / 7)) * w;
		}

		return (eventIndexForDay(day) / Math.max(points.length - 1, 1)) * w;
	};

	// Event y sits on the line: interpolated at the marker's x on the time
	// axis, or read straight off the indexed point on the seed shape.
	const eventY = (day: number): number =>
		timeAxis ? yAtX(eventX(day)) : yCoord(points[eventIndexForDay(day)]);

	const toggleEvent = ({ index, ev }: { index: number; ev: Event }) => {
		ev.stopPropagation();
		activeEvent = activeEvent === index ? null : index;
	};

	// Real-date formatting for the active event's label row. Today is
	// read live so the labels feel current as the user uses the app.
	const MONTHS = [
		'JAN',
		'FEB',
		'MAR',
		'APR',
		'MAY',
		'JUN',
		'JUL',
		'AUG',
		'SEP',
		'OCT',
		'NOV',
		'DEC'
	];
	const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

	const dateForEvent = (day: number): { dayName: string; month: string; dom: number } => {
		// Compute the date `(7 - day)` days ago without mutating any
		// Date instance: Svelte's lint flags `setDate` calls because a
		// mutable Date doesn't trigger reactivity. We build a fresh
		// Date directly from a millisecond offset instead.
		const offsetMs = (7 - day) * DAY_IN_MS;
		const d = new Date(Date.now() - offsetMs);

		return {
			dayName: DAY_NAMES[d.getDay()],
			month: MONTHS[d.getMonth()],
			dom: d.getDate()
		};
	};

	const activeEv = $derived(nonNullish(activeEvent) ? events[activeEvent] : undefined);
	const activeDate = $derived(nonNullish(activeEv) ? dateForEvent(activeEv.day) : undefined);
</script>

<div class="flow-spark-wrap" data-no-card-gesture="true">
	<svg
		class="flow-spark"
		aria-label={t({ locale: $localeStore, key: 'a11y.seven_day_lean' })}
		role="img"
		viewBox="0 0 {w} {h + 8}"
	>
		<!-- Filled area beneath the line at 8% opacity -->
		<path d={areaPath} fill={lineColor} opacity="0.08" />

		<!-- Main line -->
		<path
			d={linePath}
			fill="none"
			stroke={lineColor}
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
		/>

		<!-- Trailing live dot at the right edge -->
		<circle cx={w} cy={liveDotY} fill={lineColor} r="2.5" />

		<!-- Event markers: tappable. One dot per day; same-day extras
		     collapse into a `+N` badge on the dot. -->
		{#each dayMarkers as marker (marker.day)}
			{@const x = eventX(marker.day)}
			{@const y = eventY(marker.day)}
			{@const isActive = activeEvent === marker.primaryIndex}
			{@const isPulse = isNullish(activeEvent)}
			<g
				class="flow-spark-event-dot"
				class:is-active={isActive}
				class:is-pulse={isPulse}
				aria-label={t({
					locale: $localeStore,
					key: 'a11y.spark_event',
					params: { label: marker.label }
				})}
				onclick={(ev) => toggleEvent({ index: marker.primaryIndex, ev })}
				onkeydown={(ev) => {
					if (ev.key === 'Enter' || ev.key === ' ') {
						ev.preventDefault();
						toggleEvent({ index: marker.primaryIndex, ev });
					}
				}}
				ontouchstart={(ev) => ev.stopPropagation()}
				role="button"
				tabindex="0"
			>
				<!-- Invisible hit area: larger tap target than the visible dot -->
				<circle cx={x} cy={y} fill="transparent" r="14" />
				<!-- Dotted vertical drop: only when active -->
				{#if isActive}
					<line
						opacity="0.5"
						stroke={lineColor}
						stroke-dasharray="2 3"
						stroke-width="0.8"
						x1={x}
						x2={x}
						y1={y}
						y2={h + 2}
					/>
				{/if}
				<!-- Pulse ring: visible only when none active (invites tap) -->
				{#if isPulse}
					<circle
						class="flow-spark-pulse-ring"
						cx={x}
						cy={y}
						fill="none"
						opacity="0.5"
						r="4"
						stroke={lineColor}
						stroke-width="1.2"
					/>
				{/if}
				<!-- Visible dot: fills with section bg so the ring reads clean
				     on every theme; ink fill when active. -->
				<circle
					cx={x}
					cy={y}
					fill={isActive ? lineColor : 'var(--bg-surface)'}
					r={isActive ? 5 : 4}
					stroke={lineColor}
					stroke-width={isActive ? 1.5 : 1.2}
				/>
				<!-- Extras badge: surfaces when the same day carries
				     more than one event. -->
				{#if marker.extras > 0}
					<g class="flow-spark-event-extras">
						<circle
							cx={x + 5}
							cy={y - 5}
							fill={lineColor}
							r="5"
							stroke="var(--bg-surface)"
							stroke-width="0.8"
						/>
						<text
							fill="var(--bg-surface)"
							font-family="var(--font-mono)"
							font-size="6"
							font-weight="700"
							text-anchor="middle"
							x={x + 5}
							y={y - 5 + 2.4}
						>
							+{marker.extras}
						</text>
					</g>
				{/if}
			</g>
		{/each}
	</svg>

	<!-- Active event label, OR hint when events present but none active -->
	{#if nonNullish(activeEv) && nonNullish(activeDate)}
		<div class="flow-spark-event-row num">
			<span class="flow-spark-event-day">
				{activeDate.dayName}
				{activeDate.dom}
				{activeDate.month}
			</span>
			<span class="flow-spark-event-lbl">· {activeEv.label.toUpperCase()}</span>
			<span class="flow-spark-event-dir" class:is-up={activeEv.dir === 'up'}>
				{activeEv.dir === 'up' ? '↑' : '↓'}
			</span>
		</div>
	{:else if events.length > 0}
		<div class="flow-spark-hint">
			<span class="num">{events.length}</span>
			{events.length === 1
				? t({ locale: $localeStore, key: 'spark.events_one' })
				: t({ locale: $localeStore, key: 'spark.events_many' })}
			<span class="flow-spark-hint-cta">
				· {t({ locale: $localeStore, key: 'spark.tap_a_dot' })}
			</span>
		</div>
	{/if}
</div>

<style lang="postcss">
	.flow-spark-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border-radius: var(--r-12);
	}

	.flow-spark {
		width: 100%;
		height: 64px;
		display: block;
		margin-top: 6px;
		overflow: visible;
	}

	.flow-spark-event-dot {
		cursor: pointer;
	}

	/* Idle pulse animation: fires only when no dot is active so the
	   pulse invites a tap. */
	.flow-spark-pulse-ring {
		animation: flow-spark-pulse 1.8s ease-in-out infinite;
		transform-origin: center;
		transform-box: fill-box;
	}

	@keyframes flow-spark-pulse {
		0% {
			transform: scale(1);
			opacity: 0.5;
		}

		50% {
			transform: scale(1.6);
			opacity: 0.15;
		}

		100% {
			transform: scale(1);
			opacity: 0.5;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.flow-spark-pulse-ring {
			animation: none;
		}
	}

	.flow-spark-event-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem;
		font-size: var(--t-10);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-base);
		animation: flow-spark-event-in 220ms var(--ease-stage) both;
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-spark-event-row {
			animation: none;
		}
	}

	.flow-spark-event-day {
		font-weight: 700;
	}

	.flow-spark-event-lbl {
		color: var(--text-muted);
	}

	.flow-spark-event-dir {
		margin-left: 0.25rem;
		font-weight: 700;
		color: var(--no);
	}

	.flow-spark-event-dir.is-up {
		color: var(--yes);
	}

	.flow-spark-hint {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		font-size: var(--t-10);
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}

	.flow-spark-hint .num {
		color: var(--text-base);
		font-weight: 700;
	}

	.flow-spark-hint-cta {
		color: var(--laurel);
	}
</style>
