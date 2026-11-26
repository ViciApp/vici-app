import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { Market } from '#lib/types/market.ts';
import { probabilityToPercent } from '#lib/utils/format.utils.ts';
import { filterRevealedMarkets } from '#lib/utils/market-reveal.utils.ts';
import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';

/**
 * Selection, ordering and search for the landing Markets view
 * (`landing/LandingMarkets`). Pure: the component feeds it the market set
 * from `loadMarketsProgressive`.
 */

/**
 * Markets a visitor can call right now: open, released (see
 * `market-reveal.utils`) and not past their expiry.
 */
export const callableMarkets = ({
	markets,
	nowMs
}: {
	markets: Market[];
	nowMs: number;
}): Market[] =>
	filterRevealedMarkets({ markets, now: nowMs }).filter(
		({ status, expiryDate }) => status === 'Open' && Number(expiryDate) > nowMs
	);

/** Soonest to settle first; the id keeps equal expiries in a stable order. */
// eslint-disable-next-line local-rules/prefer-object-params -- Array.sort comparators take two positional args by contract
export const compareBySoonest = (a: Market, b: Market): number => {
	if (a.expiryDate !== b.expiryDate) {
		return a.expiryDate < b.expiryDate ? -1 : 1;
	}

	return a.id.localeCompare(b.id);
};

/**
 * The "Trending" market: the most traded callable market, the same volume
 * signal as the app's Trending rail. Ties (a fresh catalog, or a read that
 * carries no volume) fall to the one settling soonest.
 */
export const pickTrendingMarket = (markets: Market[]): Market | undefined =>
	[...markets].sort((a, b) => {
		if (a.totalVolume !== b.totalVolume) {
			return a.totalVolume > b.totalVolume ? -1 : 1;
		}

		return compareBySoonest(a, b);
	})[0];

/** Lower-cased, accent-folded, whitespace-collapsed text for matching. */
export const normalizeSearchText = (text: string): string =>
	text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();

/**
 * Whether any of a market's searchable texts (title, original title,
 * category names) contains the query. An empty query matches everything.
 */
export const matchesSearchQuery = ({
	texts,
	query
}: {
	texts: string[];
	query: string;
}): boolean => {
	const needle = normalizeSearchText(query);

	if (!notEmptyString(needle)) {
		return true;
	}

	return texts.some((text) => normalizeSearchText(text).includes(needle));
};

/**
 * Whole YES / NO percentages that always sum to 100, or `undefined` while the
 * price is unknown (never a made-up 50 / 50).
 */
export const sidePercents = (
	yesProbability: number | undefined
): { yes: number; no: number } | undefined => {
	if (isNullish(yesProbability)) {
		return;
	}

	const yes = probabilityToPercent(yesProbability);

	return { yes, no: 100 - yes };
};

// Past this many days the countdown reads in months ("settles in 4 months").
const COUNTDOWN_DAYS_LIMIT = 60;
const DAYS_PER_MONTH = 30;

/**
 * "settles today / tomorrow / in 35 days / in 4 months": whole days up to
 * two months out, rounded months beyond, in the visitor's locale.
 */
export const formatSettleCountdown = ({
	expiryMs,
	nowMs,
	locale
}: {
	expiryMs: number;
	nowMs: number;
	locale: string;
}): string => {
	const days = Math.max(0, Math.ceil((expiryMs - nowMs) / DAY_IN_MS));
	const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

	return days < COUNTDOWN_DAYS_LIMIT
		? format.format(days, 'day')
		: format.format(Math.round(days / DAYS_PER_MONTH), 'month');
};

/** Catalog key and point count for "Up 4 today." / "Down 4 today." / "Flat today.". */
export const dailyMoveCopy = (
	move: number
): {
	key: 'landing.markets.move.up' | 'landing.markets.move.down' | 'landing.markets.move.flat';
	points: number;
} => {
	if (move > 0) {
		return { key: 'landing.markets.move.up', points: move };
	}

	if (move < 0) {
		return { key: 'landing.markets.move.down', points: -move };
	}

	return { key: 'landing.markets.move.flat', points: 0 };
};

/**
 * When a market settles relative to now, as the board's sections: this
 * calendar year, the first quarter of next year, the rest of next year, or
 * later. Year boundaries are the visitor's own (local time).
 */
export type SettleGroup =
	| { key: 'this_year' }
	| { key: 'early_next'; year: number }
	| { key: 'later_next'; year: number }
	| { key: 'beyond'; year: number };

const SETTLE_GROUP_ORDER: SettleGroup['key'][] = [
	'this_year',
	'early_next',
	'later_next',
	'beyond'
];
// Month index (0-based) the first quarter ends before.
const FIRST_QUARTER_END_MONTH = 3;

export const settleGroupOf = ({
	expiryMs,
	nowMs
}: {
	expiryMs: number;
	nowMs: number;
}): SettleGroup => {
	const nextYear = new Date(nowMs).getFullYear() + 1;

	if (expiryMs < new Date(nextYear, 0, 1).getTime()) {
		return { key: 'this_year' };
	}

	if (expiryMs < new Date(nextYear, FIRST_QUARTER_END_MONTH, 1).getTime()) {
		return { key: 'early_next', year: nextYear };
	}

	if (expiryMs < new Date(nextYear + 1, 0, 1).getTime()) {
		return { key: 'later_next', year: nextYear };
	}

	return { key: 'beyond', year: nextYear + 1 };
};

/** The board's sections in time order, each soonest first; empty sections are left out. */
export const groupBySettlement = ({
	markets,
	nowMs
}: {
	markets: Market[];
	nowMs: number;
}): { group: SettleGroup; markets: Market[] }[] => {
	const sections: Partial<Record<SettleGroup['key'], { group: SettleGroup; markets: Market[] }>> =
		{};

	[...markets].sort(compareBySoonest).forEach((market) => {
		const group = settleGroupOf({ expiryMs: Number(market.expiryDate), nowMs });
		const section = sections[group.key] ?? { group, markets: [] };

		section.markets.push(market);
		sections[group.key] = section;
	});

	return SETTLE_GROUP_ORDER.map((key) => sections[key]).filter(nonNullish);
};

/**
 * "Moving now": the markets that moved today, biggest move first. One with no
 * trade in its history window (`undefined`) or a flat day is left out, so the
 * result can be empty.
 */
export const pickMovers = <T extends { move?: number }>({
	candidates,
	limit
}: {
	candidates: T[];
	limit: number;
}): T[] =>
	candidates
		.filter(({ move }) => nonNullish(move) && move !== 0)
		.sort((a, b) => Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0))
		.slice(0, limit);

/** Polyline points of a small trend line in a `width` × `height` box, with 2px of vertical room. */
export const sparklinePolyline = ({
	values,
	width,
	height
}: {
	values: number[];
	width: number;
	height: number;
}): string => {
	if (values.length < 2) {
		return '';
	}

	const lo = Math.min(...values);
	// A near-flat line stays near-flat instead of filling the box.
	const range = Math.max(2, Math.max(...values) - lo);
	const room = height - 4;

	return values
		.map((value, index) => {
			const x = ((index / (values.length - 1)) * width).toFixed(1);
			const y = (height - 2 - ((value - lo) / range) * room).toFixed(1);

			return `${x},${y}`;
		})
		.join(' ');
};

/** Catalog key of a side's name ("Yes" / "No"). */
export const SIDE_LABEL_KEYS = {
	yes: 'landing.markets.side.yes',
	no: 'landing.markets.side.no'
} as const;
