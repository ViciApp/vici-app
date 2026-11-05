import { Collection } from '#lib/constants/collections.constants.ts';
import {
	affiliationStatsSnapshotKey,
	type AffiliationStatsDoc
} from '#lib/types/affiliation-stats.ts';
import { nonNullish } from '@dfinity/utils';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `affiliation_stats`.
 *
 * The collection is now write-`controllers` and holds **only** immutable
 * frozen monthly snapshots — one per `(kind, affiliationIdentifier, monthAnchor)`,
 * keyed `${kind}/${affiliationIdentifier}/${monthAnchor}` (3 segments). They are
 * written by the Worlds podium freeze (`vxp-worlds-podium.services`) as a
 * controller at the moment a closed month's podium is first claimed, capturing
 * the ranking over the then-current opted-in roster. The live windows
 * (all-time, current month) are recomputed on read from the roster and are
 * never persisted here.
 *
 * This assert is defence in depth on top of the controllers-only write rule:
 *
 *  1. **Collection scope.** No-op for any other collection.
 *  2. **Snapshot key only.** The key must equal the canonical snapshot key for
 *     the doc's `(kind, affiliationIdentifier, monthAnchor)`. Rolling
 *     (2-segment) keys are no longer written and are rejected.
 *  3. **Write-once.** A frozen month is immutable history — any write over an
 *     existing snapshot is rejected.
 *  4. **`monthAnchor` format.** Must be a well-formed `YYYY-MM`.
 *  5. **Counter sanity.** Both windows' counters are finite, non-negative
 *     integers, and `wins ≤ totalCalls` / `monthWins ≤ monthTotalCalls` — a
 *     corrupted snapshot would otherwise break the ranking math it feeds.
 */
const MONTH_ANCHOR_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

export const assertSetAffiliationStats = ({
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.AFFILIATION_STATS) {
		return;
	}

	const proposedDoc = decodeDocData<AffiliationStatsDoc>(proposed.data);

	if (!MONTH_ANCHOR_RE.test(proposedDoc.monthAnchor)) {
		throw new Error(
			`affiliation_stats monthAnchor "${proposedDoc.monthAnchor}" must match YYYY-MM.`
		);
	}

	const snapshotKey = affiliationStatsSnapshotKey({
		kind: proposedDoc.kind,
		affiliationIdentifier: proposedDoc.affiliationIdentifier,
		monthAnchor: proposedDoc.monthAnchor
	});

	if (key !== snapshotKey) {
		throw new Error(
			`affiliation_stats accepts only frozen monthly snapshots keyed ${snapshotKey}, got ${key}.`
		);
	}

	// Write-once: a frozen month cannot be rewritten.
	if (nonNullish(current)) {
		throw new Error(
			`affiliation_stats snapshot ${key} is write-once; a frozen month cannot be rewritten.`
		);
	}

	// Counters must be finite, non-negative integers on both windows —
	// NaN / Infinity / fractional / negative would corrupt ranking math.
	if (
		!isNonNegativeInteger(proposedDoc.totalCalls) ||
		!isNonNegativeInteger(proposedDoc.wins) ||
		!isNonNegativeInteger(proposedDoc.monthTotalCalls) ||
		!isNonNegativeInteger(proposedDoc.monthWins)
	) {
		throw new Error(
			'affiliation_stats counters must be finite, non-negative integers (NaN / Infinity / negative not allowed).'
		);
	}

	if (proposedDoc.wins > proposedDoc.totalCalls) {
		throw new Error(
			`affiliation_stats wins (${proposedDoc.wins}) cannot exceed totalCalls (${proposedDoc.totalCalls}).`
		);
	}

	if (proposedDoc.monthWins > proposedDoc.monthTotalCalls) {
		throw new Error(
			`affiliation_stats monthWins (${proposedDoc.monthWins}) cannot exceed monthTotalCalls (${proposedDoc.monthTotalCalls}).`
		);
	}
};
