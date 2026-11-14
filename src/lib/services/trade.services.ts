import type { ClearingDid, RegistryDid } from '#declarations';
import {
	getSeriesPriceHistory as getSeriesPriceHistoryApi,
	getTradeHistory as getTradeHistoryApi,
	listSeriesTradeHistory as listSeriesTradeHistoryApi,
	mintCompleteSet as mintCompleteSetApi,
	redeemCompleteSet as redeemCompleteSetApi
} from '#lib/api/clearing.api.ts';
import { ZERO } from '#lib/constants/app.constants.ts';
import {
	getIdentity,
	getIdentityOrAnonymous,
	safeGetIdentityOnce,
	web2PlaceholderIdentity
} from '#lib/services/identity.services.ts';
import { fetchMarketsLite } from '#lib/services/market.services.ts';
import { loadWithCertification } from '#lib/services/query-update.services.ts';
import { filterByMarketIds } from '#lib/utils/balance-domain.utils.ts';
import {
	deriveMarketPriceSeries,
	priceHistoryQueryWindow,
	tradeHistoryNotional,
	type MarketPriceSeries,
	type PriceHistoryPeriod
} from '#lib/utils/market-price-history.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	getEnginePriceHistory as getEnginePriceHistoryWeb2,
	listEngineSeriesTrades as listEngineSeriesTradesWeb2,
	listEngineTradeHistory as listEngineTradeHistoryWeb2
} from '#lib/web2/client.ts';
import { getWeb2User } from '#lib/web2/session.ts';
import { fromNullable, isNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

/**
 * Core fetch for user trade history, restricted to the current app domain.
 */
const fetchUserTradeHistory = async ({
	identity,
	certified,
	domain
}: {
	identity: Identity;
	certified: boolean;
	domain: RegistryDid.BalanceDomain;
}): Promise<ClearingDid.Event[]> => {
	const [events, markets] = await Promise.all([
		isWeb2Backend() ? listEngineTradeHistoryWeb2() : getTradeHistoryApi({ identity, certified }),
		// Order-book-free: trade history only needs the market id set to scope
		// events to the current domain. Threads the pass's own `certified` so the
		// uncertified query pass isn't blocked on a certified catalog, while each
		// pass stays self-consistent (no tearing).
		fetchMarketsLite({ identity, certified, domain })
	]);

	const marketIds = new Set(markets.map((m) => m.id));

	return filterByMarketIds({ items: events, marketIds });
};

/**
 * Trade/settlement events for the user, restricted to markets visible in the current app domain.
 *
 * Performs a single certified update. Prefer {@link loadUserTradeHistory} for
 * UI flows that benefit from the fast-then-certified render pattern.
 */
export const getUserTradeHistory = async (
	domain: RegistryDid.BalanceDomain
): Promise<ClearingDid.Event[]> => {
	// web2 gates on the cookie session, mirroring the signed-out throw of the
	// identity path.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			throw new Error('Not authenticated');
		}

		return fetchUserTradeHistory({
			identity: web2PlaceholderIdentity(),
			certified: true,
			domain
		});
	}

	const identity = await safeGetIdentityOnce();

	return fetchUserTradeHistory({ identity, certified: true, domain });
};

/**
 * Callback-based variant of {@link getUserTradeHistory}. No-op when the user
 * is not signed in.
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
	// Single-pass web2 read, delivered as the final (`certified: true`) pass.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return;
		}

		try {
			onLoad({
				certified: true,
				response: await fetchUserTradeHistory({
					identity: web2PlaceholderIdentity(),
					certified: true,
					domain
				})
			});
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<ClearingDid.Event[]>({
		identity,
		request: ({ certified, identity: reqIdentity }) =>
			fetchUserTradeHistory({ identity: reqIdentity, certified, domain }),
		onLoad,
		onUpdateError
	});
};

/**
 * Real, market-wide price-history series for one market and chart period,
 * sourced from the clearing canister's `get_series_price_history` query.
 *
 * The query is market-wide (not caller-scoped), so the derived
 * YES-percentage series reflects the TRUE market movement for every viewer
 * including signed-out visitors, who read it under the anonymous identity
 * rather than the viewer's own fills. `period` selects the query window
 * (resolution + lower bound; see {@link priceHistoryQueryWindow}) so the
 * `1d / 7d / 30d / all` chips re-scope the chart instead of replotting the
 * same window. {@link deriveMarketPriceSeries} maps each bucket's close into
 * the 0–100 series and onto the time axis. The series is empty until the
 * first trade lands in the window (true cold-start), which the sparkline
 * reads as a flat line. Fails open: any error leaves the caller on its
 * cold-start / seed fallback.
 */
export const loadMarketPriceCandles = async ({
	seriesId,
	period,
	onLoad,
	onUpdateError
}: {
	seriesId: string;
	period: PriceHistoryPeriod;
	onLoad: (options: { certified: boolean; response: MarketPriceSeries }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	const { interval, startTimeNs, endTimeNs } = priceHistoryQueryWindow(period);

	// web2 reads the candles once from the public HTTP bridge: there is no
	// query/update pair on that transport, so the single response is delivered
	// as the final (`certified: true`) pass and the on-chain double read below
	// never runs.
	if (isWeb2Backend()) {
		try {
			const response = await getEnginePriceHistoryWeb2({ seriesId, interval, startTimeNs });
			const windowStartNs = startTimeNs ?? response[0]?.bucket_start_ns ?? endTimeNs;

			onLoad({
				certified: true,
				response: deriveMarketPriceSeries({
					candles: response,
					windowStartNs,
					windowEndNs: endTimeNs
				})
			});
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	return loadWithCertification<ClearingDid.SeriesPriceCandle[]>({
		request: ({ certified, identity: reqIdentity }) =>
			getSeriesPriceHistoryApi({
				identity: reqIdentity,
				seriesId,
				interval,
				startTimeNs,
				certified
			}),
		onLoad: ({ certified, response }) => {
			// `all` has no lower query bound, so anchor the x-axis to the
			// earliest returned candle; bounded periods anchor to the requested
			// window start.
			const windowStartNs = startTimeNs ?? response[0]?.bucket_start_ns ?? endTimeNs;

			onLoad({
				certified,
				response: deriveMarketPriceSeries({
					candles: response,
					windowStartNs,
					windowEndNs: endTimeNs
				})
			});
		},
		onUpdateError
	});
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
 * other token stats. Read under the anonymous identity when signed-out, so a
 * public visitor sees the same figure.
 */
export const getSeriesTradeVolume = async ({
	seriesId,
	decimals
}: {
	seriesId: string;
	decimals: number;
}): Promise<bigint> => {
	// The trade tape is a public engine read: web2 drains the same pages from
	// the HTTP bridge (no signing identity exists in that mode); the default
	// path keeps the anonymous on-chain query.
	const identity = isWeb2Backend() ? undefined : await getIdentityOrAnonymous();

	let volume = ZERO;
	let startAfter: bigint | undefined;

	for (;;) {
		const { items, next_cursor } = isNullish(identity)
			? await listEngineSeriesTradesWeb2({
					seriesId,
					startAfter,
					limit: TRADE_HISTORY_PAGE_SIZE
				})
			: await listSeriesTradeHistoryApi({
					identity,
					seriesId,
					startAfter,
					limit: TRADE_HISTORY_PAGE_SIZE,
					certified: false
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

/**
 * Mints a complete YES/NO set on clearing for `qty`.
 */
export const mintCompleteSet = async ({
	seriesId,
	qty
}: {
	seriesId: string;
	qty: bigint;
}): Promise<boolean> => {
	const identity = await safeGetIdentityOnce();

	return await mintCompleteSetApi({
		identity,
		seriesId,
		qty
	});
};

/**
 * Redeems a complete set back into collateral for `qty`.
 */
export const redeemCompleteSet = async ({
	seriesId,
	qty
}: {
	seriesId: string;
	qty: bigint;
}): Promise<boolean> => {
	const identity = await safeGetIdentityOnce();

	return await redeemCompleteSetApi({
		identity,
		seriesId,
		qty
	});
};
