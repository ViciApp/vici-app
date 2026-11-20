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

/** Whole milliseconds of a nanosecond timestamp (sub-millisecond precision is dropped). */
export const nsToMs = (ns: bigint): number => Number(ns / NS_PER_MS);

export const nowNs = (): bigint => msToNs(Date.now());

/** A nullable `bigint` milliseconds column, selected as `::text`, as an optional number. */
export const optionalMs = (value: string | null): number | undefined =>
	nonNullish(value) ? Number(value) : undefined;

/** UTC YYYY-MM anchor for a ms timestamp. */
export const monthAnchorFromMs = (ms: number): string => {
	const d = new Date(ms);

	return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
};

/** UTC `YYYY-MM-DD` day key for a ms timestamp: the server's own calendar
 * day, never a client's local one. */
export const dayKeyFromMs = (ms: number): string => {
	const d = new Date(ms);

	return `${monthAnchorFromMs(ms)}-${d.getUTCDate().toString().padStart(2, '0')}`;
};

/** Whole days between two YYYY-MM-DD day keys (UTC-anchored), undefined
 * when either is missing/unparseable or the span is negative (clock skew or
 * a backdated day must not satisfy the absence gate). */
export const daysBetween = ({
	fromDay,
	toDay
}: {
	fromDay: string;
	toDay: string;
}): number | undefined => {
	const fromMs = Date.parse(`${fromDay}T00:00:00Z`);
	const toMs = Date.parse(`${toDay}T00:00:00Z`);

	if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
		return;
	}

	return Math.floor((toMs - fromMs) / DAY_IN_MS);
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

/** The part of a month that has elapsed by `nowMs`: [month start, month
 * close) once the month is over, [month start, nowMs) while it is open,
 * undefined before it starts. */
export const monthWindowSoFar = ({
	monthAnchor,
	nowMs
}: {
	monthAnchor: string;
	nowMs: number;
}): { fromMs: number; toMs: number; closed: boolean } | undefined => {
	const fromMs = monthStartMs(monthAnchor);
	const closeMs = monthEndMs(monthAnchor);

	if (nowMs <= fromMs) {
		return;
	}

	return { fromMs, toMs: Math.min(closeMs, nowMs), closed: nowMs >= closeMs };
};

/** The previous month's anchor relative to `nowMs`. */
export const previousMonthAnchor = (nowMs: number): string => {
	const d = new Date(nowMs);

	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCMonth(d.getUTCMonth() - 1);

	return monthAnchorFromMs(d.getTime());
};
