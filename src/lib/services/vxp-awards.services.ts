import type { CallSide } from '#lib/types/market.ts';
import { claimCalibrationReward as claimCalibrationRewardApi } from '#lib/web2/client.ts';

/**
 * Client wrappers around the VXP-awards routes.
 *
 * Streak and referral awards are paid server-side by the writes that earn
 * them and need no client call. The surface the FE has to actively call is
 * the **calibration reward**, since it depends on the user's own balance
 * state and the market they just resolved.
 */

/**
 * Reason codes the server returns when a calibration reward cannot be
 * paid this invocation. Re-exported so UI can switch on them without
 * pulling the entire generated type surface.
 */
export type VxpCalibrationReason =
	| 'anonymous'
	| 'not_engaged_yet'
	| 'balance_above_floor'
	| 'not_vici_market'
	| 'not_binary'
	| 'not_finalised'
	| 'outcome_undetermined'
	| 'rate_limited_hourly'
	| 'rate_limited_daily'
	// The other side of this market is already on record, so this call is not
	// judged.
	| 'already_called'
	// The award was recorded without a transfer (treasury parallel-run mode);
	// the reconciliation job pays it out later.
	| 'recorded_only'
	| 'transfer_failed';

export interface VxpCalibrationClaim {
	/** Whether the side the user picked matched the resolved outcome. */
	correct: boolean;
	/** Whether this invocation triggered a fresh payout. */
	paidNow: boolean;
	/** Whether a reward for this market was already recorded. */
	alreadyClaimed: boolean;
	/** Reward credited this invocation, VXP base units, decimal string. */
	rewardBaseUnits?: string;
	/** Caller's available balance after the payout, base units, if paid. */
	newBalanceBaseUnits?: string;
	/** Ledger block index of the payout, decimal string, if paid. */
	blockIndex?: string;
	/** Machine-readable reason when not eligible / failed. */
	reason?: VxpCalibrationReason;
	/** Free-form error text when `reason === 'transfer_failed'`. */
	errorMessage?: string;
}

/**
 * Claim a calibration reward for a finalised Vici binary market.
 *
 * `chosenSide` is the side the user called; the server re-derives the
 * winning side from the clearing settlement, so a wrong guess returns
 * `{ correct: false }` and mints nothing. The server validates
 * engagement (≥1 paid VXP-onboarding milestone), the balance recovery
 * floor, the market shape (Vici engine + binary payoff), the resolution
 * (finalised), per-market dedupe, and the hourly / daily rate limits
 * before transferring the reward.
 *
 * Always resolves with a structured result: never rejects on expected
 * ineligibility. The FE renders a different state per `reason`.
 * Rejection here only happens on transport-level errors.
 */
export const claimCalibrationReward = async ({
	seriesId,
	chosenSide
}: {
	seriesId: string;
	chosenSide: CallSide;
}): Promise<VxpCalibrationClaim> =>
	// A signed-out caller gets a 401 before the claim logic runs, which covers
	// the `anonymous` reason.
	await claimCalibrationRewardApi({ seriesId, chosenSide });
