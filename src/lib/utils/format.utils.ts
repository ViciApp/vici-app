import type { ClearingDid } from '#declarations';
import { MILLISECOND_IN_NANOSECONDS, USD_DECIMALS } from '#lib/constants/app.constants.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import Decimal from 'decimal.js';
import { type BigNumberish, formatUnits } from 'ethers/utils';

interface FormatTokenParams {
	value: bigint;
	unitName: string | BigNumberish;
	displayDecimals?: number;
	trailingZeros?: boolean;
	showPlusSign?: boolean;
	useGrouping?: boolean;
}

const DEFAULT_DISPLAY_DECIMALS = 4;
const MAX_DEFAULT_DISPLAY_DECIMALS = 8;

/**
 * Coerce an untrusted numeric value to a `bigint` without ever throwing.
 *
 * `BigInt(x)` raises a `RangeError` when `x` is non-integer (float), `NaN`,
 * or `±Infinity`. Several surfaces feed it numbers that come straight from
 * stored profile / activity documents whose schema only guarantees
 * `j.number()` (an unconstrained JS number, not an integer): a single
 * malformed or legacy value would otherwise throw and bring the whole view
 * down. This truncates toward zero and falls back to `0` for any
 * non-finite input, optionally clamping to a minimum, so the conversion is
 * always safe.
 */
export const safeBigInt = ({ value, min }: { value: number; min?: bigint }): bigint => {
	const numeric = Number(value);
	// `Math.trunc(±Infinity)` is still `±Infinity` and `Number(NaN)` stays
	// `NaN`; `BigInt(…)` throws on both, so gate on finiteness, not a
	// truthy check, before truncating toward zero.
	const truncated = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
	const result = BigInt(truncated);

	return nonNullish(min) && result < min ? min : result;
};

/**
 * Adds locale-aware thousands separators to the integer part of a string
 * already in `[-]?\d+(\.\d+)?` form (the output of `Decimal.toFixed`). The
 * fractional part, including its precision, is preserved verbatim so we
 * don't reintroduce rounding on numbers that have already been quantised.
 */
export const groupIntegerPart = ({
	formatted,
	locale
}: {
	formatted: string;
	locale?: string;
}): string => {
	const negative = formatted.startsWith('-');
	const body = negative ? formatted.slice(1) : formatted;
	const [intPart, fracPart] = body.split('.');
	const groupedInt = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(intPart));
	const grouped = isNullish(fracPart) ? groupedInt : `${groupedInt}.${fracPart}`;

	return negative ? `-${grouped}` : grouped;
};

export const formatToken = ({
	value,
	unitName,
	displayDecimals,
	trailingZeros = false,
	showPlusSign = false,
	useGrouping = true
}: FormatTokenParams): string => {
	const parsedUnitName: BigNumberish =
		typeof unitName === 'number' || typeof unitName === 'bigint'
			? unitName
			: /^\d+$/.test(unitName)
				? BigInt(unitName)
				: unitName;

	const res = formatUnits(value, parsedUnitName);

	const match = res.match(/^0\.0*/);
	const leadingZeros = match ? match[0].length - 2 : 0;

	if (isNullish(displayDecimals) && leadingZeros >= MAX_DEFAULT_DISPLAY_DECIMALS) {
		return '< 0.00000001';
	}

	const maxFractionDigits = Math.min(leadingZeros + 2, MAX_DEFAULT_DISPLAY_DECIMALS);
	const minFractionDigits = displayDecimals ?? DEFAULT_DISPLAY_DECIMALS;

	const dec = new Decimal(res);
	const maxDigits =
		displayDecimals ?? (leadingZeros > 2 ? maxFractionDigits : DEFAULT_DISPLAY_DECIMALS);
	const decDP = dec.toDecimalPlaces(maxDigits);
	const minDigits = trailingZeros ? Math.max(minFractionDigits, maxDigits) : undefined;

	const fixed = decDP.toFixed(minDigits) as `${number}`;
	const formatted = useGrouping ? groupIntegerPart({ formatted: fixed }) : fixed;

	if (trailingZeros) {
		return formatted;
	}

	return `${showPlusSign && +res > 0 ? '+' : ''}${formatted}`;
};

export const formatQuantity = ({
	value,
	decimals = 0
}: {
	value: bigint;
	decimals?: number;
}): string => formatToken({ value, unitName: decimals, displayDecimals: 2 });

export const formatCurrency = ({
	value,
	decimals = 6,
	symbol = 'USD'
}: {
	value: bigint;
	decimals?: number;
	symbol?: string;
}): string => {
	const formatted = formatToken({ value, unitName: decimals, displayDecimals: 2 });

	if (symbol === 'USD') {
		return `$${formatted}`;
	}

	return `${formatted} ${symbol}`;
};

const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
};

export const formatNanosecondsToDate = ({ nanoseconds }: { nanoseconds: bigint }): string => {
	const date = new Date(Number(nanoseconds / MILLISECOND_IN_NANOSECONDS));

	return date.toLocaleDateString('en', DATE_TIME_FORMAT_OPTIONS);
};

/**
 * Buckets for `Intl.RelativeTimeFormat` largest-fit selection. Ordered
 * largest → smallest so the picker stops at the first unit whose
 * absolute count is `>= 1`.
 */
const RELATIVE_TIME_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
	{ unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
	{ unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
	{ unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
	{ unit: 'day', ms: 24 * 60 * 60 * 1000 },
	{ unit: 'hour', ms: 60 * 60 * 1000 },
	{ unit: 'minute', ms: 60 * 1000 }
];

/**
 * Locale-aware "X minutes / hours / days ago" formatter. Returns the
 * largest unit whose count is `>= 1`, falling back to "just now" when
 * the delta is under a minute. Use this for any human-readable
 * timestamp that's part of an i18n'd surface (inbox, history rows,
 * activity feed): `formatNanosecondsToDate` always renders in
 * English and is reserved for log-style timestamps.
 */
export const formatRelativeAgoFromNs = ({
	timestampNs,
	locale,
	nowMs = Date.now()
}: {
	timestampNs: bigint;
	locale: string;
	nowMs?: number;
}): string => {
	const tsMs = Number(timestampNs / MILLISECOND_IN_NANOSECONDS);
	const diffMs = nowMs - tsMs;
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

	if (diffMs < RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1].ms) {
		// Sub-minute: ask the formatter for "now" so locales that have a
		// dedicated phrase (e.g. "just now") get it for free.
		return rtf.format(0, 'second');
	}

	for (const { unit, ms } of RELATIVE_TIME_UNITS) {
		const value = Math.floor(diffMs / ms);

		if (value >= 1) {
			return rtf.format(-value, unit);
		}
	}

	// Unreachable: the loop covers all positive deltas above one minute.
	return rtf.format(0, 'second');
};

/**
 * Locale-aware future counterpart of {@link formatRelativeAgoFromNs}:
 * "in 3 days" / "in 5 hours" / "in 12 minutes" / "in 40 seconds".
 * Picks the largest unit with a whole count ≥ 1, then **rounds up**
 * within that unit so the displayed wait is never shorter than the
 * real one (telling a user to retry too early would just fail again).
 * Never renders a zero phrase: sub-second deltas read "in 1 second".
 */
export const formatRelativeUntilFromMs = ({
	targetMs,
	locale,
	nowMs = Date.now()
}: {
	targetMs: number;
	locale: string;
	nowMs?: number;
}): string => {
	const diffMs = Math.max(0, targetMs - nowMs);
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });

	for (const { unit, ms } of RELATIVE_TIME_UNITS) {
		if (Math.floor(diffMs / ms) >= 1) {
			return rtf.format(Math.ceil(diffMs / ms), unit);
		}
	}

	return rtf.format(Math.max(1, Math.ceil(diffMs / 1_000)), 'second');
};

/**
 * Compact, locale-independent "time ago" for dense data rows that show a
 * bare unit suffix (e.g. `5m`, `3h`, `2d`) rather than a full localized
 * phrase: the Dash past-prediction list. Floors to the largest whole
 * unit; the minute branch never reports `0m` (a just-settled row reads
 * `1m`), matching the original inline formatter. Output is intentionally
 * NOT i18n'd: the suffixes are bare ASCII glyphs the calling surface wraps
 * in its own copy.
 */
export const formatRelativeAgoShort = ({
	timestampMs,
	nowMs = Date.now()
}: {
	timestampMs: number;
	nowMs?: number;
}): string => {
	const deltaMs = nowMs - timestampMs;
	const minutes = Math.floor(deltaMs / 60_000);

	if (minutes < 60) {
		return `${Math.max(1, minutes)}m`;
	}

	const hours = Math.floor(minutes / 60);

	if (hours < 24) {
		return `${hours}h`;
	}

	const days = Math.floor(hours / 24);

	return `${days}d`;
};

/**
 * Coarse "time ago" bucket for surfaces that map the unit to their own
 * i18n keys instead of rendering a phrase here (the Portfolio recent-
 * history row). Returns the largest applicable bucket and its whole
 * count: under an hour is `now` (count `0`), then `days` (>= 1 day),
 * else `hours`. This is the threshold ladder the inline
 * `resolvedAgoDisplay` used: coarser than {@link formatRelativeAgoFromNs}
 * (no minute bucket, sub-hour collapses to "now").
 */
export const relativeAgoBucketFromMs = ({
	timestampMs,
	nowMs = Date.now()
}: {
	timestampMs: number;
	nowMs?: number;
}): { unit: 'now' | 'hours' | 'days'; value: number } => {
	const HOUR_MS = 60 * 60 * 1000;
	const DAY_MS = 24 * HOUR_MS;
	const diffMs = nowMs - timestampMs;

	if (diffMs < HOUR_MS) {
		return { unit: 'now', value: 0 };
	}

	const days = Math.floor(diffMs / DAY_MS);

	if (days >= 1) {
		return { unit: 'days', value: days };
	}

	return { unit: 'hours', value: Math.floor(diffMs / HOUR_MS) };
};

/**
 * Render an epoch-ms instant as a compact ISO calendar day (`YYYY-MM-DD`)
 * in UTC. Locale-independent by design: the Tournament bracket lists
 * match end dates as stable, sortable calendar days, not localized prose.
 */
export const formatIsoDateUtc = ({ timestampMs }: { timestampMs: number }): string => {
	const date = new Date(timestampMs);
	const year = date.getUTCFullYear();
	const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
	const day = date.getUTCDate().toString().padStart(2, '0');

	return `${year}-${month}-${day}`;
};

/**
 * Render a `YYYY-MM` month anchor as a localized "Month YYYY" label
 * (e.g. `June 2026`), anchored in UTC to mirror how the underlying
 * stats are bucketed. Falls back to the raw anchor when it isn't two
 * finite numeric components: the champion-history list never shows a
 * malformed date.
 */
export const formatMonthAnchorLabel = ({
	anchor,
	locale
}: {
	anchor: string;
	locale: string;
}): string => {
	const [year, month] = anchor.split('-').map((n) => Number(n));

	if (!Number.isFinite(year) || !Number.isFinite(month)) {
		return anchor;
	}

	return new Intl.DateTimeFormat(locale, {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(year, month - 1, 1)));
};

export const decimalFixedValueToNumber = ({
	value,
	decimals
}: {
	value: bigint;
	decimals: number;
}): number => Number(formatUnits(value, decimals));

export const formatPrice = (price: ClearingDid.Price): string =>
	`${Math.round(
		decimalFixedValueToNumber({
			value: price.decimal.value,
			decimals: price.decimal.decimals
		}) * 100
	)}%`;

export const probabilityToPercent = (prob: number): number => Math.round(prob * 100);

export const formatProbability = (prob: number): string => `${probabilityToPercent(prob)}%`;

export const formatDate = (date: bigint | number): string =>
	new Date(Number(date)).toLocaleDateString();

/**
 * Long date: e.g. `June 11, 2026`. Used on surfaces where the closes
 * date sits inline with prose and reads as a sentence (Market detail
 * CLOSES stat) rather than as a compact data row.
 *
 * Locale-aware: pass the active `$localeStore` so the month + ordering
 * follow the user's language instead of hard-coding English.
 */
export const formatLongDate = ({
	date,
	locale
}: {
	date: bigint | number;
	locale: string;
}): string =>
	new Date(Number(date)).toLocaleDateString(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

/**
 * Locale-aware full month name (e.g. `June`) for a given date,
 * defaulting to today. Used to month-anchor season labels so a tag
 * never names a month that isn't the active one. Formatted in UTC to
 * mirror `monthAnchorFromMs` (which anchors the underlying stats via
 * `getUTCMonth`); otherwise the label could disagree with the data
 * around a UTC month rollover.
 */
export const formatMonthName = ({
	locale,
	date = new Date()
}: {
	locale: string;
	date?: Date;
}): string => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(date);

export const formatVolume = ({
	volume,
	decimals,
	symbol
}: {
	volume: bigint;
	decimals: number;
	symbol: string;
}): string => `${formatToken({ value: volume, unitName: decimals })} ${symbol}`;

export const formatAvailableUsd = ({
	value,
	decimals = USD_DECIMALS
}: {
	value: string | number | bigint;
	decimals?: number;
}) => {
	const val = typeof value === 'bigint' ? value : BigInt(Math.floor(Number(value)));

	return formatCurrency({ value: val, decimals });
};

export const shortenWithMiddleEllipsis = ({
	text,
	splitLength = 7
}: {
	text: string;
	splitLength?: number;
}): string => {
	const minLength = splitLength * 2 + 2;

	return text.length > minLength
		? `${text.slice(0, splitLength)}...${text.slice(-1 * splitLength)}`
		: text;
};

/**
 * Compact principal for inline display: `abcde…wxyz`, keeping the
 * leading and trailing 5 characters. Short principals (≤ 12 chars)
 * are returned untouched. Uses a single-glyph ellipsis (`…`) rather
 * than `...`: distinct from {@link shortenWithMiddleEllipsis}.
 */
export const shortenPrincipal = (principal: string): string =>
	principal.length > 12 ? `${principal.slice(0, 5)}…${principal.slice(-5)}` : principal;

/**
 * Compact league id (`giorgi…87499`): last-resort fallback for when a
 * league's current name can't be resolved (deleted / not yet hydrated).
 */
export const shortLeagueId = (id: string): string =>
	id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-5)}` : id;

// =============================================================
//  Locale-aware Intl wrappers
// =============================================================

/**
 * Locale-aware percent formatter. Input is a 0–1 ratio, not 0–100, to
 * match `Intl.NumberFormat`'s `style: 'percent'` contract.
 */
export const formatLocalePercent = ({
	value,
	locale,
	maximumFractionDigits = 1
}: {
	value: number;
	locale: string;
	maximumFractionDigits?: number;
}): string =>
	new Intl.NumberFormat(locale, {
		style: 'percent',
		maximumFractionDigits
	}).format(value);
