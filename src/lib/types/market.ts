import type { MarketIdSchema } from '#lib/schema/market.schema.ts';
import type { Token } from '#lib/types/token.ts';
import type { ClearingDid } from '$declarations';
import type { PrincipalText } from '@junobuild/schema';
import type * as z from 'zod';

export type MarketId = z.infer<typeof MarketIdSchema>;

export type TradingAccessUI = { type: 'Open' } | { type: 'Restricted'; groupIds: string[] };

export type MarketStatus = 'Open' | 'Expired' | 'Resolved';

export type OutcomeId = 'YES' | 'NO' | 'CANCELED' | string;

export type Outcome = OutcomeId;

/**
 * The two binary sides a user can call on. Strictly narrower than
 * `OutcomeId` (which also covers `'CANCELED'` and categorical ids) —
 * `CallSide` is what a user can *commit* on a binary market.
 */
export type CallSide = 'YES' | 'NO';

/**
 * Three possible Flow-mode gestures: tap/swipe `YES`, swipe `NO`, or
 * swipe up to `SKIP`. Used by `FlowCard` / `FlowMode` for the commit
 * choreography and by `motion-engine.utils.ts` for the beat payload.
 */
export type FlowAction = CallSide | 'SKIP';

export interface Market {
	id: MarketId;
	title: string;
	/**
	 * Free-text descriptive blurb (the series `description`). The "what is this
	 * market about" summary shown on the market card — distinct from
	 * {@link resolution}, which is the binding settlement clause.
	 */
	description: string;
	/**
	 * The settlement clause (`Series.resolution.clause`) stating how the market
	 * resolves. Surfaced under the "Resolution" / "Resolves YES if" sections of
	 * the detail and Flow back cards. Compulsory on-chain, so always present;
	 * historically markets defaulted it to their description.
	 */
	resolution: string;
	creator: PrincipalText;
	expiryDate: bigint; // timestamp in ms
	/**
	 * When trading opens, in ms — `undefined` when the market is live from
	 * registration (on-chain `start_ns: None`). When set and still in the future,
	 * the market is scheduled: discoverable on-chain but not yet tradeable. The
	 * feed gate withholds ANY scheduled market until this instant, whatever its
	 * tags (see `wc-schedule.utils`).
	 */
	startDate?: bigint; // timestamp in ms
	createdAt: bigint; // timestamp in ms
	status: MarketStatus;
	outcome?: Outcome;
	/**
	 * When settlement happened, in ms — `undefined` for an unresolved market, and
	 * also for a resolved one whose settlement carries no timestamp (a
	 * categorical `Outcome` input, or a price input settled without one). Sourced
	 * from clearing's on-chain `SettlementInput` where present, otherwise from the
	 * `SETTLEMENT` activity row. The only recency key a resolved market has:
	 * `createdAt` / `expiryDate` say nothing about *when it was called*, so any
	 * "most recently resolved" ordering must sort on this.
	 */
	resolvedAt?: bigint;
	outcomes?: {
		id: OutcomeId;
		title: string;
		probability?: number;
		volume?: bigint;
		totalPredictions?: number;
	}[];
	payoffType: 'Binary' | 'Categorical' | 'Call' | 'Put';
	isInviteOnly: boolean;
	inviteList: PrincipalText[];
	tradingAccess: TradingAccessUI[];
	totalVolume: bigint;
	yesVolume: bigint;
	noVolume: bigint;
	/**
	 * YES probability (0–1), derived from the live book mid. **Optional on
	 * purpose:** `undefined` means "not known yet" — the order book hasn't been
	 * read, or it was read and is empty. Consumers must render a loading
	 * skeleton (when {@link priceLoaded} is falsy) or a no-liquidity dash
	 * (when it's true) for `undefined`, never a 0.5 placeholder. Resolved
	 * markets pin this to 1 or 0.
	 */
	yesProbability?: number;
	/** NO probability (0–1) = `1 - yesProbability`. `undefined` mirrors {@link yesProbability}. */
	noProbability?: number;
	/**
	 * `true` once an order-book read has completed for this market (regardless
	 * of whether it had liquidity). Distinguishes *loading* (`false`/absent →
	 * skeleton) from *loaded but no liquidity* (`true` with nullish
	 * probability → dash). Resolved markets are `true`.
	 */
	priceLoaded?: boolean;
	bestBid?: number;
	bestAsk?: number;
	bestBidQty?: bigint;
	bestAskQty?: bigint;
	token: Token;
	pricePrecision: number;
	balanceDomain: ClearingDid.BalanceDomain;
	/**
	 * Engine that owns this series on the icdc-core registry, when set.
	 * Vici markets carry `eng_0` (`VICI_ENGINE_ID`); controller-created or
	 * third-party-engine series may carry a different id or none. Surfaces
	 * that must scope to Vici-engine markets — e.g. the Calibration
	 * practice deck — filter on this.
	 */
	engineId?: string;
	/**
	 * If this market was forked from another, the source market ID. A market
	 * is a "fork" iff this is defined; the public/root market always has
	 * `forkedFrom === undefined`.
	 */
	forkedFrom?: MarketId;
}
