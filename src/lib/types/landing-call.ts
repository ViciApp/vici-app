/** The side of a call a signed-out visitor makes on the landing page. */
export type LandingCallSide = 'yes' | 'no';

/**
 * A call a signed-out visitor makes on the landing page. It places no order:
 * the page carries it into sign-up. `pricePercent` is the chosen side's price
 * (0–100) when the call was made.
 */
export interface LandingCall {
	seriesId: string;
	side: LandingCallSide;
	pricePercent: number;
	atMs: number;
	/** The call size in VXP, where the surface has a size control (Markets); absent otherwise. */
	amountVxp?: number;
}

/** A call made from the Markets view, which always carries its size. */
export type LandingMarketsCall = LandingCall & { amountVxp: number };
