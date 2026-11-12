import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_WORLDS_PODIUM } from '#lib/constants/vxp-economy.constants.ts';
import { affiliationStatsSnapshotKey, monthAnchorFromMs } from '#lib/types/affiliation-stats.ts';
import type { AffiliationDoc, AffiliationKind } from '#lib/types/affiliation.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	hasFrozenMonthlySnapshotFn,
	listAffiliationStatsForMonthFn,
	liveMonthlyRows,
	readAffiliationDoc
} from '#satellite/services/cohort.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	encodeDocData,
	getAdminAccessKeys,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Worlds podium monthly payout — user-claim variant
 * (Proposal 2 in `docs/backend-proposals/README.md`).
 *
 * The economy fires monthly podium awards (400/200/100
 * VXP for top-3 affiliations of each kind × every member). Juno
 * doesn't expose a scheduled-task primitive yet, so we model the
 * payout as a **user-claim** rather than an admin fan-out:
 *
 *  1. The user calls `claimWorldsPodiumPrize({ monthAnchor })`
 *     from the FE — typically on the first visit of a new month.
 *  2. The endpoint reads the closed month's snapshot from
 *     `AFFILIATION_STATS`, finds the top-3 ranking per kind, and
 *     checks if the caller's current affiliations match.
 *  3. For each match (up to two — one university, one country),
 *     the endpoint creates a `VXP_AWARDS` doc keyed
 *     `${caller}/worlds_podium/${YYYY-MM}_${place}` and credits
 *     the ledger transfer (same pattern as the streak hook).
 *
 * Idempotency: the doc key collision rejects a second claim. A
 * user who tries again hits `already_claimed` cleanly. The assert's
 * recipient-binds-caller invariant is preserved because the user
 * is writing their own award.
 *
 * Eligibility per backend-proposals/README.md §2.3 — member at
 * month-end qualifies regardless of join date. The 90-day affiliation
 * lock means a user who joined late in the month is still locked
 * in for the next quarter, which is the engagement-incentive
 * trade-off the user signed up for.
 *
 * Tie-break per §2.2 — accuracy → totalCalls → affiliationIdentifier asc.
 * `listAffiliationStatsForMonthFn` already sorts this way, so the
 * leaderboard and the claim agree on who's gold/silver/bronze.
 */

// `VXP_WORLDS_PODIUM` holds the human-readable whole-VXP prizes
// (400 / 200 / 100 — the same values the FE renders). VXP has 4 decimals
// and this award pays the ledger inline (see `processAward`), so the
// amounts must be base units sized via `vxpBaseUnits` — `BigInt(400)` would
// transfer 400 base units = 0.04 VXP, a 10⁴x under-pay.
const PODIUM_PLACES: ReadonlyArray<{
	place: 'gold' | 'silver' | 'bronze';
	amount: bigint;
}> = [
	{ place: 'gold', amount: vxpBaseUnits(VXP_WORLDS_PODIUM.gold) },
	{ place: 'silver', amount: vxpBaseUnits(VXP_WORLDS_PODIUM.silver) },
	{ place: 'bronze', amount: vxpBaseUnits(VXP_WORLDS_PODIUM.bronze) }
] as const;

const KINDS: ReadonlyArray<AffiliationKind> = ['university', 'country'] as const;

export interface ClaimWorldsPodiumPrizeResult {
	monthAnchor: string;
	awardsCreated: number;
	awardsAlreadyClaimed: number;
	notEligible: boolean;
}

/**
 * Freeze a closed month's affiliation ranking the first time its podium is
 * claimed (frozen-at-close). The live windows recompute over the current
 * roster on every read; a *closed* month is instead captured once here — the
 * ranking over the then-current opted-in roster ({@link liveMonthlyRows}) is
 * written as immutable snapshot docs, so the podium payout and the champion
 * cup stay stable and can't drift as members later churn.
 *
 * All-or-nothing gate: {@link hasFrozenMonthlySnapshotFn} short-circuits once
 * the month has any snapshot, so only the first claim writes the set and later
 * claims leave it untouched. Written as a controller (the collection is
 * controllers-write) with values from the server's own recompute, so a client
 * cannot forge a frozen ranking. Only affiliations clearing `MIN_CALLS_FOR_RANK`
 * are captured (the only rows that can rank / appear).
 *
 * Fails **closed**: if no controller key is available the freeze cannot run,
 * so it throws rather than letting the claim fall back to an unfrozen (live,
 * drift-prone) ranking and pay VXP against it. The whole claim aborts and the
 * caller can retry once a controller is configured — no payout on an
 * unfrozen month.
 */
const freezeMonthlySnapshotsIfNeeded = ({
	kind,
	monthAnchor,
	nowMs
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs: number;
}): void => {
	if (hasFrozenMonthlySnapshotFn({ kind, monthAnchor })) {
		return;
	}

	const admin = getAdminAccessKeys()[0]?.[0];

	if (isNullish(admin)) {
		logError({
			message: 'worlds_podium freeze aborted — no controller key available',
			detail: { kind, monthAnchor }
		});

		throw new Error(
			`claimWorldsPodiumPrize: cannot freeze ${kind}/${monthAnchor} — no satellite controller available.`
		);
	}

	const { rows } = liveMonthlyRows({ kind, monthAnchor, nowMs });

	for (const row of rows) {
		const key = affiliationStatsSnapshotKey({
			kind,
			affiliationIdentifier: row.affiliationIdentifier,
			monthAnchor
		});

		setDocStore({
			collection: Collection.AFFILIATION_STATS,
			key,
			caller: admin,
			doc: {
				data: encodeDocData(row)
			}
		});
	}
};

/**
 * Per-user claim endpoint. Returns counts so the FE can render a
 * toast like "+400 VXP for your school's gold finish" when at
 * least one award lands.
 */
export const claimWorldsPodiumPrizeFn = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<ClaimWorldsPodiumPrizeResult> => {
	if (!/^\d{4}-\d{2}$/.test(monthAnchor)) {
		throw new Error(
			`claimWorldsPodiumPrize: invalid monthAnchor "${monthAnchor}" (expected YYYY-MM).`
		);
	}

	const nowMs = Number(time() / 1_000_000n);
	const currentMonth = monthAnchorFromMs(nowMs);

	if (monthAnchor >= currentMonth) {
		throw new Error(
			`claimWorldsPodiumPrize: month ${monthAnchor} is not yet closed (current month is ${currentMonth}).`
		);
	}

	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	let awardsCreated = 0;
	let awardsAlreadyClaimed = 0;
	let foundAnyEligibleAffiliation = false;

	for (const kind of KINDS) {
		// Frozen-at-close: the first claim of the month captures the ranking over
		// the current opted-in roster so the podium + cup stay stable across
		// claimants. A no-op once the month is already frozen.
		freezeMonthlySnapshotsIfNeeded({ kind, monthAnchor, nowMs });

		// Read the caller's current affiliation for this kind.
		const myAffiliation = readMyAffiliation({ callerText, callerBytes, kind });

		if (isNullish(myAffiliation)) {
			// No affiliation for this kind — caller is not eligible.
		} else {
			// Top-3 for the requested (now frozen) month.
			const top3 = listAffiliationStatsForMonthFn({ kind, monthAnchor }).slice(0, 3);
			const placeIndex = top3.findIndex(
				(s) => s.affiliationIdentifier === myAffiliation.affiliationIdentifier
			);

			if (placeIndex === -1) {
				// Not on the podium for this kind.
			} else {
				foundAnyEligibleAffiliation = true;
				const { place, amount } = PODIUM_PLACES[placeIndex];

				const awardKey = `${monthAnchor}_${place}`;
				const docKey = vxpAwardKey({
					recipient: callerText,
					awardType: 'worlds_podium',
					awardKey
				});

				const existing = getDocStore({
					collection: Collection.VXP_AWARDS,
					key: docKey,
					caller: callerBytes
				});

				if (nonNullish(existing)) {
					awardsAlreadyClaimed += 1;
				} else {
					awardsCreated += await processAward({
						kind,
						place,
						amount,
						awardKey,
						docKey,
						caller,
						callerText,
						callerBytes,
						monthAnchor,
						nowMs
					});
				}
			}
		}
	}

	return {
		monthAnchor,
		awardsCreated,
		awardsAlreadyClaimed,
		notEligible: !foundAnyEligibleAffiliation && awardsAlreadyClaimed === 0
	};
};

/**
 * Write the pending award, fire the ledger transfer, transition to
 * paid/failed. Returns 1 to bump the `awardsCreated` counter.
 *
 * Split out so the main claim loop stays free of `continue` and the
 * pending/paid/failed flow has a single home.
 */
const processAward = async ({
	kind,
	place,
	amount,
	awardKey,
	docKey,
	caller,
	callerText,
	callerBytes,
	monthAnchor,
	nowMs
}: {
	kind: AffiliationKind;
	place: 'gold' | 'silver' | 'bronze';
	amount: bigint;
	awardKey: string;
	docKey: string;
	caller: Principal;
	callerText: string;
	callerBytes: Uint8Array;
	monthAnchor: string;
	nowMs: number;
}): Promise<number> => {
	// Create the award in `pending` state, then attempt the ledger
	// transfer. On success, transition to `paid`. On failure,
	// transition to `failed`. Mirrors the streak-award flow.
	const pendingDoc: VxpAwardDoc = {
		recipient: callerText,
		awardType: 'worlds_podium',
		awardKey,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs: nowMs
	};

	setDocStore({
		collection: Collection.VXP_AWARDS,
		key: docKey,
		caller: callerBytes,
		doc: {
			data: encodeDocData(pendingDoc)
		}
	});

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});
	const transferResult = await transferWithBadFeeRetry({
		ledger,
		toOwner: caller,
		amount,
		memo: `vxp:worlds_podium:${awardKey}`
	});

	// Re-read the doc to pick up the version stamp from the
	// `pending` write above.
	const pendingExisting = getDocStore({
		collection: Collection.VXP_AWARDS,
		key: docKey,
		caller: callerBytes
	});

	if (transferResult.ok) {
		logInfo({
			message: 'worlds_podium credited',
			detail: {
				amount,
				recipient: callerText,
				kind,
				place,
				monthAnchor
			}
		});
		setDocStore({
			collection: Collection.VXP_AWARDS,
			key: docKey,
			caller: callerBytes,
			doc: {
				data: encodeDocData<VxpAwardDoc>({
					...pendingDoc,
					status: 'paid',
					paidAtMs: nowMs,
					blockIndex: transferResult.blockIndex.toString()
				}),
				version: pendingExisting?.version
			}
		});
	} else {
		logError({
			message: 'worlds_podium transfer failed',
			detail: {
				recipient: callerText,
				kind,
				place,
				monthAnchor,
				error: transferResult.error
			}
		});
		setDocStore({
			collection: Collection.VXP_AWARDS,
			key: docKey,
			caller: callerBytes,
			doc: {
				data: encodeDocData<VxpAwardDoc>({
					...pendingDoc,
					status: 'failed',
					errorMessage: transferResult.error
				}),
				version: pendingExisting?.version
			}
		});
	}

	return 1;
};

const readMyAffiliation = ({
	callerText,
	callerBytes,
	kind
}: {
	callerText: string;
	callerBytes: Uint8Array;
	kind: AffiliationKind;
}): AffiliationDoc | undefined => {
	// The affiliation doc key is `${memberPrincipal}/${kind}/${affiliationIdentifier}`
	// — we don't know `affiliationIdentifier` yet, so we scan and filter. Two
	// max possibilities per user (one per kind), so the bound is tight.
	// Skipping the scan entirely is hard without a reverse-index doc.
	const prefix = `${callerText}/${kind}/`;

	// `listDocsStore` doesn't support prefix params in the current
	// SDK; we filter manually.
	const { items } = listDocsStore({
		collection: Collection.AFFILIATIONS,
		caller: callerBytes,
		params: {}
	});

	for (const [docKey, item] of items) {
		if (docKey.startsWith(prefix)) {
			try {
				const doc = readAffiliationDoc(item.data);

				if (nonNullish(doc) && doc.kind === kind && doc.member === callerText) {
					return doc;
				}
			} catch {
				// skip malformed
			}
		}
	}
};
