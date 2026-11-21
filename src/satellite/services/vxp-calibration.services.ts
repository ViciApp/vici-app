import type { ClearingDid, RegistryDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import {
	CLEARING_CANISTER_ID,
	REGISTRY_CANISTER_ID,
	VXP_LEDGER_CANISTER_ID
} from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VICI_ENGINE_ID } from '#lib/constants/icdc.constants.ts';
import {
	DAY_IN_MS,
	HOUR_IN_MS,
	MILLISECOND_IN_NANOSECONDS
} from '#lib/constants/time.constants.ts';
import {
	CALIBRATION_DAILY_CAP,
	CALIBRATION_HOURLY_CAP,
	CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
	VXP_CALIBRATION_REWARD_BASE_UNITS
} from '#lib/constants/vxp-economy.constants.ts';
import {
	calibrationAttemptKey,
	type CalibrationAttemptDoc,
	type CalibrationSide
} from '#lib/types/calibration.ts';
import type { CallSide } from '#lib/types/market.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import type { VxpOnboardingDoc } from '#lib/types/vxp-onboarding.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import {
	persistAward,
	reclaimAward,
	updateAward
} from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { call, msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Calibration reward: a fixed VXP bonus paid the first time a
 * *recovering* user correctly calls a finalised Vici binary market.
 *
 * The product intent: a user who has spent their balance down stays
 * engaged by reading markets right. The reward is small, fixed, and
 * only fires while the caller's available balance is below the recovery
 * floor, so it nudges depleted users back into the loop without paying
 * out to anyone with a healthy balance.
 *
 * Because this mints real on-chain VXP, every gate is enforced
 * server-side and the winning side is re-derived from the clearing
 * settlement: the FE-supplied `chosenSide` is only compared, never
 * trusted to define correctness. The caller can therefore never forge a
 * win. The first side called on a market is the one judged
 * ({@link judgeCalibrationCall}): a wrong guess returns `{ correct: false }`,
 * pays nothing and applies no penalty, but is recorded, so a later call on
 * the other side is refused (`already_called`).
 *
 * Idempotency and rate limiting both come off the `vxp_awards`
 * collection: the per-market award doc key
 * `{caller}/calibration/{seriesId}` makes a second claim on the same
 * market a collision, and the caller's `calibration` docs are counted by
 * key prefix to enforce the rolling hourly / daily caps. The side on record
 * lives apart, in `calibration_attempts`, since a miss has no award doc.
 */

const CALIBRATION_AWARD_TYPE = 'calibration';

/** Every reason a claim pays nothing; also the endpoint's result enum. */
export const CALIBRATION_REASONS = [
	'anonymous',
	'not_engaged_yet',
	'balance_above_floor',
	'not_vici_market',
	'not_binary',
	'not_finalised',
	'outcome_undetermined',
	'already_called',
	'rate_limited_hourly',
	'rate_limited_daily',
	'transfer_failed'
] as const;

type CalibrationReason = (typeof CALIBRATION_REASONS)[number];

/**
 * Structured result the FE switches on. `correct` is the calibration
 * outcome (independent of payout); `paidNow` / `alreadyClaimed` cover
 * the reward state; `reason` carries the machine-readable ineligibility
 * when nothing was paid.
 */
export interface CalibrationRewardResult {
	correct: boolean;
	paidNow: boolean;
	alreadyClaimed: boolean;
	rewardBaseUnits?: string;
	newBalanceBaseUnits?: string;
	blockIndex?: string;
	reason?: CalibrationReason;
	errorMessage?: string;
}

/**
 * Engagement gate: the caller has at least one paid VXP-onboarding
 * milestone (m1 / m2 / m3). Cheap proxy for "this user has actually
 * used the app", so a fresh signup can't farm rewards. Mirrors the
 * onboarding read used by the other award paths. Only the satellite
 * writes the ladder doc (`assertVxpOnboardingWrite`), so a caller cannot
 * mark a milestone paid to pass this gate.
 */
const hasEngaged = ({ caller, userKey }: { caller: Uint8Array; userKey: string }): boolean => {
	const onboardingDoc = getDocStore({
		collection: Collection.VXP_ONBOARDING,
		key: userKey,
		caller
	});

	if (isNullish(onboardingDoc)) {
		return false;
	}

	const doc = decodeDocData<VxpOnboardingDoc>(onboardingDoc.data);

	return (
		doc.milestones.m1.status === 'paid' ||
		doc.milestones.m2.status === 'paid' ||
		doc.milestones.m3.status === 'paid'
	);
};

/**
 * Vici-market gate: the series must be created by the Vici engine
 * (`engine_id == opt "eng_0"`) and carry a Binary payoff. Returns the
 * reason to reject with, or `undefined` when the gate passes.
 */
const checkMarketShape = async (seriesId: string): Promise<CalibrationReason | undefined> => {
	const { argTypes, result: resultType } = candidMethod({
		canister: 'registry',
		method: 'get_series'
	});
	const result = await call<[] | [RegistryDid.Series]>({
		canisterId: REGISTRY_CANISTER_ID,
		method: 'get_series',
		args: [[argTypes[0], seriesId]],
		result: resultType
	});

	const [series] = result;

	if (isNullish(series)) {
		return 'not_vici_market';
	}

	const [engineId] = series.engine_id;

	if (engineId !== VICI_ENGINE_ID) {
		return 'not_vici_market';
	}

	if (!('Binary' in series.payoff_type)) {
		return 'not_binary';
	}
};

/**
 * Resolution gate: the clearing settlement plan must be Finalised, and
 * the binary settlement price must resolve to a definite side. Returns
 * the winning side, or a rejection reason. The engine's binary rule is
 * `price > 0 ⇒ YES else NO`; a missing settlement / non-price
 * settlement leaves the outcome undetermined.
 */
const deriveWinningSide = async (
	seriesId: string
): Promise<{ side: CallSide } | { reason: CalibrationReason }> => {
	const { argTypes, result: resultType } = candidMethod({
		canister: 'clearing',
		method: 'get_settlement_status'
	});
	const result = await call<[] | [ClearingDid.SettlementStatusView]>({
		canisterId: CLEARING_CANISTER_ID,
		method: 'get_settlement_status',
		args: [[argTypes[0], seriesId]],
		result: resultType
	});

	const [view] = result;

	if (isNullish(view)) {
		return { reason: 'not_finalised' };
	}

	if (!('Finalised' in view.status)) {
		return { reason: 'not_finalised' };
	}

	if (!('Price' in view.settlement)) {
		return { reason: 'outcome_undetermined' };
	}

	return { side: view.settlement.Price.decimal.value > ZERO ? 'YES' : 'NO' };
};

/** How a call on a finalised market is judged; see {@link judgeCalibrationCall}. */
export type CalibrationVerdict = 'correct' | 'miss' | 'already_called';

/**
 * Records the caller's first judged call on a market (as a controller, the
 * `calibration_attempts` collection being controllers-scoped) and returns the
 * side on record. Read and write run in one message with no await between
 * them, so two claims cannot both record a side.
 */
const recordCalibrationCall = ({
	recipient,
	seriesId,
	chosenSide
}: {
	recipient: string;
	seriesId: string;
	chosenSide: CalibrationSide;
}): CalibrationSide => {
	const writer = controllerCaller('calibration attempt');
	const key = calibrationAttemptKey({ recipient, seriesId });

	const existing = getDocStore({
		collection: Collection.CALIBRATION_ATTEMPTS,
		key,
		caller: writer
	});

	if (nonNullish(existing)) {
		return decodeDocData<CalibrationAttemptDoc>(existing.data).chosenSide;
	}

	setDocStore({
		collection: Collection.CALIBRATION_ATTEMPTS,
		key,
		caller: writer,
		doc: { data: encodeDocData<CalibrationAttemptDoc>({ chosenSide, calledAtMs: timeMs() }) }
	});

	return chosenSide;
};

/**
 * The first side called on a finalised market is the one judged. The call is
 * recorded before the sides are compared, so the outcome is only ever revealed
 * for the side on record: a call on the other side is `already_called`, and
 * the side on record is judged `correct` or a `miss` every time it comes back
 * (a correct call that hit a rate limit is retried later).
 */
export const judgeCalibrationCall = ({
	recipient,
	seriesId,
	chosenSide,
	winningSide
}: {
	recipient: string;
	seriesId: string;
	chosenSide: CalibrationSide;
	winningSide: CalibrationSide;
}): CalibrationVerdict => {
	const calledSide = recordCalibrationCall({ recipient, seriesId, chosenSide });

	if (calledSide !== chosenSide) {
		return 'already_called';
	}

	return chosenSide === winningSide ? 'correct' : 'miss';
};

/**
 * Rate-limit gate. Counts the caller's `calibration` award docs whose
 * Juno-managed `created_at` falls within the rolling 1h / 24h windows.
 * `created_at` (not the in-body `earnedAtMs`) is the boundary because it
 * is stamped by the datastore on write and can't be set by the caller.
 * Returns the breached reason, or `undefined` when both caps allow one
 * more reward.
 */
const checkRateLimits = ({
	caller,
	recipient,
	nowMs
}: {
	caller: Uint8Array;
	recipient: string;
	nowMs: number;
}): CalibrationReason | undefined => {
	// The award docs are keyed `{recipient}/calibration/{seriesId}`, so the
	// builder with an empty `awardKey` yields this caller's calibration key
	// prefix. `matcher.key` is matched as a regex by the datastore, so
	// anchor it to the start to restrict the store-level scan to just this
	// caller's calibration docs instead of listing the whole collection.
	const prefix = vxpAwardKey({ recipient, awardType: CALIBRATION_AWARD_TYPE, awardKey: '' });
	const hourCutoffNs = BigInt(nowMs - HOUR_IN_MS) * MILLISECOND_IN_NANOSECONDS;
	const dayCutoffNs = BigInt(nowMs - DAY_IN_MS) * MILLISECOND_IN_NANOSECONDS;

	const { items } = listDocsStore({
		collection: Collection.VXP_AWARDS,
		caller,
		params: {
			matcher: {
				key: `^${prefix}`,
				// Docs outside the rolling day window can't count toward either
				// cap, so bound the scan at the store level too.
				created_at: { greater_than: dayCutoffNs }
			},
			// Newest first, so once the hourly cap is reached we can stop.
			order: { desc: true, field: 'created_at' }
		}
	});

	let hourCount = 0;
	let dayCount = 0;

	for (const [, item] of items) {
		const createdAtNs = item.created_at;

		// The store matcher already bounds to the day window; the guard is
		// defensive in case `created_at` is ever absent.
		if (nonNullish(createdAtNs) && createdAtNs >= dayCutoffNs) {
			dayCount += 1;

			if (createdAtNs >= hourCutoffNs) {
				hourCount += 1;
			}
		}

		// Ordered newest-first: once the hourly cap is met the rest can't
		// change the hourly outcome, so stop scanning early.
		if (hourCount >= CALIBRATION_HOURLY_CAP) {
			break;
		}
	}

	if (hourCount >= CALIBRATION_HOURLY_CAP) {
		return 'rate_limited_hourly';
	}

	if (dayCount >= CALIBRATION_DAILY_CAP) {
		return 'rate_limited_daily';
	}
};

/** Sends a claimed calibration reward and records its paid / failed outcome. */
const payCalibrationReward = async ({
	ledger,
	callerPrincipal,
	seriesId,
	amount,
	nowMs
}: {
	ledger: IcrcLedgerCanister;
	callerPrincipal: Principal;
	seriesId: string;
	amount: bigint;
	nowMs: number;
}): Promise<CalibrationRewardResult> => {
	const recipient = callerPrincipal.toText();
	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: callerPrincipal,
		amount,
		memo: `vxp:calibration:${seriesId}`
	});

	if (result.ok) {
		logInfo({
			message: 'calibration_paid',
			detail: {
				user: recipient,
				series_id: seriesId,
				amount: amount.toString(),
				block_index: result.blockIndex.toString()
			}
		});

		updateAward({
			recipient,
			awardType: CALIBRATION_AWARD_TYPE,
			awardKey: seriesId,
			patch: { status: 'paid', paidAtMs: nowMs, blockIndex: result.blockIndex.toString() }
		});

		const newBalance = await ledger.icrc1BalanceOf({
			account: { owner: callerPrincipal }
		});

		return {
			correct: true,
			paidNow: true,
			alreadyClaimed: false,
			rewardBaseUnits: amount.toString(),
			newBalanceBaseUnits: newBalance.toString(),
			blockIndex: result.blockIndex.toString()
		};
	}

	logError({
		message: 'calibration_failed',
		detail: {
			user: recipient,
			series_id: seriesId,
			amount: amount.toString(),
			error: result.error
		}
	});

	updateAward({
		recipient,
		awardType: CALIBRATION_AWARD_TYPE,
		awardKey: seriesId,
		patch: { status: 'failed', errorMessage: result.error }
	});

	return {
		correct: true,
		paidNow: false,
		alreadyClaimed: false,
		reason: 'transfer_failed',
		errorMessage: result.error
	};
};

/**
 * Caller-invoked endpoint. Returns the structured result above; never
 * throws on expected ineligibility (the FE renders the reason). Throws
 * only on unexpected satellite-internal failures so the runtime maps
 * them to canister errors for the client.
 */
export const claimCalibrationRewardFn = async ({
	seriesId,
	chosenSide
}: {
	seriesId: string;
	chosenSide: CallSide;
}): Promise<CalibrationRewardResult> => {
	const callerPrincipal = msgCaller();

	// 1. Anonymous principal can never earn a reward.
	if (callerPrincipal.isAnonymous()) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'anonymous' };
	}

	const caller = callerPrincipal.toUint8Array();
	const recipient = callerPrincipal.toText();

	// 6 (early). Per-market dedupe: a held award doc for this market
	// short-circuits before any cross-canister work. Already-claimed
	// markets report `correct: true` (the reward only exists when the
	// call was right) without re-paying. A `failed` one was judged
	// correct and passed every gate when it was earned, so it is sent
	// again at its recorded amount.
	const slot = reclaimAward({ recipient, awardType: CALIBRATION_AWARD_TYPE, awardKey: seriesId });

	if (slot.kind === 'held') {
		return { correct: true, paidNow: false, alreadyClaimed: true };
	}

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});

	if (slot.kind === 'retry') {
		return await payCalibrationReward({
			ledger,
			callerPrincipal,
			seriesId,
			amount: BigInt(slot.doc.amountBaseUnits),
			nowMs: timeMs()
		});
	}

	// 2. Engagement gate.
	if (!hasEngaged({ caller, userKey: recipient })) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'not_engaged_yet' };
	}

	// 3. Balance floor, the core bound: pay only while recovering.
	const balance = await ledger.icrc1BalanceOf({
		account: { owner: callerPrincipal }
	});

	if (balance >= CALIBRATION_RECOVERY_FLOOR_BASE_UNITS) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'balance_above_floor' };
	}

	// 4. Vici-market gate: engine eng_0 + Binary payoff.
	const marketReason = await checkMarketShape(seriesId);

	if (nonNullish(marketReason)) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: marketReason };
	}

	// 5. Resolution gate: Finalised + derive the winning side.
	const resolution = await deriveWinningSide(seriesId);

	if ('reason' in resolution) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: resolution.reason };
	}

	const verdict = judgeCalibrationCall({
		recipient,
		seriesId,
		chosenSide,
		winningSide: resolution.side
	});

	if (verdict === 'already_called') {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'already_called' };
	}

	// 8 (wrong path). A wrong call mints nothing and applies no penalty; it
	// is on record now. Returned before the rate-limit check so a wrong guess
	// doesn't consume the user's hourly / daily budget.
	if (verdict === 'miss') {
		return { correct: false, paidNow: false, alreadyClaimed: false };
	}

	const nowMs = timeMs();

	// 7. Rate limits: rolling 1h / 24h windows off `created_at`.
	const rateReason = checkRateLimits({ caller, recipient, nowMs });

	if (nonNullish(rateReason)) {
		return { correct: true, paidNow: false, alreadyClaimed: false, reason: rateReason };
	}

	// 8 (correct path). Persist the pending award, transfer, reconcile.
	const amount = VXP_CALIBRATION_REWARD_BASE_UNITS;
	const pending: VxpAwardDoc = {
		recipient,
		awardType: CALIBRATION_AWARD_TYPE,
		awardKey: seriesId,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs: nowMs
	};

	try {
		persistAward({
			recipient,
			awardType: CALIBRATION_AWARD_TYPE,
			awardKey: seriesId,
			doc: pending
		});
	} catch (e: unknown) {
		// A concurrent invocation already wrote the pending doc: treat as
		// already-claimed rather than double-paying.
		const msg = e instanceof Error ? e.message : String(e);

		logInfo({
			message: 'calibration_pending_blocked',
			detail: { user: recipient, series_id: seriesId, error: msg }
		});

		return { correct: true, paidNow: false, alreadyClaimed: true };
	}

	return await payCalibrationReward({ ledger, callerPrincipal, seriesId, amount, nowMs });
};
