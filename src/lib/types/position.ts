import type { MarketId, OutcomeId } from '#lib/types/market.ts';
import type { Principal } from '@icp-sdk/core/principal';

export interface Position {
	marketId: MarketId;
	user: Principal;
	outcomeId: string; // 'YES', 'NO', or categorical ID
	netQty: bigint;
	lockedCollateral: bigint;
}

/**
 * Synthesized record for a position the user already settled. The clearing
 * canister removes settled `Position` rows during settlement and emits one
 * `EventType::Settled` event per position with the signed cashflow as `qty`;
 * this type is what the FE assembles from those events so the Portfolio,
 * market-detail, and inbox surfaces can render a resolution outcome the same
 * way they render live positions.
 *
 * `realizedPnlUsd` is in `USD_DECIMALS` units (matches `Position.lockedCollateral`)
 * so it can flow into existing PnL formatters without conversion.
 *
 * `outcomeId` is only known precisely when the user *won*: in that case it
 * equals `market.outcome`. For losers we leave it `undefined` because a
 * single Settled event can't disambiguate which losing outcome the user held
 * (a categorical-loser could have been on any non-winning outcome).
 */
export interface ResolvedPosition {
	marketId: MarketId;
	outcomeId?: OutcomeId;
	realizedPnlUsd: bigint;
	result: 'won' | 'lost' | 'neutral';
	timestampNs: bigint;
	eventId: bigint;
}
