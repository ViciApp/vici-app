import type { AffiliationKind } from '#lib/types/affiliation.ts';

/**
 * A single affiliation's standings row for a Worlds kind — two parallel
 * windows, lifetime and monthly.
 *
 * It is used in two ways:
 *
 *  - **Live** (all-time board + current-month column + detail page): recomputed
 *    on read over the affiliation's current opted-in roster
 *    (`cohort.services` — `aggregateMembersLifetime` for the lifetime window,
 *    `aggregateMembersForMonth` for the current month). Nothing is persisted;
 *    a member who leaves or opts out simply drops out of the next read.
 *  - **Frozen** (a closed month's podium + champion cup): persisted once as an
 *    immutable snapshot doc keyed
 *    `${kind}/${affiliationIdentifier}/${monthAnchor}` under `AFFILIATION_STATS`
 *    (see {@link affiliationStatsSnapshotKey}). The Worlds podium freeze writes
 *    it (as a controller) the first time that month is claimed, capturing the
 *    ranking over the then-current opted-in roster so awards / cups stay
 *    stable. On a frozen row the lifetime fields mirror the monthly ones (the
 *    row is scoped to that month).
 *
 * `AFFILIATION_STATS` is write-`controllers`; `assertSetAffiliationStats`
 * enforces snapshot-key-only + write-once as defence in depth.
 */
export interface AffiliationStatsDoc {
	/** External id — matches `AffiliationDoc.affiliationIdentifier`. */
	affiliationIdentifier: string;
	/** `university` | `country` — same enum as `AffiliationDoc.kind`. */
	kind: AffiliationKind;
	/** Lifetime resolved-call count across the current roster. */
	totalCalls: number;
	/** Lifetime correct calls (the lifetime numerator). */
	wins: number;
	/** YYYY-MM tag that anchors the monthly window. */
	monthAnchor: string;
	/** Resolved calls in `monthAnchor`. */
	monthTotalCalls: number;
	/** Correct calls in `monthAnchor`. */
	monthWins: number;
	/** Last write / recompute timestamp (ms). */
	updatedAtMs: number;
}

/**
 * Real per-affiliation member tally for a Worlds kind. Returned by
 * the `listWorldsMemberCounts` aggregate so a surface that only needs
 * "N members" doesn't page the full roster.
 */
export interface AffiliationMemberCount {
	affiliationIdentifier: string;
	kind: AffiliationKind;
	memberCount: number;
}

/**
 * A single past month an affiliation finished first in its kind —
 * one champion "cup". Derived from the frozen monthly snapshots, so
 * this list grows one entry per closed month with a ranked leader
 * (there is no scheduled season-conclusion job — see
 * `listAffiliationChampionshipsFn`).
 */
export interface AffiliationChampionship {
	/** YYYY-MM of the month the affiliation topped its kind. */
	monthAnchor: string;
	/** Frozen month accuracy at the time of the win (0..1). */
	accuracy: number;
	/** Resolved calls behind that month's win. */
	monthTotalCalls: number;
}

/**
 * Canonical key builder for the **frozen** monthly snapshot doc — the only
 * shape `affiliation_stats` now stores. The Worlds podium freeze writes one
 * of these per ranked affiliation the first time a closed month is claimed,
 * capturing that month's totals over the then-current opted-in roster; the
 * podium and champion-cup reads then use them for an already-closed month.
 *
 * Key shape `${kind}/${affiliationIdentifier}/${monthAnchor}` — three
 * segments. Readers distinguish snapshots by slash count.
 */
export const affiliationStatsSnapshotKey = ({
	kind,
	affiliationIdentifier,
	monthAnchor
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
	monthAnchor: string;
}): string => `${kind}/${affiliationIdentifier}/${monthAnchor}`;

/**
 * Minimum resolved-call count before an affiliation appears on the
 * ranked leaderboard. Below this, accuracy is too noisy to be
 * meaningful (a single-member school at 1/1 = 100% would otherwise
 * top the chart). Set per product decision (Proposal 1.2 in
 * `docs/backend-proposals/README.md`): low bar for the first launch
 * to keep the leaderboard populated as activity ramps.
 */
export const MIN_CALLS_FOR_RANK = 50;
