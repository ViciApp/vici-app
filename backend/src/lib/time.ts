// Time conversions. Nanosecond timestamps are the unit of IC protocol fields
// and of the dedup stamps the custody, award and analytics tables keep.

import { nonNullish } from '@dfinity/utils';

const NS_PER_MS = BigInt(1_000_000);

export const msToNs = (ms: number): bigint => BigInt(ms) * NS_PER_MS;

export const nowNs = (): bigint => msToNs(Date.now());

/** A nullable `bigint` milliseconds column, selected as `::text`, as an optional number. */
export const optionalMs = (value: string | null): number | undefined =>
	nonNullish(value) ? Number(value) : undefined;
