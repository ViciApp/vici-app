import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
import type { AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';

/**
 * Lifetime accuracy of an affiliation as a 0..1 ratio. Returns `0`
 * when no calls have resolved yet (avoids a divide-by-zero).
 */
export const affiliationLifetimeAccuracy = (stats: AffiliationStatsDoc): number =>
	stats.totalCalls > 0 ? stats.wins / stats.totalCalls : 0;

/**
 * Current-month accuracy of an affiliation as a 0..1 ratio. Returns
 * `0` when no calls have resolved in the active month.
 */
export const affiliationMonthlyAccuracy = (stats: AffiliationStatsDoc): number =>
	stats.monthTotalCalls > 0 ? stats.monthWins / stats.monthTotalCalls : 0;

/**
 * Format a 0..1 accuracy as a one-decimal percentage string (e.g.
 * `72.5%`).
 */
export const formatAccuracyPercent = (accuracy: number): string =>
	`${(accuracy * 100).toFixed(1)}%`;

/**
 * Build the canonical affiliation-leaderboard comparator: accuracy
 * descending → call count descending → `affiliationIdentifier`
 * ascending (stable `localeCompare` tie-break).
 *
 * The accuracy basis (`accuracyOf`) and the call-count tie-break field
 * (`callsOf`) are passed separately because they do not always travel
 * together: a scope toggle may rank by monthly accuracy while still
 * tie-breaking on lifetime `totalCalls`.
 */
export const affiliationRankComparator =
	({
		accuracyOf,
		callsOf
	}: {
		accuracyOf: (stats: AffiliationStatsDoc) => number;
		callsOf: (stats: AffiliationStatsDoc) => number;
	}) =>
	// eslint-disable-next-line local-rules/prefer-object-params -- Array.sort comparators take two positional args by contract
	(a: AffiliationStatsDoc, b: AffiliationStatsDoc): number => {
		const accuracyA = accuracyOf(a);
		const accuracyB = accuracyOf(b);

		if (accuracyA !== accuracyB) {
			return accuracyB - accuracyA;
		}

		const callsA = callsOf(a);
		const callsB = callsOf(b);

		if (callsA !== callsB) {
			return callsB - callsA;
		}

		return a.affiliationIdentifier.localeCompare(b.affiliationIdentifier);
	};

/**
 * Lifetime affiliation-leaderboard comparator: lifetime accuracy →
 * lifetime `totalCalls` → identifier.
 */
export const compareAffiliationByLifetime = affiliationRankComparator({
	accuracyOf: affiliationLifetimeAccuracy,
	callsOf: (stats) => stats.totalCalls
});

/**
 * Monthly affiliation-leaderboard comparator: monthly accuracy →
 * monthly `monthTotalCalls` → identifier.
 */
export const compareAffiliationByMonth = affiliationRankComparator({
	accuracyOf: affiliationMonthlyAccuracy,
	callsOf: (stats) => stats.monthTotalCalls
});

/**
 * Pure helper for the UI — days remaining on a lock. Returns 0 once
 * the lock has expired so the FE can flip the CTA to "Leave".
 */
export const affiliationDaysLeft = ({
	lockedUntilMs,
	nowMs = Date.now()
}: {
	lockedUntilMs: number;
	nowMs?: number;
}): number => {
	const remaining = lockedUntilMs - nowMs;

	return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_IN_MS);
};
