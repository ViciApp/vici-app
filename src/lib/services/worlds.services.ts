import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import {
	monthAnchorFromMs,
	type AffiliationChampionship,
	type AffiliationStatsDoc
} from '#lib/types/affiliation-stats.ts';
import {
	AFFILIATION_LOCK_MS,
	affiliationKey,
	type AffiliationDoc,
	type AffiliationKind
} from '#lib/types/affiliation.ts';
import { withTimeout } from '#lib/utils/async.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
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
import { functions } from '$declarations/satellite/satellite.api';
import { deleteDoc, getDoc, setDoc } from '@junobuild/core';

/**
 * Hard timeout for the affiliation write path. Generous enough to cover
 * a slow IC update call (typical ~2s, occasionally longer), tight
 * enough that the picker's "joining…" spinner doesn't hang indefinitely
 * — which is what Giova observed on 2026-05-27 when a country pick
 * never resolved and never rejected, leaving the row stuck and the
 * `finally { saving = null }` branch unreachable.
 */
const AFFILIATION_WRITE_TIMEOUT_MS = 15_000;

/**
 * Worlds affiliations — thin FE service wrapping the satellite
 * read queries + the write / delete primitives via `@junobuild/core`.
 * Mirrors the leagues service shape; consumers (Worlds picker page,
 * Worlds detail / leaderboard) import the camelCase domain types
 * from here.
 *
 * The 90-day lock is enforced server-side by `assertSetAffiliation`
 * (locked computed from joinedAtMs) and `assertDeleteAffiliation`
 * (delete blocked until lock expires). The FE pre-empts the
 * lock-active branch with a `Date.now()` check so the user sees a
 * disabled-leave CTA instead of a thrown error.
 */

/**
 * Returns the caller's current `{ university?, country? }` pair.
 */
export const listMyAffiliations = async (): Promise<{
	university?: AffiliationDoc;
	country?: AffiliationDoc;
}> => {
	if (isWeb2Backend()) {
		return await getMyAffiliationsWeb2();
	}

	// The endpoint emits camelCase keys (see `AffiliationWireSchema`),
	// so the wire shape already matches `AffiliationDoc` and no
	// snake-case → camel-case projection is needed.
	const { university, country } = await functions.listMyAffiliations();

	return { university, country };
};

/**
 * Join an affiliation. Server computes the lock window from
 * `joinedAtMs`; the FE writes the matching `lockedUntilMs` so the
 * assert accepts. A pre-existing row for the same `(member, kind)`
 * means the slot is locked — throws with a clear error so the UI
 * surfaces a "switch after lock" state instead of failing on the
 * satellite assert.
 */
export const joinAffiliation = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationDoc> => {
	// The lock window is server arithmetic on this transport; the same hang
	// guard applies (the picker's spinner must never wait forever).
	if (isWeb2Backend()) {
		return await withTimeout({
			operation: setAffiliationWeb2({ kind, affiliationIdentifier }),
			timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
			label: 'joinAffiliation:web2'
		});
	}

	const identity = await safeGetIdentityOnce();
	const memberPrincipal = identity.getPrincipal().toText();
	const joinedAtMs = Date.now();
	const lockedUntilMs = joinedAtMs + AFFILIATION_LOCK_MS;
	const key = affiliationKey({ memberPrincipal, kind, affiliationIdentifier });

	// Pre-empt the "second slot of same kind" branch with a getDoc.
	// The doc key carries `${kind}/${id}` so the existing row would be
	// keyed differently (different id) for a fresh switch — but checking
	// any-row-for-the-kind needs a scan; defer that to the picker UI
	// which derives state from `listMyAffiliations`.
	const existing = await withTimeout({
		operation: getDoc<AffiliationDoc>({
			collection: Collection.AFFILIATIONS,
			key
		}),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'joinAffiliation:getDoc'
	});

	if (existing) {
		throw new Error('Already affiliated with this option.');
	}

	const doc: AffiliationDoc = {
		member: memberPrincipal,
		kind,
		affiliationIdentifier,
		joinedAtMs,
		lockedUntilMs
	};

	await withTimeout({
		operation: setDoc<AffiliationDoc>({
			collection: Collection.AFFILIATIONS,
			doc: { key, data: doc }
		}),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'joinAffiliation:setDoc'
	});

	return doc;
};

/**
 * Leave an affiliation — `deleteDoc` against the row. The satellite
 * assert hard-rejects if the lock hasn't expired; the FE should
 * disable the CTA pre-emptively (read `lockedUntilMs` vs
 * `Date.now()`) so users see the gate clearly.
 */
export const leaveAffiliation = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<void> => {
	// Idempotent server-side (a missing row is a clean success), with the same
	// lock gate the satellite delete-assert enforces.
	if (isWeb2Backend()) {
		await withTimeout({
			operation: removeAffiliationWeb2({ kind, affiliationIdentifier }),
			timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
			label: 'leaveAffiliation:web2'
		});

		return;
	}

	const identity = await safeGetIdentityOnce();
	const memberPrincipal = identity.getPrincipal().toText();
	const key = affiliationKey({ memberPrincipal, kind, affiliationIdentifier });

	const existing = await withTimeout({
		operation: getDoc<AffiliationDoc>({
			collection: Collection.AFFILIATIONS,
			key
		}),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'leaveAffiliation:getDoc'
	});

	if (!existing) {
		// Idempotent — nothing to delete.
		return;
	}

	await withTimeout({
		operation: deleteDoc<AffiliationDoc>({
			collection: Collection.AFFILIATIONS,
			doc: existing
		}),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'leaveAffiliation:deleteDoc'
	});
};

/**
 * Switch affiliations within a kind — leave the current row, then join
 * the new one. The satellite enforces the 90-day lock on the delete
 * leg; if `currentLockedUntilMs` is still in the future the helper
 * throws synchronously so the picker can render a lock-active CTA
 * without firing a doomed round-trip.
 *
 * **Atomicity caveat.** Switching isn't a single satellite hook — the
 * delete and the join are independent round-trips. If the join leg
 * fails (timeout / transient), we make a best-effort attempt to
 * re-create the previous affiliation so the user isn't stranded with
 * an empty slot. The rollback creates a fresh row at `Date.now()`,
 * which means the lock window resets — undesirable but strictly
 * better than no affiliation. When both the join and the rollback
 * fail (network gone / satellite down), the original error is
 * re-thrown so the caller surfaces a clear "switch didn't go
 * through" hint and the next refresh sees an empty slot the user
 * can re-pick. A canonical fix would be a server-side atomic switch
 * hook; tracked separately.
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

		throw new Error(`affiliations lock active — cannot switch for another ${daysLeft} day(s).`);
	}

	await leaveAffiliation({
		kind,
		affiliationIdentifier: currentAffiliationIdentifier
	});

	try {
		return await joinAffiliation({ kind, affiliationIdentifier: nextAffiliationIdentifier });
	} catch (joinErr) {
		// Best-effort rollback — re-join the previous affiliation so the
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
 * Project the satellite's snake_case wire schema for affiliation
 * stats to FE camelCase.
 */
const projectStatsWire = (s: {
	affiliationIdentifier: string;
	kind: AffiliationKind;
	totalCalls: number;
	wins: number;
	monthAnchor: string;
	monthTotalCalls: number;
	monthWins: number;
	updatedAtMs: number;
}): AffiliationStatsDoc => ({
	affiliationIdentifier: s.affiliationIdentifier,
	kind: s.kind,
	totalCalls: s.totalCalls,
	wins: s.wins,
	monthAnchor: s.monthAnchor,
	monthTotalCalls: s.monthTotalCalls,
	monthWins: s.monthWins,
	updatedAtMs: s.updatedAtMs
});

/**
 * Single-affiliation lookup. Returns `undefined` when the
 * affiliation has no stats doc yet (no member of it has had any
 * resolved trades). Callers should render as "unranked / no data".
 *
 * `getAffiliationStats` is the `Option<NestedStruct>` endpoint, so
 * the wire shape is already camelCase (matches `AffiliationStatsDoc`)
 * — no projection needed. `listAffiliationStats` below stays on the
 * snake_case `projectStatsWire` because it's a `Vec<NestedStruct>`
 * (Vec items aren't `#[json_data(nested)]`-wrapped).
 */
export const getAffiliationStats = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationStatsDoc | undefined> => {
	if (isWeb2Backend()) {
		return await getAffiliationStatsWeb2({ kind, affiliationIdentifier });
	}

	const { stats } = await functions.getAffiliationStats({ kind, affiliationIdentifier });

	return stats;
};

/**
 * Ranked leaderboard view of every affiliation of a kind. Sorted
 * server-side by accuracy desc → totalCalls desc → affiliationIdentifier asc.
 * Affiliations below `MIN_CALLS_FOR_RANK` are filtered out by the
 * aggregator.
 */
export const listAffiliationStats = async ({
	kind,
	limit
}: {
	kind: AffiliationKind;
	limit?: number;
}): Promise<AffiliationStatsDoc[]> => {
	if (isWeb2Backend()) {
		return await listAffiliationStatsWeb2({ kind, limit });
	}

	const { items } = await functions.listAffiliationStats({ kind, limit });

	return items.map(projectStatsWire);
};

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
	const items = isWeb2Backend()
		? await listWorldsMemberCountsWeb2(kind)
		: (await functions.listWorldsMemberCounts({ kind })).items;

	return items.reduce<Record<string, number>>((acc, item) => {
		acc[item.affiliationIdentifier] = item.memberCount;

		return acc;
	}, {});
};

/**
 * Champion history for one affiliation — the past months it finished
 * first in its kind's monthly ranking. Empty until at least one month
 * has closed with a ranked leader; the FE renders a "no champions
 * yet" state in that case.
 */
export const listAffiliationChampionships = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationChampionship[]> => {
	if (isWeb2Backend()) {
		return await listAffiliationChampionshipsWeb2({ kind, affiliationIdentifier });
	}

	const { items } = await functions.listAffiliationChampionships({ kind, affiliationIdentifier });

	return items.map((item) => ({
		monthAnchor: item.monthAnchor,
		accuracy: item.accuracy,
		monthTotalCalls: item.monthTotalCalls
	}));
};

/**
 * Fire the Worlds podium claim for a closed month. Per backend
 * Proposal 2: the user calls this themselves (typically when
 * they first land on the Worlds surface in a new calendar
 * month), and the satellite credits VXP if their current
 * affiliation finished top-3 in the snapshot.
 *
 * Idempotent: a second call for the same month either reports
 * `awardsAlreadyClaimed > 0` or `notEligible === true`. Safe to
 * fire-and-forget on every Worlds load.
 *
 * Throws when `monthAnchor` is not a closed month (e.g. the
 * current calendar month) — callers should always pass a YYYY-MM
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
}> =>
	// The web2 API also freezes closed months from its worker; the lazy
	// claim-on-visit stays because the per-user award grant is the claim
	// itself, and both paths share the idempotent month gate.
	isWeb2Backend()
		? claimWorldsPodiumPrizeWeb2({ monthAnchor })
		: functions.claimWorldsPodiumPrize({ monthAnchor });

/**
 * Compute the YYYY-MM anchor for the calendar month immediately
 * before the supplied timestamp's month (UTC). Convenience for the
 * "claim last month's podium on this month's first visit" pattern.
 */
export const previousMonthAnchor = (nowMs: number = Date.now()): string => {
	const now = new Date(nowMs);
	// First day of the current month minus one ms lands in the prior month.
	const firstOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

	return monthAnchorFromMs(firstOfMonth - 1);
};
