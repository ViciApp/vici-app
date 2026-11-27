import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { MarketEvent } from '#lib/types/market-metadata.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Geometry and readout math for the price chart (`market/PriceChartPlot`),
 * on the market detail page and the landing alike. Pure: the component feeds
 * it the 0–100 YES series from `deriveMarketPriceSeries` and renders the result.
 */

/** SVG viewBox of the plot; the SVG stretches to its box (`preserveAspectRatio="none"`). */
export const PRICE_CHART_WIDTH = 320;
export const PRICE_CHART_HEIGHT = 120;

// Headroom kept above and below the line before rounding the scale out to a
// whole ten, so the line never touches the top or bottom edge.
const SCALE_HEADROOM = 6;
const SCALE_ROUNDING = 10;
// A scale narrower than this exaggerates noise: a one-point wobble would fill
// the whole plot.
const MIN_SCALE_SPAN = 20;
const WIDE_SCALE_SPAN = 40;
const EVEN_ODDS = 50;

export interface PriceChartSeries {
	/** YES percentages (0–100), oldest first. Always at least two points. */
	values: number[];
	/** Parallel x-fractions (0–1) on the time axis, ascending. */
	xs: number[];
}

export interface PriceChartScale {
	lo: number;
	hi: number;
}

/**
 * Turns a fetched series into one the plot can always draw. A window with no
 * trades yet reads as a flat line at the live price (a true cold start, never
 * a made-up shape), and the line is extended to the right edge at the live
 * price so the end dot sits on "now".
 */
export const buildPriceChartSeries = ({
	yes,
	xs,
	livePercent
}: {
	yes: number[];
	xs: number[];
	livePercent?: number;
}): PriceChartSeries | undefined => {
	const values = [...yes];
	const positions = [...xs];

	if (values.length === 0) {
		return isNullish(livePercent) ? undefined : { values: [livePercent, livePercent], xs: [0, 1] };
	}

	const lastX = positions[positions.length - 1];
	const end = livePercent ?? values[values.length - 1];

	if (lastX < 1) {
		values.push(end);
		positions.push(1);
	}

	if (values.length === 1) {
		return { values: [values[0], values[0]], xs: [0, 1] };
	}

	return { values, xs: positions };
};

/**
 * Y scale rounded out to whole tens around the series, at least
 * {@link MIN_SCALE_SPAN} points tall and clamped to 0–100.
 */
export const priceChartScale = (values: number[]): PriceChartScale => {
	const min = Math.min(...values);
	const max = Math.max(...values);

	let lo = Math.max(0, Math.floor((min - SCALE_HEADROOM) / SCALE_ROUNDING) * SCALE_ROUNDING);
	let hi = Math.min(100, Math.ceil((max + SCALE_HEADROOM) / SCALE_ROUNDING) * SCALE_ROUNDING);

	if (hi - lo < MIN_SCALE_SPAN) {
		if (lo + MIN_SCALE_SPAN <= 100) {
			hi = lo + MIN_SCALE_SPAN;
		} else {
			lo = hi - MIN_SCALE_SPAN;
		}
	}

	return { lo, hi };
};

/**
 * Guide lines strictly inside the scale: every 10 points, or every 20 on a
 * tall scale, plus the even-odds line whenever 50% is in range.
 */
export const priceChartTicks = ({ lo, hi }: PriceChartScale): number[] => {
	const step = hi - lo > WIDE_SCALE_SPAN ? 2 * SCALE_ROUNDING : SCALE_ROUNDING;
	const ticks: number[] = [];

	for (let value = lo + step; value < hi; value += step) {
		ticks.push(value);
	}

	if (lo < EVEN_ODDS && hi > EVEN_ODDS && !ticks.includes(EVEN_ODDS)) {
		ticks.push(EVEN_ODDS);
	}

	return ticks;
};

export const isEvenOddsTick = (value: number): boolean => value === EVEN_ODDS;

/** Vertical position of a value as a fraction of the plot height, 0 at the top. */
export const priceChartYFraction = ({
	value,
	scale: { lo, hi }
}: {
	value: number;
	scale: PriceChartScale;
}): number => 1 - (value - lo) / (hi - lo);

/** SVG path (`M … L …`) of the series in the {@link PRICE_CHART_WIDTH} × {@link PRICE_CHART_HEIGHT} box. */
export const priceChartPath = ({
	series: { values, xs },
	scale
}: {
	series: PriceChartSeries;
	scale: PriceChartScale;
}): string =>
	values
		.map((value, index) => {
			const x = (xs[index] * PRICE_CHART_WIDTH).toFixed(1);
			const y = (priceChartYFraction({ value, scale }) * PRICE_CHART_HEIGHT).toFixed(1);

			return `${index === 0 ? 'M' : 'L'}${x},${y}`;
		})
		.join(' ');

/** Index of the point closest to an x-fraction (0–1), for the drag-to-read cursor. */
export const nearestPointIndex = ({ xs, x }: { xs: number[]; x: number }): number => {
	const target = Math.max(0, Math.min(1, x));
	let best = 0;

	for (let index = 1; index < xs.length; index++) {
		if (Math.abs(xs[index] - target) < Math.abs(xs[best] - target)) {
			best = index;
		}
	}

	return best;
};

/** The series value at an x-fraction (0–1), interpolated between its two neighbouring points. */
export const priceChartValueAt = ({
	series: { values, xs },
	x
}: {
	series: PriceChartSeries;
	x: number;
}): number => {
	const next = xs.findIndex((pointX) => pointX >= x);

	if (next <= 0) {
		return next === 0 ? values[0] : values[values.length - 1];
	}

	const span = xs[next] - xs[next - 1];
	const along = span > 0 ? (x - xs[next - 1]) / span : 1;

	return values[next - 1] + (values[next] - values[next - 1]) * along;
};

// An event's `day` counts back from today: 7 is today, 1 is six days ago.
const EVENT_TODAY = 7;

export interface PriceChartMarker {
	/** Position on the time axis (0–1). */
	x: number;
	/** The event's day, at the time of day the window ends. */
	atMs: number;
	label: string;
	dir: MarketEvent['dir'];
}

/**
 * Places a market's "this week" events on the chart's time axis. An event
 * only has a real date relative to today, so the caller passes events for a
 * window that ends now; one that falls outside the window, or whose day is
 * not one of the last seven, is dropped rather than drawn at a guessed spot.
 */
export const priceChartEventMarkers = ({
	events,
	windowStartMs,
	windowEndMs
}: {
	events: MarketEvent[];
	windowStartMs: number;
	windowEndMs: number;
}): PriceChartMarker[] => {
	const spanMs = windowEndMs - windowStartMs;

	if (spanMs <= 0) {
		return [];
	}

	return events
		.filter(({ day }) => Number.isInteger(day) && day >= 1 && day <= EVENT_TODAY)
		.map(({ day, label, dir }) => {
			const atMs = windowEndMs - (EVENT_TODAY - day) * DAY_IN_MS;

			return { x: (atMs - windowStartMs) / spanMs, atMs, label, dir };
		})
		.filter(({ x }) => x >= 0 && x <= 1)
		.sort((a, b) => a.x - b.x);
};

/** Points gained (positive) or lost across the drawn window. */
export const priceChartChange = (values: number[]): number =>
	values.length < 2 ? 0 : values[values.length - 1] - values[0];

/**
 * Today's move in points: the live price against the last traded price at
 * least a day old. When every trade in the window is younger than a day the
 * first one stands in. `undefined` when the window holds no trade at all, so
 * the UI says nothing rather than a made-up "flat".
 */
export const dailyPriceMove = ({
	yes,
	xs,
	windowStartMs,
	windowEndMs,
	livePercent
}: {
	yes: number[];
	xs: number[];
	windowStartMs: number;
	windowEndMs: number;
	livePercent?: number;
}): number | undefined => {
	if (yes.length === 0) {
		return;
	}

	const spanMs = Math.max(windowEndMs - windowStartMs, 1);
	const cutoff = (windowEndMs - DAY_IN_MS - windowStartMs) / spanMs;
	const dayOld = xs.reduce((found, x, index) => (x <= cutoff ? index : found), 0);
	const reference = yes[dayOld];
	const current = livePercent ?? yes[yes.length - 1];

	return current - reference;
};
