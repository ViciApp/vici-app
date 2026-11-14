import type { MarketWhyNow } from '#lib/types/market-metadata.ts';
import type { CallSide, Market } from '#lib/types/market.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Crowd-consensus YES percentage (0–100), or `undefined` when the market's
 * probability is unknown (book unread / no liquidity). Callers must not coerce
 * `undefined` into a number: render a {@link MarketOddsSkeleton} or skip,
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

export const sparklinePoints = ({
	yesPercent,
	seed,
	eventCount = 7
}: {
	yesPercent: number;
	seed: string;
	eventCount?: number;
}): number[] => {
	let h = 0;

	for (let i = 0; i < seed.length; i++) {
		h = (h * 31 + seed.charCodeAt(i)) | 0;
	}

	const points: number[] = [];
	const base = Math.max(5, Math.min(95, yesPercent));

	for (let i = 0; i < eventCount; i++) {
		h = (h * 1_664_525 + 1_013_904_223) | 0;
		const jitter = ((h >>> 0) % 17) - 8;
		points.push(Math.max(4, Math.min(96, base + jitter - (eventCount - 1 - i) * 2)));
	}

	points[points.length - 1] = base;

	return points;
};
