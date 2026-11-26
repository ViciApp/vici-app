import { loadMarket } from '#lib/services/market.services.ts';
import { loadMarketPriceCandles } from '#lib/services/trade.services.ts';
import type { LandingDeckSeries } from '#lib/types/landing.ts';
import type { Market } from '#lib/types/market.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import { nonNullish } from '@dfinity/utils';

/**
 * Read one landing-deck series for a signed-out visitor: the market with its
 * live price, and today's price history. Both go through the same public
 * reads the market detail uses, so the deck shows what the app shows.
 *
 * `onMarket` and `onHistory` can each fire more than once (a fast answer,
 * then the verified one). Fails open: a series that cannot be read fires
 * nothing, and the promise still resolves so the caller can tell the read
 * is over and leave the card out.
 */
export const loadLandingDeckSeries = async ({
	entry: { seriesId },
	onMarket,
	onHistory
}: {
	entry: LandingDeckSeries;
	onMarket: (market: Market) => void;
	/** Today's YES prices, whole percent, oldest first. */
	onHistory: (history: number[]) => void;
}): Promise<void> => {
	await Promise.allSettled([
		loadMarket({
			marketId: parseMarketId(seriesId),
			onLoad: ({ response }) => {
				if (nonNullish(response)) {
					onMarket(response);
				}
			}
		}),
		loadMarketPriceCandles({
			seriesId,
			period: '1d',
			onLoad: ({ response }) => onHistory(response.yes)
		})
	]);
};
