/**
 * Deterministic accuracy-trail synthesis for the Dashboard performance hero.
 *
 * No per-window accuracy time-series is persisted yet; the satellite stores
 * only the user's current lifetime `accuracy`. Until a real aggregator exists,
 * the trend chart draws a believable climb that ENDS exactly on the live number
 * for each window, so the line never contradicts the headline figure. The shape
 * is fully deterministic from the current accuracy (an ease-out climb with a
 * gentle, fixed wobble), so it renders identically on every visit rather than
 * shifting on each load.
 */

export type TrendWindowKey = 'd7' | 'd30' | 'd90';

export interface TrendWindow {
	/** Window key: drives the ordered nav + dots. */
	key: TrendWindowKey;
	/** Days spanned by this window (7 / 30 / 90). */
	days: number;
	/** Starting accuracy of the synthesised climb, one decimal, for the footer. */
	start: string;
	/** Accuracy samples (0..100), ending exactly on the live number. */
	ys: number[];
}

/** Ordered windows: short → long, matching the swipe / nav direction. */
export const TREND_WINDOW_ORDER: readonly TrendWindowKey[] = ['d7', 'd30', 'd90'];

/** Per-window climb depth (how far below the live number the trail starts). */
const WINDOW_SPEC: Record<TrendWindowKey, { days: number; startDelta: number; points: number }> = {
	d7: { days: 7, startDelta: 0.8, points: 8 },
	d30: { days: 30, startDelta: 2.1, points: 13 },
	d90: { days: 90, startDelta: 5.4, points: 16 }
};

/** Accuracy is a percentage: every sample must stay within [0, 100]. */
const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

const buildWindow = ({ key, end }: { key: TrendWindowKey; end: number }): TrendWindow => {
	const { days, startDelta, points } = WINDOW_SPEC[key];
	const clampedEnd = clampPct(end);
	const start = Math.max(0, clampedEnd - startDelta);
	const ys: number[] = [];

	for (let i = 0; i < points; i += 1) {
		const t = i / (points - 1);
		// Ease-out climb from `start` to `clampedEnd`, plus a small fixed wobble so
		// the line reads as organic. The wobble can nudge a sample past the 0..100
		// bounds, so clamp each one; the final sample is pinned exactly on the
		// (clamped) end value.
		const base = start + (clampedEnd - start) * (1 - Math.pow(1 - t, 1.7));
		const wobble = Math.sin(i * 1.3) * (startDelta * 0.06);

		ys.push(i === points - 1 ? clampedEnd : clampPct(base + wobble));
	}

	return { key, days, start: start.toFixed(1), ys };
};

/**
 * Build the three trend windows anchored on the user's current accuracy
 * percentage (0..100). Each window's series ends exactly on `accuracyPct`.
 */
export const buildAccuracyTrend = (accuracyPct: number): Record<TrendWindowKey, TrendWindow> => {
	const end = Number.isFinite(accuracyPct) ? accuracyPct : 0;

	return {
		d7: buildWindow({ key: 'd7', end }),
		d30: buildWindow({ key: 'd30', end }),
		d90: buildWindow({ key: 'd90', end })
	};
};

export interface TrendPath {
	/** SVG `d` for the stroked line. */
	line: string;
	/** SVG `d` for the filled area beneath the line. */
	area: string;
	/** Coordinates of the trailing sample, for the end-of-line dot. */
	last: { x: number; y: number } | undefined;
}

/**
 * Turn a series of accuracy samples into SVG line + area paths within a
 * `width × height` box. The vertical scale auto-fits the series with a small
 * padding so the climb fills the box regardless of the absolute accuracy.
 */
export const buildTrendPath = ({
	ys,
	width,
	height
}: {
	ys: number[];
	width: number;
	height: number;
}): TrendPath => {
	if (ys.length === 0) {
		return { line: '', area: '', last: undefined };
	}

	const min = Math.min(...ys) - 1.5;
	const max = Math.max(...ys) + 1.5;
	const span = Math.max(0.001, max - min);
	const pad = 10;

	const points = ys.map((y, i) => {
		const x = (i / Math.max(1, ys.length - 1)) * width;
		const yy = pad + (1 - (y - min) / span) * (height - pad * 1.4);

		return { x: Math.round(x * 10) / 10, y: Math.round(yy * 10) / 10 };
	});

	const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
	const area = `${line} L${width},${height} L0,${height} Z`;

	return { line, area, last: points[points.length - 1] };
};
