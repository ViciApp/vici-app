import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { AffiliationChampionship, AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';
import type { AffiliationDoc, AffiliationKind } from '#lib/types/affiliation.ts';
import { withTimeout } from '#lib/utils/async.utils.ts';
import {
	claimWorldsPodiumPrize as claimWorldsPodiumPrizeWeb2,
	getAffiliationStats as getAffiliationStatsWeb2,
	getMyAffiliations as getMyAffiliationsWeb2,
	listAffiliationChampionships as listAffiliationChampionshipsWeb2,
	listAffiliationStats as listAffiliationStatsWeb2,
	listWorldsMemberCounts as listWorldsMemberCountsWeb2,
	removeAffiliation as removeAffiliationWeb2,
	setAffiliation as setAffiliationWeb2
} from '#lib/web2/client.ts';

/**
 * Hard timeout for the affiliation write path, so the picker's
 * "joining…" spinner never hangs on a request that neither resolves nor
 * rejects (which would leave the row stuck and the
 * `finally { saving = null }` branch unreachable).
 */
const AFFILIATION_WRITE_TIMEOUT_MS = 15_000;

/**
 * Worlds affiliations: thin FE service over the API's affiliation routes.
 * Mirrors the leagues service shape; consumers (Worlds picker page,
 * Worlds detail / leaderboard) import the camelCase domain types from here.
 *
 * The 90-day lock is enforced server-side. The FE pre-empts the
 * lock-active branch with a `Date.now()` check so the user sees a
 * disabled-leave CTA instead of a thrown error.
 */

/**
 * Returns the caller's current `{ university?, country? }` pair.
 */
export const listMyAffiliations = (): Promise<{
	university?: AffiliationDoc;
	country?: AffiliationDoc;
}> => getMyAffiliationsWeb2();

/**
 * Join an affiliation. The server computes the lock window and refuses a
 * second row of the same kind; the picker derives that state from
 * `listMyAffiliations` and switches through {@link switchAffiliation}.
 */
export const joinAffiliation = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationDoc> =>
	withTimeout({
		operation: setAffiliationWeb2({ kind, affiliationIdentifier }),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'joinAffiliation'
	});

/**
 * Leave an affiliation. Idempotent server-side (a missing row is a clean
 * success); the server rejects a leave inside the lock window, and the FE
 * disables the CTA pre-emptively (read `lockedUntilMs` vs `Date.now()`) so
 * users see the gate clearly.
 */
export const leaveAffiliation = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<void> => {
	await withTimeout({
		operation: removeAffiliationWeb2({ kind, affiliationIdentifier }),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'leaveAffiliation'
	});
};

/**
 * Switch affiliations within a kind: leave the current row, then join
 * the new one. The server enforces the 90-day lock on the leave leg; if
 * `currentLockedUntilMs` is still in the future the helper throws
 * synchronously so the picker can render a lock-active CTA without firing
 * a doomed round-trip.
 *
 * **Atomicity caveat.** The leave and the join are independent
 * round-trips. If the join leg fails (timeout / transient), we make a
 * best-effort attempt to re-create the previous affiliation so the user
 * isn't stranded with an empty slot. The rollback creates a fresh row at
 * `Date.now()`, which means the lock window resets: undesirable but
 * strictly better than no affiliation. When both the join and the
 * rollback fail, the original error is re-thrown so the caller surfaces
 * a clear "switch didn't go through" hint and the next refresh sees an
 * empty slot the user can re-pick.
 */
export const switchAffiliation = async ({
	kind,
	currentAffiliationIdentifier,
	currentLockedUntilMs,
	nextAffiliationIdentifier
}: {
	kind: AffiliationKind;
	currentAffiliationIdentifier: string;
	currentLockedUntilMs: number;
	nextAffiliationIdentifier: string;
}): Promise<AffiliationDoc> => {
	if (Date.now() < currentLockedUntilMs) {
		const daysLeft = Math.ceil((currentLockedUntilMs - Date.now()) / DAY_IN_MS);

		throw new Error(`affiliations lock active: cannot switch for another ${daysLeft} day(s).`);
	}

	await leaveAffiliation({
		kind,
		affiliationIdentifier: currentAffiliationIdentifier
	});

	try {
		return await joinAffiliation({ kind, affiliationIdentifier: nextAffiliationIdentifier });
	} catch (joinErr) {
		// Best-effort rollback: re-join the previous affiliation so the
		// user has *something* on the leaderboard. If the rollback also
		// fails we swallow it (logging) and surface the original error,
		// since the user's primary action ("switch to X") is what failed.
		try {
			await joinAffiliation({
				kind,
				affiliationIdentifier: currentAffiliationIdentifier
			});
		} catch (rollbackErr) {
			console.error('switchAffiliation: rollback also failed', rollbackErr);
		}

		throw joinErr;
	}
};

/**
 * Single-affiliation lookup. Returns `undefined` when the
 * affiliation has no stats doc yet (no member of it has had any
 * resolved trades). Callers should render as "unranked / no data".
 */
export const getAffiliationStats = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationStatsDoc | undefined> =>
	getAffiliationStatsWeb2({ kind, affiliationIdentifier });

/**
 * Ranked leaderboard view of every affiliation of a kind. Sorted
 * server-side by accuracy desc → totalCalls desc → affiliationIdentifier asc.
 * Affiliations below `MIN_CALLS_FOR_RANK` are filtered out by the
 * aggregator.
 */
export const listAffiliationStats = ({
	kind,
	limit
}: {
	kind: AffiliationKind;
	limit?: number;
}): Promise<AffiliationStatsDoc[]> => listAffiliationStatsWeb2({ kind, limit });

/**
 * Real member counts for every affiliation of a kind. Returned as a
 * map keyed by `affiliationIdentifier` for O(1) lookup from the picker
 * / detail surfaces; an affiliation with no members is simply absent
 * (callers read a missing key as zero).
 */
export const listWorldsMemberCounts = async ({
	kind
}: {
	kind: AffiliationKind;
}): Promise<Record<string, number>> => {
	const items = await listWorldsMemberCountsWeb2(kind);

	return items.reduce<Record<string, number>>((acc, item) => {
		acc[item.affiliationIdentifier] = item.memberCount;

		return acc;
	}, {});
};

/**
 * Champion history for one affiliation: the past months it finished
 * first in its kind's monthly ranking. Empty until at least one month
 * has closed with a ranked leader; the FE renders a "no champions
 * yet" state in that case.
 */
export const listAffiliationChampionships = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationChampionship[]> =>
	listAffiliationChampionshipsWeb2({ kind, affiliationIdentifier });

/**
 * Fire the Worlds podium claim for a closed month: the API credits VXP if
 * the caller's current affiliation finished top-3 in the snapshot. The
 * API's worker also freezes closed months; the claim-on-visit stays
 * because the per-user award grant is the claim itself, and both paths
 * share the idempotent month gate.
 *
 * Idempotent: a second call for the same month either reports
 * `awardsAlreadyClaimed > 0` or `notEligible === true`. Safe to
 * fire-and-forget on every Worlds load.
 *
 * Throws when `monthAnchor` is not a closed month (e.g. the
 * current calendar month): callers should always pass a YYYY-MM
 * strictly before the current one.
 */
export const claimWorldsPodiumPrize = ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<{
	monthAnchor: string;
	awardsCreated: number;
	awardsAlreadyClaimed: number;
	notEligible: boolean;
}> => claimWorldsPodiumPrizeWeb2({ monthAnchor });
