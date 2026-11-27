import type { MarketId, Outcome } from '#lib/types/market.ts';
import type { PrincipalText } from '@junobuild/schema';

export type OrderType = 'LIMIT' | 'MARKET';

export type OrderSide = 'BUY' | 'SELL';

/**
 * The surface a call was sized and placed from: the analytics `source` of
 * `position_taken`, `order_placed` and `call_size_set`. A closed vocabulary.
 */
export type CallSource = 'flow' | 'market_detail' | 'landing';

export interface Order {
	id: string;
	marketId: MarketId;
	owner: PrincipalText;
	side: OrderSide;
	outcome: Outcome;
	price: number; // 0.0 to 1.0
	qty: bigint;
	initQty: bigint;
	filledQty: bigint;
	status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED';
	createdAt: bigint;
}

export interface OrderBookLevel {
	price: number;
	totalQty: bigint;
	orderCount: number;
}
