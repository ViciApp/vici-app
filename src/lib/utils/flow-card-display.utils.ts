import type { MarketWhyNow } from '#lib/types/market-metadata.ts';
import type { CallSide, Market } from '#lib/types/market.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Crowd-consensus YES percentage (0–100), or `undefined` when the market's
 * probability is unknown (book unread / no liquidity). Callers must not coerce
 * `undefined` into a number: render a {@link MarketProbabilitySkeleton} or skip,
 * never a fabricated 50.
 */
export const consensusPercent = (market: Market): number | undefined =>
	isNullish(market.yesProbability)
		? undefined
		: Math.round(Math.max(0, Math.min(1, market.yesProbability)) * 100);

/**
 * Which side the crowd leans, or `undefined` when there's no consensus yet
 * (unknown probability). A nullish percentage maps to `undefined` rather than
 * defaulting to a 50/50 'NO' lean.
 */
export const consensusSide = (market: Market): CallSide | undefined => {
	const pct = consensusPercent(market);

	return isNullish(pct) ? undefined : pct >= 50 ? 'YES' : 'NO';
};

export const formatWhyNowChip = (whyNow: MarketWhyNow | undefined): string | undefined => {
	if (!whyNow?.text?.trim()) {
		return;
	}

	return whyNow.text.trim();
};
