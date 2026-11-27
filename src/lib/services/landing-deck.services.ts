import { loadMarket } from '#lib/services/market.services.ts';
import { loadMarketPriceCandles } from '#lib/services/trade.services.ts';
import type { LandingDeckCard, LandingDeckSeries } from '#lib/types/landing.ts';
import type { Market } from '#lib/types/market.ts';
import { settleAll } from '#lib/utils/async.utils.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';

/**
 * Read one landing-deck series for a signed-out visitor: the market with its
 * live price, and its price history over the last 24 hours (the rolling
 * `1d` window, not the calendar day). Both go through the same public
 * reads the market detail uses, so the deck shows what the app shows.
 *
 * `onMarket` and `onHistory` can each fire more than once (a fast answer,
 * then the verified one). `onMarket` gets `undefined` when the series is
 * not found (it can disappear between refreshes), so the caller drops what
 * it held. Fails open: a series that cannot be read, or whose id is not a
 * market id at all, fires nothing, and the
 * promise still resolves so the caller can tell the read is over and leave
 * the card out.
 */
export const loadLandingDeckSeries = async ({
	entry: { seriesId },
	onMarket,
	onHistory
}: {
	entry: LandingDeckSeries;
	onMarket: (market: Market | undefined) => void;
	/** YES prices over the last 24 hours, whole percent, oldest first, with their x-fractions. */
	onHistory: (history: NonNullable<LandingDeckCard['history']>) => void;
}): Promise<void> => {
	// An id the parser refuses throws before any read starts: `settleAll`
	// settles that like a failed read, so the caller still learns it is over.
	await settleAll([
		async () =>
			await loadMarket({
				marketId: parseMarketId(seriesId),
				onLoad: ({ response }) => onMarket(response)
			}),
		async () =>
			await loadMarketPriceCandles({
				seriesId,
				period: '1d',
				onLoad: ({ response: { yes, xs } }) => onHistory({ yes, xs })
			})
	]);
};
