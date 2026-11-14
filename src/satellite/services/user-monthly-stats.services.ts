import { Collection } from '#lib/constants/collections.constants.ts';
import {
	BOLD_CALLER_MEDIAN_THRESHOLD,
	MONTHLY_CONSENSUS_LIMIT,
	MONTHLY_MIN_CALLS,
	userMonthlyStatsKey,
	type UserMonthlyStatsDoc
} from '#lib/types/user-monthly-stats.ts';
import { MONTH_ANCHOR_RE } from '#lib/utils/month-anchor.utils.ts';
import { median } from '#lib/utils/stats.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import { decodeDocData, listDocsStore } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `user_monthly_stats`. The collection caches each
 * user's per-month gameplay counters (calls / wins / consensus samples) so
 * the monthly album awards (sharpest-eye, bold-caller) can be computed on
 * read. Writes are scoped to one's own row.
 *
 *  1. **Collection scope.** No-op for any other collection.
 *  2. **Key shape.** Doc key must equal `${owner}/${monthAnchor}` and match
 *     the embedded `(owner, monthAnchor)`: one canonical row per user-month.
 *  3. **monthAnchor format.** Must match `YYYY-MM` and agree with the key's
 *     month segment so a writer can't supply a structurally valid key with a
 *     mismatched embedded anchor.
 *  4. **Owner binds caller.** Only the user themselves can write their own
 *     monthly stats (mirrors the `user_stats` / affiliation-stats invariant).
 *  5. **Counters sane.** `monthCalls` / `monthWins` are finite, non-negative
 *     integers and `monthWins ≤ monthCalls`. NaN / Infinity are rejected.
 *  6. **Consensus non-empty when active.** If `monthCalls > 0` the consensus
 *     array must contain at least one sample so `median([])===0` can't let a
 *     writer with calls but no samples qualify for the bold-caller gate.
 *  7. **Consensus bounded + valid.** The consensus array can't grow past
 *     {@link MONTHLY_CONSENSUS_LIMIT}, and each value must be finite and in
 *     [0, 1]: a malicious or buggy writer can't bloat the doc or skew the
 *     median gate with out-of-range prices.
 *
 * Note (integrity trade-off): like `user_stats`, the assert does NOT verify
 * the counters against real clearing history: a determined user could
 * inflate their own monthly numbers. The award is cosmetic (no VXP payout),
 * so this matches the documented `user_stats` posture rather than warranting
 * a server-side history re-derivation.
 */
export const assertSetUserMonthlyStats = ({
	caller,
	data: {
		collection,
		key,
		data: { proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.USER_MONTHLY_STATS) {
		return;
	}

	const proposedDoc = decodeDocData<UserMonthlyStatsDoc>(proposed.data);

	// monthAnchor must be a well-formed YYYY-MM string.
	if (!MONTH_ANCHOR_RE.test(proposedDoc.monthAnchor)) {
		throw new Error(
			`user_monthly_stats monthAnchor "${proposedDoc.monthAnchor}" must match YYYY-MM (e.g. 2026-05).`
		);
	}

	const expectedKey = userMonthlyStatsKey({
		owner: proposedDoc.owner,
		monthAnchor: proposedDoc.monthAnchor
	});

	if (key !== expectedKey) {
		throw new Error(
			`user_monthly_stats key "${key}" must equal "${expectedKey}" (owner / monthAnchor).`
		);
	}

	// The key's month segment must also agree with the embedded anchor (guards
	// against a key whose suffix was built from a different anchor).
	const keyMonthSegment = key.split('/').pop();

	if (keyMonthSegment !== proposedDoc.monthAnchor) {
		throw new Error(
			`user_monthly_stats key month segment "${keyMonthSegment}" must match monthAnchor "${proposedDoc.monthAnchor}".`
		);
	}

	try {
		Principal.fromText(proposedDoc.owner);
	} catch {
		throw new Error('user_monthly_stats owner must be a valid principal text.');
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	if (proposedDoc.owner !== callerText) {
		throw new Error('user_monthly_stats owner must match the caller principal.');
	}

	// Counters must be finite, non-negative integers (NaN / Infinity both fail
	// the Number.isFinite check, and fractional values fail the integer check).
	if (
		!Number.isFinite(proposedDoc.monthCalls) ||
		!Number.isFinite(proposedDoc.monthWins) ||
		!Number.isInteger(proposedDoc.monthCalls) ||
		!Number.isInteger(proposedDoc.monthWins) ||
		proposedDoc.monthCalls < 0 ||
		proposedDoc.monthWins < 0
	) {
		throw new Error(
			'user_monthly_stats counters must be finite, non-negative integers (NaN / Infinity not allowed).'
		);
	}

	if (proposedDoc.monthWins > proposedDoc.monthCalls) {
		throw new Error('user_monthly_stats monthWins cannot exceed monthCalls.');
	}

	// When a user has calls, they must have at least one consensus sample so
	// the bold-caller gate can't be gamed with an empty array (median([])===0
	// would put the user below the threshold unconditionally).
	if (proposedDoc.monthCalls > 0 && proposedDoc.monthConsensus.length === 0) {
		throw new Error('user_monthly_stats monthConsensus must be non-empty when monthCalls > 0.');
	}

	if (proposedDoc.monthConsensus.length > MONTHLY_CONSENSUS_LIMIT) {
		throw new Error(
			`user_monthly_stats monthConsensus length (${proposedDoc.monthConsensus.length}) exceeds limit ${MONTHLY_CONSENSUS_LIMIT}.`
		);
	}

	for (const value of proposedDoc.monthConsensus) {
		if (!Number.isFinite(value) || value < 0 || value > 1) {
			throw new Error('user_monthly_stats monthConsensus values must be finite numbers in [0, 1].');
		}
	}
};

/**
 * One sharpest-eye podium entry. `placement` is 1 (gold) / 2 (silver) /
 * 3 (bronze). Accuracy is the month's `monthWins / monthCalls` as a 0..100
 * percentage.
 */
export interface MonthlyLeaderboardEntry {
	owner: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	placement: number;
}

/**
 * One bold-caller entry: the month's best accuracy among users whose median
 * consensus-at-call is below {@link BOLD_CALLER_MEDIAN_THRESHOLD}. Ties on
 * accuracy yield more than one entry. `medianConsensus` is the on-read median
 * of the user's bounded consensus array.
 */
export interface BoldCallerEntry {
	owner: string;
	monthCalls: number;
	monthWins: number;
	accuracy: number;
	medianConsensus: number;
}

const accuracyOf = (doc: { monthWins: number; monthCalls: number }): number =>
	doc.monthCalls > 0 ? (doc.monthWins / doc.monthCalls) * 100 : 0;

/**
 * Decode a `user_monthly_stats` payload, returning `undefined` for a
 * malformed row so the aggregator can drop it rather than trapping the whole
 * read.
 */
const decodeMonthlyStats = (
	data: Parameters<typeof decodeDocData>[0]
): UserMonthlyStatsDoc | undefined => {
	try {
		return decodeDocData<UserMonthlyStatsDoc>(data);
	} catch {
		// Malformed payload: treated as absent (the caller filters it out).
	}
};

/**
 * Aggregate every `user_monthly_stats` doc for `monthAnchor` and derive the
 * two monthly awards:
 *
 *  - **sharpest-eye** (`sharpestEye`): top-3 by accuracy among users with at
 *    least {@link MONTHLY_MIN_CALLS} resolved calls, with explicit
 *    gold / silver / bronze `placement`. Ties are broken by `monthCalls`
 *    descending then `owner` ascending so the placement is deterministic.
 *  - **bold-caller** (`boldCaller`): the best accuracy among the eligible
 *    (≥ MIN_CALLS) users whose median consensus-at-call is strictly below
 *    {@link BOLD_CALLER_MEDIAN_THRESHOLD}. Returns every user tied at that
 *    best accuracy (the source awards "the top bold-accuracy user(s)").
 *
 * Bounded by the number of users active in the month. The median is computed
 * on read from each doc's bounded consensus array.
 */
export const getMonthlyLeaderboardFn = ({
	monthAnchor
}: {
	monthAnchor: string;
}): { sharpestEye: MonthlyLeaderboardEntry[]; boldCaller: BoldCallerEntry[] } => {
	// Fast guard: reject a malformed anchor without scanning the collection.
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		return { sharpestEye: [], boldCaller: [] };
	}

	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.USER_MONTHLY_STATS,
		caller,
		params: {}
	});

	const suffix = `/${monthAnchor}`;

	const docs: UserMonthlyStatsDoc[] = items
		.filter(([key]) => key.endsWith(suffix))
		.map(([, item]) => decodeMonthlyStats(item.data))
		.filter((doc): doc is UserMonthlyStatsDoc => nonNullish(doc))
		// Guard against a stale month doc whose embedded anchor disagrees with
		// the key suffix (e.g. a malformed write that slipped the assert).
		.filter((doc) => doc.monthAnchor === monthAnchor);

	const eligible = docs.filter((doc) => doc.monthCalls >= MONTHLY_MIN_CALLS);

	// sharpest-eye: top-3 by accuracy, deterministic tie-break.
	const sharpestEye: MonthlyLeaderboardEntry[] = [...eligible]
		.sort((a, b) => {
			const accDelta = accuracyOf(b) - accuracyOf(a);

			if (accDelta !== 0) {
				return accDelta;
			}

			const callsDelta = b.monthCalls - a.monthCalls;

			if (callsDelta !== 0) {
				return callsDelta;
			}

			return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
		})
		.slice(0, 3)
		.map((doc, index) => ({
			owner: doc.owner,
			monthCalls: doc.monthCalls,
			monthWins: doc.monthWins,
			accuracy: accuracyOf(doc),
			placement: index + 1
		}));

	// bold-caller: best accuracy among eligible users whose median
	// consensus-at-call is below the threshold. Return every user tied at
	// that best accuracy.
	const bold = eligible
		.map((doc) => ({ doc, medianConsensus: median(doc.monthConsensus) }))
		.filter(({ medianConsensus }) => medianConsensus < BOLD_CALLER_MEDIAN_THRESHOLD);

	const bestBoldAccuracy = bold.reduce((best, { doc }) => Math.max(best, accuracyOf(doc)), -1);

	const boldCaller: BoldCallerEntry[] =
		bestBoldAccuracy < 0
			? []
			: bold
					.filter(({ doc }) => accuracyOf(doc) === bestBoldAccuracy)
					.sort((a, b) => (a.doc.owner < b.doc.owner ? -1 : a.doc.owner > b.doc.owner ? 1 : 0))
					.map(({ doc, medianConsensus }) => ({
						owner: doc.owner,
						monthCalls: doc.monthCalls,
						monthWins: doc.monthWins,
						accuracy: accuracyOf(doc),
						medianConsensus
					}));

	return { sharpestEye, boldCaller };
};
