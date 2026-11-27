import type { ClearingDid, RegistryDid } from '#declarations';
import {
	getEnginePriceHistory as getEnginePriceHistoryApi,
	listEngineSeriesTrades as listEngineSeriesTradesApi,
	listEngineTradeHistory as listEngineTradeHistoryApi
} from '#lib/api-client/client.ts';
import { getSessionUser } from '#lib/api-client/session.ts';
import { ZERO } from '#lib/constants/app.constants.ts';
import { anonymousIdentity } from '#lib/services/identity.services.ts';
import { fetchMarketsLite } from '#lib/services/market.services.ts';
import { filterByMarketIds } from '#lib/utils/balance-domain.utils.ts';
import {
	deriveMarketPriceSeries,
	priceHistoryQueryWindow,
	tradeHistoryNotional,
	type MarketPriceSeries,
	type PriceHistoryPeriod
} from '#lib/utils/market-price-history.utils.ts';
import { fromNullable, isNullish } from '@dfinity/utils';

/**
 * Trade/settlement events for the signed-in user, restricted to the markets
 * visible in the current app domain.
 */
const fetchUserTradeHistory = async (
	domain: RegistryDid.BalanceDomain
): Promise<ClearingDid.Event[]> => {
	const [events, markets] = await Promise.all([
		listEngineTradeHistoryApi(),
		// Order-book-free: trade history only needs the market id set to scope
		// events to the current domain.
		fetchMarketsLite({ identity: anonymousIdentity(), certified: true, domain })
	]);

	const marketIds = new Set(markets.map((m) => m.id));

	return filterByMarketIds({ items: events, marketIds });
};

/**
 * Trade/settlement events for the user, restricted to markets visible in the
 * current app domain. Throws when nobody is signed in.
 */
export const getUserTradeHistory = async (
	domain: RegistryDid.BalanceDomain
): Promise<ClearingDid.Event[]> => {
	if (isNullish(getSessionUser())) {
		throw new Error('Not authenticated');
	}

	return await fetchUserTradeHistory(domain);
};

/**
 * Callback-based variant of {@link getUserTradeHistory}. No-op when nobody is
 * signed in. The API answers once, so the single response is the final
 * (`certified: true`) pass.
 */
export const loadUserTradeHistory = async ({
	domain,
	onLoad,
	onUpdateError
}: {
	domain: RegistryDid.BalanceDomain;
	onLoad: (options: { certified: boolean; response: ClearingDid.Event[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	if (isNullish(getSessionUser())) {
		return;
	}

	try {
		onLoad({ certified: true, response: await fetchUserTradeHistory(domain) });
	} catch (err: unknown) {
		onUpdateError?.(err);
	}
};

/**
 * Real, market-wide price-history series for one market and chart period,
 * sourced from the clearing canister's `get_series_price_history` query.
 *
 * The query is market-wide (not caller-scoped), so the derived
 * YES-percentage series reflects the TRUE market movement for every viewer
 * including signed-out visitors,
 * rather than the viewer's own fills. `period` selects the query window
 * (resolution + lower bound; see {@link priceHistoryQueryWindow}) so the
 * `1d / 7d / 30d / all` chips re-scope the chart instead of replotting the
 * same window. {@link deriveMarketPriceSeries} maps each bucket's close into
 * the 0–100 series and onto the time axis. The series is empty until the
 * first trade lands in the window (true cold-start), which the sparkline
 * reads as a flat line. `windowStartNs` is the axis start the `xs` are
 * placed against: the requested lower bound, or for `all` the earliest
 * returned candle, so a caller labelling dates reads the same axis. Fails
 * open: any error leaves the caller on its cold-start / seed fallback.
 */
export const loadMarketPriceCandles = async ({
	seriesId,
	period,
	onLoad,
	onUpdateError
}: {
	seriesId: string;
	period: PriceHistoryPeriod;
	onLoad: (options: {
		certified: boolean;
		response: MarketPriceSeries;
		windowStartNs: bigint;
	}) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	const { interval, startTimeNs, endTimeNs } = priceHistoryQueryWindow(period);

	// The candles are one read from the public HTTP bridge, delivered as the
	// final (`certified: true`) pass.
	try {
		const response = await getEnginePriceHistoryApi({ seriesId, interval, startTimeNs });
		// `all` has no lower query bound, so anchor the x-axis to the earliest
		// returned candle; bounded periods anchor to the requested window start.
		const windowStartNs = startTimeNs ?? response[0]?.bucket_start_ns ?? endTimeNs;

		onLoad({
			certified: true,
			response: deriveMarketPriceSeries({
				candles: response,
				windowStartNs,
				windowEndNs: endTimeNs
			}),
			windowStartNs
		});
	} catch (err: unknown) {
		onUpdateError?.(err);
	}
};

// Page size for the traded-volume drain. `list_series_trade_history` returns
// *all* remaining trades when `limit` is omitted, which can blow past the IC
// message-size cap (and balloon client allocations) on a busy series, so cap
// each page and follow `next_cursor`.
const TRADE_HISTORY_PAGE_SIZE = BigInt(1000);

/**
 * Market-wide traded volume for one series, in payout-token base units.
 *
 * "Volume" on a market is the notional that changed hands, so this drains the
 * executed-trade tape (`list_series_trade_history`: every participant's
 * fills, not the caller's) a bounded page at a time and aggregates `Σ qty·price`
 * via {@link tradeHistoryNotional}, folding each page in and discarding it so
 * neither the response nor the running set is unbounded. Following `next_cursor`
 * to exhaustion keeps the total exact rather than a windowed sample. The detail
 * page calls this once on the foreground load (not the 30s consensus poll).
 * `decimals` is the payout token's precision so the result formats like the
 * other token stats. A public read, so a signed-out visitor sees the same
 * figure.
 */
export const getSeriesTradeVolume = async ({
	seriesId,
	decimals
}: {
	seriesId: string;
	decimals: number;
}): Promise<bigint> => {
	// The trade tape is a public engine read through the HTTP bridge.
	let volume = ZERO;
	let startAfter: bigint | undefined;

	for (;;) {
		const { items, next_cursor } = await listEngineSeriesTradesApi({
			seriesId,
			startAfter,
			limit: TRADE_HISTORY_PAGE_SIZE
		});

		volume += tradeHistoryNotional({ trades: items, decimals });

		const cursor = fromNullable(next_cursor);

		if (isNullish(cursor)) {
			break;
		}

		startAfter = cursor;
	}

	return volume;
};
