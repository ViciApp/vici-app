import { marketById } from '#lib/derived/market-by-id.derived.ts';
import { tradeHistory, tradeHistoryNotInitialized } from '#lib/derived/trade-history.derived.ts';
import type { ResolvedPosition } from '#lib/types/position.ts';
import {
	isSettledEvent,
	settledEventToResolvedPosition
} from '#lib/utils/resolved-position.utils.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * Resolved positions synthesized from the user's `Settled` events. Replaces
 * the previous `$positions` filter on `market.status === 'Resolved'`, which
 * never returned anything because the clearing canister deletes positions
 * at settlement (see `prepare_settlement_impl` in `icdc-core`).
 *
 * Ordered newest-first so the Portfolio "Resolved" section, market detail,
 * and inbox all share one canonical sort. Joins each event to its `Market`
 * so consumers don't have to do the lookup themselves.
 */
export const resolvedPositions: Readable<ResolvedPosition[]> = derived(
	[tradeHistory, marketById],
	([$tradeHistory, $marketById]) =>
		$tradeHistory
			.filter(isSettledEvent)
			.map((event) => {
				// Parse once and pass both pieces into the mapper so the
				// validation cost is paid exactly once per event.
				const marketId = parseMarketId(event.series_id);

				return settledEventToResolvedPosition({
					event,
					marketId,
					market: $marketById.get(marketId)
				});
			})
			.sort((a, b) => {
				// bigint compare without losing precision through Number.
				if (a.timestampNs === b.timestampNs) {
					return 0;
				}

				return a.timestampNs > b.timestampNs ? -1 : 1;
			})
);

/**
 * Mirrors `positionsNotInitialized` semantics: true while the underlying
 * trade-history fetch hasn't completed yet, so the Portfolio surface can
 * show a skeleton instead of an "empty resolved list" flash.
 */
export const resolvedPositionsNotInitialized: Readable<boolean> = tradeHistoryNotInitialized;

/**
 * Count of the viewer's *decisive* resolved predictions — won or lost,
 * excluding break-even `neutral` settlements. Drives the "no predictions
 * settled yet" empty state for the headline accuracy figure (see
 * `displayAccuracyPct`): `0` here means the user can't have been wrong yet, so
 * their accuracy renders an optimistic 100% rather than a misleading 0%.
 */
export const decisiveSettledCount: Readable<number> = derived(
	resolvedPositions,
	($resolvedPositions) =>
		$resolvedPositions.filter((position) => position.result !== 'neutral').length
);
