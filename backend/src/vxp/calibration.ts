// Calibration reward: a fixed VXP bonus paid the first time a RECOVERING
// user correctly calls a finalised Vici binary market. Every gate is
// server-side and the winning side is re-derived from the clearing
// settlement, so the client-supplied chosenSide is only compared, never
// trusted to define correctness. A wrong guess pays nothing, writes nothing
// and applies no penalty.

import { isNullish, nonNullish } from '@dfinity/utils';
import { getSettlementStatus } from '../engine/clearing';
import { getSeries, VICI_ENGINE_ID } from '../engine/registry';
import { ZERO } from '../lib/constants';
import { countUserAwardsSince, getAward, grantAward } from './awards';
import {
	CALIBRATION_DAILY_CAP,
	CALIBRATION_HOURLY_CAP,
	CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
	VXP_CALIBRATION_REWARD_BASE_UNITS
} from './constants';
import { getVxpBalance } from './payout';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type CallSide = 'YES' | 'NO';

export type CalibrationReason =
	| 'not_engaged_yet'
	| 'balance_above_floor'
	| 'not_vici_market'
	| 'not_binary'
	| 'not_finalised'
	| 'outcome_undetermined'
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

/** Rolling 1h / 24h caps, counted off the server-stamped creation time of
 * the caller's calibration awards. */
const checkRateLimits = async ({
	userId,
	nowMs
}: {
	userId: string;
	nowMs: number;
}): Promise<CalibrationReason | undefined> => {
	const hourCount = await countUserAwardsSince({
		userId,
		awardType: 'calibration',
		sinceMs: nowMs - HOUR_MS
	});

	if (hourCount >= CALIBRATION_HOURLY_CAP) {
		return 'rate_limited_hourly';
	}

	const dayCount = await countUserAwardsSince({
		userId,
		awardType: 'calibration',
		sinceMs: nowMs - DAY_MS
	});

	if (dayCount >= CALIBRATION_DAILY_CAP) {
		return 'rate_limited_daily';
	}
};

/**
 * Session-gated claim. Never throws on expected ineligibility (the client
 * renders the reason); idempotency and rate limiting both come off the
 * caller's own calibration awards, so a second claim on the same market is
 * a clean already-claimed.
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

	// A wrong call mints nothing, records nothing, and does not consume the
	// caller's hourly / daily budget.
	if (chosenSide !== resolution.side) {
		return { correct: false, paidNow: false, alreadyClaimed: false };
	}

	const rateReason = await checkRateLimits({ userId, nowMs: Date.now() });

	if (nonNullish(rateReason)) {
		return { correct: true, paidNow: false, alreadyClaimed: false, reason: rateReason };
	}

	const amount = VXP_CALIBRATION_REWARD_BASE_UNITS;
	const outcome = await grantAward({
		userId,
		awardType: 'calibration',
		awardKey: seriesId,
		amountBaseUnits: amount,
		memo: `vxp:calibration:${seriesId}`
	});

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
