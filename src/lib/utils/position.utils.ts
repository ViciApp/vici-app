import type { ClearingDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import type { Market } from '#lib/types/market.ts';
import type { Position } from '#lib/types/position.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import { nonNullish } from '@dfinity/utils';

export const mapPositionData = (position: ClearingDid.Position): Position => {
	const { user, series_id: id, net_qty: qty, reserved_margin_usd: locked } = position;

	return {
		marketId: parseMarketId(id),
		user,
		outcomeId: position.outcome_id[0] ?? (qty > ZERO ? 'YES' : 'NO'),
		netQty: qty,
		lockedCollateral: locked
	};
};

/**
 * Did the user's predicted side match the resolved outcome? Returns
 * `null` when the market is not resolved, has no recorded outcome, or
 * the user holds no position on it. The two terminal values are
 * directly compatible with `FlowArtFrame`'s `state` prop.
 *
 * Mirrors the `positionResult` logic that lives inline in
 * `MarketDetailTabs.svelte`; consolidated here so the Portfolio
 * surface and the resolution choreography can share one source of
 * truth instead of duplicating the comparison.
 */
export const positionResolvedResult = ({
	market,
	position
}: {
	market: Pick<Market, 'status' | 'outcome'>;
	position?: Pick<Position, 'outcomeId' | 'netQty'> | null;
}): 'won' | 'lost' | null => {
	if (market.status !== 'Resolved' || !nonNullish(market.outcome) || !nonNullish(position)) {
		return null;
	}

	// `netQty` is signed (NO positions can be negative; see the
	// `qty > ZERO ? 'YES' : 'NO'` fallback in `mapPositionData`). A
	// zero quantity means the user has fully exited; treat that as
	// "no position" and skip the won/lost classification. Sign of
	// `netQty` itself doesn't carry side information here: the
	// `outcomeId` field is the source of truth for which outcome
	// the user predicted.
	if (position.netQty === ZERO) {
		return null;
	}

	return position.outcomeId === market.outcome ? 'won' : 'lost';
};
