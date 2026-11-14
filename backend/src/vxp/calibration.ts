// Calibration reward: a fixed VXP bonus paid the first time a RECOVERING
// user correctly calls a finalised Vici binary market. Every gate is
// server-side and the winning side is re-derived from the clearing
// settlement, so the client-supplied chosenSide is only compared, never
// trusted to define correctness. A wrong guess pays nothing and applies no
// penalty, but the first side called on a market is the one judged: a miss
// cannot be called again on the other side.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { getSettlementStatus } from '../engine/clearing';
import { getSeries, VICI_ENGINE_ID } from '../engine/registry';
import { ZERO } from '../lib/constants';
import { DAY_IN_MS, HOUR_IN_MS } from '../lib/time';
import { type AwardCap, getAward, grantCappedAward } from './awards';
import {
	CALIBRATION_DAILY_CAP,
	CALIBRATION_HOURLY_CAP,
	CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
	VXP_CALIBRATION_REWARD_BASE_UNITS
} from './constants';
import { getVxpBalance } from './payout';

export type CallSide = 'YES' | 'NO';

export type CalibrationReason =
	| 'not_engaged_yet'
	| 'balance_above_floor'
	| 'not_vici_market'
	| 'not_binary'
	| 'not_finalised'
	| 'outcome_undetermined'
	| 'already_called'
	| 'rate_limited_hourly'
	| 'rate_limited_daily'
	| 'recorded_only'
	| 'transfer_failed';

/** Structured result the client switches on: correct is the calibration
 * outcome independent of payout, paidNow/alreadyClaimed cover the reward
 * state, reason carries the machine-readable ineligibility. */
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

/** Engagement gate: the caller holds the onboarding registration grant, the
 * cheap proxy for "this user has actually used the app" that stops a fresh
 * signup from farming rewards. */
const hasEngaged = async (userId: string): Promise<boolean> => {
	const m1 = await getAward({ userId, awardType: 'onboarding', awardKey: 'm1' });

	return nonNullish(m1) && m1.status !== 'failed';
};

/** Vici-market gate: created by the Vici engine and carrying a Binary
 * payoff. Returns the rejection reason, or undefined when the gate passes. */
const checkMarketShape = async (seriesId: string): Promise<CalibrationReason | undefined> => {
	const series = await getSeries(seriesId);

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

/** Resolution gate: the settlement plan must be Finalised with a definite
 * binary price. The engine's binary rule is price > 0 means YES. */
const deriveWinningSide = async (
	seriesId: string
): Promise<{ side: CallSide } | { reason: CalibrationReason }> => {
	const view = await getSettlementStatus(seriesId);

	if (isNullish(view) || !('Finalised' in view.status)) {
		return { reason: 'not_finalised' };
	}

	if (!('Price' in view.settlement)) {
		return { reason: 'outcome_undetermined' };
	}

	return { side: view.settlement.Price.decimal.value > ZERO ? 'YES' : 'NO' };
};

/** Records the caller's first judged call on a market and returns the side
 * on record. The primary key settles concurrent calls too: the loser of the
 * insert reads the winner's side. */
const recordCall = async ({
	userId,
	seriesId,
	chosenSide
}: {
	userId: string;
	seriesId: string;
	chosenSide: CallSide;
}): Promise<CallSide> => {
	await query(
		`insert into calibration_attempts (user_id, series_id, chosen_side)
		 values ($1, $2, $3)
		 on conflict (user_id, series_id) do nothing`,
		[userId, seriesId, chosenSide]
	);

	const rows = await query<{ chosen_side: CallSide }>(
		`select chosen_side from calibration_attempts where user_id = $1 and series_id = $2`,
		[userId, seriesId]
	);

	const [row] = rows;

	if (isNullish(row)) {
		throw new Error(`calibration call on ${seriesId} for ${userId} was not recorded`);
	}

	return row.chosen_side;
};

/** Rolling 1h / 24h caps, counted off the server-stamped creation time of
 * the caller's calibration awards. */
const CALIBRATION_CAPS = [
	{ max: CALIBRATION_HOURLY_CAP, windowMs: HOUR_IN_MS, reason: 'rate_limited_hourly' },
	{ max: CALIBRATION_DAILY_CAP, windowMs: DAY_IN_MS, reason: 'rate_limited_daily' }
] as const satisfies readonly AwardCap<CalibrationReason>[];

/**
 * Session-gated claim. Never throws on expected ineligibility (the client
 * renders the reason); idempotency and rate limiting both come off the
 * caller's own calibration awards, so a second claim on the same market is
 * a clean already-claimed. A call that contradicts the side already on
 * record for the market is not judged again (already_called).
 */
export const claimCalibrationReward = async ({
	userId,
	seriesId,
	chosenSide
}: {
	userId: string;
	seriesId: string;
	chosenSide: CallSide;
}): Promise<CalibrationRewardResult> => {
	// Per-market dedupe, before any cross-canister work. Already-claimed
	// markets report correct (the reward only exists when the call was right)
	// without re-paying.
	const existing = await getAward({ userId, awardType: 'calibration', awardKey: seriesId });

	if (nonNullish(existing)) {
		return { correct: true, paidNow: false, alreadyClaimed: true };
	}

	if (!(await hasEngaged(userId))) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'not_engaged_yet' };
	}

	// Balance floor: the core bound, pay only while recovering.
	const balance = await getVxpBalance(userId);

	if (balance >= CALIBRATION_RECOVERY_FLOOR_BASE_UNITS) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'balance_above_floor' };
	}

	const marketReason = await checkMarketShape(seriesId);

	if (nonNullish(marketReason)) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: marketReason };
	}

	const resolution = await deriveWinningSide(seriesId);

	if ('reason' in resolution) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: resolution.reason };
	}

	// Recorded before the sides are compared, so the outcome is only ever
	// revealed for the side on record. The same side may come back (a correct
	// call that hit a rate limit is retried later).
	const calledSide = await recordCall({ userId, seriesId, chosenSide });

	if (calledSide !== chosenSide) {
		return { correct: false, paidNow: false, alreadyClaimed: false, reason: 'already_called' };
	}

	// A wrong call mints nothing and does not consume the caller's hourly /
	// daily budget.
	if (chosenSide !== resolution.side) {
		return { correct: false, paidNow: false, alreadyClaimed: false };
	}

	const amount = VXP_CALIBRATION_REWARD_BASE_UNITS;
	const outcome = await grantCappedAward({
		userId,
		awardType: 'calibration',
		awardKey: seriesId,
		amountBaseUnits: amount,
		memo: `vxp:calibration:${seriesId}`,
		caps: CALIBRATION_CAPS
	});

	if (outcome.outcome === 'capped') {
		return { correct: true, paidNow: false, alreadyClaimed: false, reason: outcome.reason };
	}

	if (outcome.outcome === 'already') {
		return { correct: true, paidNow: false, alreadyClaimed: true };
	}

	if (outcome.outcome === 'recorded') {
		return {
			correct: true,
			paidNow: false,
			alreadyClaimed: false,
			rewardBaseUnits: amount.toString(),
			reason: 'recorded_only'
		};
	}

	if (outcome.outcome === 'failed') {
		return {
			correct: true,
			paidNow: false,
			alreadyClaimed: false,
			reason: 'transfer_failed',
			errorMessage: outcome.error
		};
	}

	const newBalance = await getVxpBalance(userId);

	return {
		correct: true,
		paidNow: true,
		alreadyClaimed: false,
		rewardBaseUnits: amount.toString(),
		newBalanceBaseUnits: newBalance.toString(),
		blockIndex: outcome.outcome === 'paid' ? outcome.blockIndex : undefined
	};
};
