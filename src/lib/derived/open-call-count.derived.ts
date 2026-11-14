import { marketById } from '#lib/derived/market-by-id.derived.ts';
import { orders } from '#lib/derived/orders.derived.ts';
import { positions } from '#lib/derived/positions.derived.ts';
import type { MarketId } from '#lib/types/market.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * Count of the viewer's open calls: live positions plus resting limit orders,
 * both restricted to markets that are not yet resolved. A market can flip to
 * `Resolved` before its settlement lands (and before the stores catch up), so
 * that window is filtered out to keep a decided call from inflating the count.
 * Shared so the Dash hero, the holdings breakdown, and the transaction-history
 * summary all read the same figure.
 */
export const openCallCount: Readable<number> = derived(
	[positions, orders, marketById],
	([$positions, $orders, $marketById]) => {
		const isUnresolved = (marketId: MarketId): boolean =>
			$marketById.get(marketId)?.status !== 'Resolved';

		const openPositions = $positions.filter(({ marketId }) => isUnresolved(marketId)).length;
		const openOrders = $orders.filter(({ series_id }) =>
			isUnresolved(series_id as MarketId)
		).length;

		return openPositions + openOrders;
	}
);
