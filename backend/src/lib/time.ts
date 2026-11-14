// Time conversions and formats. Nanosecond timestamps are the unit of IC protocol fields
// and of the dedup stamps the custody, award and analytics tables keep.

import { nonNullish } from '@dfinity/utils';

const NS_PER_MS = BigInt(1_000_000);

export const MINUTE_IN_MS = 60 * 1000;

export const TEN_MINUTES_IN_MS = 10 * MINUTE_IN_MS;

export const HOUR_IN_MS = 60 * MINUTE_IN_MS;

export const DAY_IN_MS = 24 * HOUR_IN_MS;

/** A UTC `YYYY-MM` month anchor: the key of every monthly row (user and
 * affiliation stats, tournaments). */
export const MONTH_ANCHOR_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const msToNs = (ms: number): bigint => BigInt(ms) * NS_PER_MS;

export const nowNs = (): bigint => msToNs(Date.now());

/** A nullable `bigint` milliseconds column, selected as `::text`, as an optional number. */
export const optionalMs = (value: string | null): number | undefined =>
	nonNullish(value) ? Number(value) : undefined;

/** UTC YYYY-MM anchor for a ms timestamp. */
export const monthAnchorFromMs = (ms: number): string => {
	const d = new Date(ms);

	return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
};

/** The first instant (UTC) of a `YYYY-MM` anchor's month, in ms. */
export const monthStartMs = (monthAnchor: string): number => {
	const [year, month] = monthAnchor.split('-');

	return Date.UTC(Number(year), Number(month) - 1, 1);
};

/** The first instant (UTC) after a `YYYY-MM` anchor's month, in ms: the
 * moment the month closes. */
export const monthEndMs = (monthAnchor: string): number => {
	const [year, month] = monthAnchor.split('-');

	return Date.UTC(Number(year), Number(month), 1);
};

/** The previous month's anchor relative to `nowMs`. */
export const previousMonthAnchor = (nowMs: number): string => {
	const d = new Date(nowMs);

	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCMonth(d.getUTCMonth() - 1);

	return monthAnchorFromMs(d.getTime());
};
