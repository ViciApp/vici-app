import type { CallSide, Market } from '#lib/types/market.ts';

/**
 * One card in the Calibration practice deck: a finalised Vici-engine
 * binary market the user reads and calls. The resolved side is *not*
 * carried here: correctness is decided server-side by
 * `claimCalibrationReward`, never by the client (see
 * `vxp-awards.services.ts`). The card only needs enough to render the
 * question and the (hidden-until-commit) outcome framing.
 */
export interface CalibrationCard {
	/** The finalised binary market the user is calibrating against. */
	market: Market;
}

/**
 * Side the user committed on a Calibration card, narrowed to the two
 * binary sides the practice surface offers (SKIP is not a calibration
 * gesture: every card is a definite YES / NO call).
 */
export type CalibrationSide = CallSide;
