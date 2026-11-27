import type { LandingCallSide } from '#lib/types/landing-call.ts';
import type { Market } from '#lib/types/market.ts';
import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';

/** A call the visitor has made, as the Markets view shows it back. */
export interface LandingMarketsCalled {
	side: LandingCallSide;
	pricePercent: number;
	amountVxp: number;
	/** What a right call earns, fixed when it was made. */
	earnsVxp: number;
}

/** Last week's real price history of one series, for the 24h move and the small charts. */
export interface LandingMarketsHistory {
	yes: number[];
	xs: number[];
	windowStartMs: number;
	windowEndMs: number;
}

/**
 * What every piece of the Markets view reads about a market and does with a
 * call, provided once by `LandingMarkets`. Reads go through the root's state,
 * so a template that calls them stays reactive.
 */
export interface LandingMarketsView {
	titleOf: (market: Market) => string;
	resolutionOf: (market: Market) => string;
	artOf: (market: Market) => FlowArtCategory;
	categoryOf: (market: Market) => string | undefined;
	moveOf: (market: Market) => number | undefined;
	historyOf: (market: Market) => LandingMarketsHistory | undefined;
	calledOf: (market: Market) => LandingMarketsCalled | undefined;
	pendingOf: (market: Market) => LandingCallSide | undefined;
	/** A call has been made here: further calls lead to the claim. */
	used: () => boolean;
	/** Yes / No on a list row: asks to confirm in the row. */
	onside: (call: { market: Market; side: LandingCallSide }) => void;
	onconfirm: () => void;
	oncancel: () => void;
	/** Yes / No that already name their price and earnings: the call is made. */
	oncall: (call: { market: Market; side: LandingCallSide }) => void;
}
