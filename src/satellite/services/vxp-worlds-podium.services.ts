import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_WORLDS_PODIUM } from '#lib/constants/vxp-economy.constants.ts';
import {
	affiliationFreezeKey,
	affiliationStatsSnapshotKey,
	type AffiliationFreezeDoc
} from '#lib/types/affiliation-stats.ts';
import {
	AFFILIATION_KINDS,
	type AffiliationDoc,
	type AffiliationKind
} from '#lib/types/affiliation.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { MONTH_ANCHOR_RE, monthAnchorFromMs } from '#lib/utils/month-anchor.utils.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	frozenMonthlyRanking,
	hasFrozenMonthlySnapshotFn,
	heldAffiliations,
	monthlyFreeze,
	settledMonthlyRows,
	unfrozenRows
} from '#satellite/services/cohort.services.ts';
import { persistAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { joinedBeforeMonthClose } from '#satellite/utils/worlds-podium.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	encodeDocData,
	getAdminAccessKeys,
	getDocStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Worlds podium monthly payout: user-claim variant.
 *
 * The economy fires monthly podium awards (`VXP_WORLDS_PODIUM`, for
 * top-3 affiliations of each kind × every member). Juno
 * doesn't expose a scheduled-task primitive yet, so we model the
 * payout as a **user-claim** rather than an admin fan-out:
 *
 *  1. The user calls `claimWorldsPodiumPrize({ monthAnchor })`
 *     from the FE: typically on the first visit of a new month.
 *  2. The endpoint reads the closed month's frozen snapshot from
 *     `AFFILIATION_STATS` (freezing it from settled history on the
 *     month's first claim), finds the top-3 ranking per kind, and
 *     checks if the caller's current affiliations match and were
 *     joined before the month closed.
 *  3. For each match (up to two: one university, one country),
 *     the endpoint creates a `VXP_AWARDS` doc keyed
 *     `${caller}/worlds_podium/${YYYY-MM}_${place}` and credits
 *     the ledger transfer (same pattern as the streak hook).
 *
 * Idempotency: the doc key collision rejects a second claim. A
 * user who tries again hits `already_claimed` cleanly. The assert's
 * recipient-binds-caller invariant is preserved because the user
 * is writing their own award.
 *
 * Eligibility: a member at month-end qualifies regardless of join date,
 * as long as the slot was joined before the month closed
 * ({@link joinedBeforeMonthClose}). The 90-day affiliation lock means a
 * user who joined late in the month is still locked in for the next
 * quarter, which is the engagement-incentive trade-off the user signed
 * up for.
 *
 * Ranking: each affiliation's members' settled calls and wins over the
 * closed month, read from the clearing canister ({@link settledMonthlyRows}),
 * never the client-written monthly stats the live board displays. Tie-break:
 * accuracy → totalCalls → affiliationIdentifier asc, the leaderboard's rule.
 */

// `VXP_WORLDS_PODIUM` holds the human-readable whole-VXP prizes (the
// same values the FE renders). VXP has 4 decimals
// and this award pays the ledger inline (see `processAward`), so the
// amounts must be base units sized via `vxpBaseUnits`: `BigInt(400)` would
// transfer 400 base units = 0.04 VXP, a 10⁴x under-pay.
const PODIUM_PLACES: ReadonlyArray<{
	place: 'gold' | 'silver' | 'bronze';
	amount: bigint;
}> = [
	{ place: 'gold', amount: vxpBaseUnits(VXP_WORLDS_PODIUM.gold) },
	{ place: 'silver', amount: vxpBaseUnits(VXP_WORLDS_PODIUM.silver) },
	{ place: 'bronze', amount: vxpBaseUnits(VXP_WORLDS_PODIUM.bronze) }
] as const;

export interface ClaimWorldsPodiumPrizeResult {
	monthAnchor: string;
	awardsCreated: number;
	awardsAlreadyClaimed: number;
	notEligible: boolean;
	/** This call wrote toward freezing the month and paid nothing: claim again. */
	freezePending?: boolean;
}

/**
 * How many docs one podium claim writes toward a month's freeze. Each
 * serverless write costs billions of instructions, so a large ranking is
 * frozen over several calls (see the bulk-rewrite budget note in
 * docs/ai/satellite/patterns.md).
 */
const WORLDS_FREEZE_BATCH = 5;

/**
 * Freeze a closed month's affiliation ranking the first time its podium is
 * claimed (frozen-at-close), a bounded batch of docs per call. The live
 * windows recompute over the current roster on every read; a *closed* month
 * is instead captured once here: the first call computes the ranking from
 * settled history ({@link settledMonthlyRows}) and records it in the month's
 * freeze doc ({@link AffiliationFreezeDoc}), the next calls write its rows
 * out as immutable snapshot docs, at most {@link WORLDS_FREEZE_BATCH} per
 * call, and the call that writes the last of them marks the freeze
 * complete. The ranking is computed once, so it cannot drift between calls;
 * the podium payout and the champion cup read the snapshots only once the
 * freeze is complete, and stay stable as members later churn.
 *
 * Returns whether this call wrote anything: a claim pays only on a call
 * that wrote nothing toward a freeze, so its own writes stay bounded too. A
 * month frozen before freeze docs existed (snapshots, no freeze doc) was
 * written all at once and counts as complete. Written as a controller (the
 * collection is controllers-write) with values from the server's own
 * recompute, so a client cannot forge a frozen ranking. Only affiliations
 * clearing `MIN_CALLS_FOR_RANK` are captured (the only rows that can rank /
 * appear).
 *
 * Fails **closed**: if no controller key is available the freeze cannot run,
 * so it throws rather than letting the claim fall back to an unfrozen (live,
 * drift-prone) ranking and pay VXP against it. The whole claim aborts and the
 * caller can retry once a controller is configured; no payout on an
 * unfrozen month.
 */
const advanceMonthlyFreeze = async ({
	kind,
	monthAnchor,
	nowMs
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs: number;
}): Promise<boolean> => {
	const { freeze, version } = monthlyFreeze({ kind, monthAnchor }) ?? {};

	if (
		freeze?.complete === true ||
		(isNullish(freeze) && hasFrozenMonthlySnapshotFn({ kind, monthAnchor }))
	) {
		return false;
	}

	const admin = getAdminAccessKeys()[0]?.[0];

	if (isNullish(admin)) {
		logError({
			message: 'worlds_podium freeze aborted: no controller key available',
			detail: { kind, monthAnchor }
		});

		throw new Error(
			`claimWorldsPodiumPrize: cannot freeze ${kind}/${monthAnchor}; no satellite controller available.`
		);
	}

	const writeFreeze = ({ doc, version }: { doc: AffiliationFreezeDoc; version?: bigint }) =>
		setDocStore({
			collection: Collection.AFFILIATION_STATS,
			key: affiliationFreezeKey({ kind, monthAnchor }),
			caller: admin,
			doc: { data: encodeDocData(doc), version }
		});

	if (isNullish(freeze)) {
		const rows = await settledMonthlyRows({ kind, monthAnchor, nowMs });

		writeFreeze({ doc: { kind, monthAnchor, rows, complete: rows.length === 0 } });

		return true;
	}

	const unwritten = unfrozenRows(freeze);
	const batch = unwritten.slice(0, WORLDS_FREEZE_BATCH - 1);

	for (const row of batch) {
		setDocStore({
			collection: Collection.AFFILIATION_STATS,
			key: affiliationStatsSnapshotKey({
				kind,
				affiliationIdentifier: row.affiliationIdentifier,
				monthAnchor
			}),
			caller: admin,
			doc: {
				data: encodeDocData(row)
			}
		});
	}

	if (batch.length === unwritten.length) {
		writeFreeze({ doc: { ...freeze, complete: true }, version });
	}

	return true;
};

/**
 * Per-user claim endpoint. Returns counts so the FE can render a
 * toast for the finish when at least one award lands.
 */
export const claimWorldsPodiumPrizeFn = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<ClaimWorldsPodiumPrizeResult> => {
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		throw new Error(
			`claimWorldsPodiumPrize: invalid monthAnchor "${monthAnchor}" (expected YYYY-MM).`
		);
	}

	const nowMs = timeMs();
	const currentMonth = monthAnchorFromMs(nowMs);

	if (monthAnchor >= currentMonth) {
		throw new Error(
			`claimWorldsPodiumPrize: month ${monthAnchor} is not yet closed (current month is ${currentMonth}).`
		);
	}

	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	// Frozen-at-close: the first claims of the month capture the ranking from
	// settled history so the podium + cup stay stable across claimants, and
	// nothing is paid until both kinds are frozen.
	for (const kind of AFFILIATION_KINDS) {
		if (await advanceMonthlyFreeze({ kind, monthAnchor, nowMs })) {
			return {
				monthAnchor,
				awardsCreated: 0,
				awardsAlreadyClaimed: 0,
				notEligible: false,
				freezePending: true
			};
		}
	}

	let awardsCreated = 0;
	let awardsAlreadyClaimed = 0;
	let foundAnyEligibleAffiliation = false;

	for (const kind of AFFILIATION_KINDS) {
		const mine = readMyAffiliation({ callerText, callerBytes, kind });

		if (
			isNullish(mine) ||
			// Juno's own `created_at`, not caller-written `joinedAtMs` (held to ±10 min, enough to backdate a join).
			!joinedBeforeMonthClose({ joinedAtNs: mine.createdAtNs, monthAnchor })
		) {
			// No affiliation for this kind, or one joined after close: not eligible.
		} else {
			const { affiliation: myAffiliation } = mine;

			// Top-3 of the frozen month only: an unfrozen month (nothing cleared
			// the rank floor) has no podium, never a fallback to the live board.
			const top3 = frozenMonthlyRanking({ kind, monthAnchor }).slice(0, 3);
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
						caller,
						callerText,
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
	caller,
	callerText,
	monthAnchor,
	nowMs
}: {
	kind: AffiliationKind;
	place: 'gold' | 'silver' | 'bronze';
	amount: bigint;
	awardKey: string;
	caller: Principal;
	callerText: string;
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

	persistAward({ recipient: callerText, awardType: 'worlds_podium', awardKey, doc: pendingDoc });

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});
	const transferResult = await transferWithBadFeeRetry({
		ledger,
		toOwner: caller,
		amount,
		memo: `vxp:worlds_podium:${awardKey}`
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
		updateAward({
			recipient: callerText,
			awardType: 'worlds_podium',
			awardKey,
			patch: {
				status: 'paid',
				paidAtMs: nowMs,
				blockIndex: transferResult.blockIndex.toString()
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
		updateAward({
			recipient: callerText,
			awardType: 'worlds_podium',
			awardKey,
			patch: { status: 'failed', errorMessage: transferResult.error }
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
}): { affiliation: AffiliationDoc; createdAtNs: bigint } | undefined =>
	// The same row `settledMonthlyRows` ranks the member under.
	heldAffiliations({ caller: callerBytes, member: callerText, kind })[0];
