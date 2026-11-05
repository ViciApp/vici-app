import { getAgent } from '#lib/actors/agents.ic.ts';
import { ClearingCanister } from '#lib/canisters/clearing.canister.ts';
import { CLEARING_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import type { ClearingDid } from '$declarations';
import type { QueryParams } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';

export const depositCollateral = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.DepositCollateralParams;
} & QueryParams): Promise<void> => {
	const { depositCollateral } = await clearingCanister({ identity });

	return await depositCollateral(rest);
};

export const withdrawCollateral = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.WithdrawCollateralParams;
} & QueryParams): Promise<void> => {
	const { withdrawCollateral } = await clearingCanister({ identity });

	return await withdrawCollateral(rest);
};

export const submitMatchedTrade = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.SubmitMatchedTradeParams;
} & QueryParams): Promise<boolean> => {
	const { submitMatchedTrade } = await clearingCanister({ identity });

	return await submitMatchedTrade(rest);
};

export const getAccountState = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.GetAccountStateParams;
} & QueryParams): Promise<ClearingDid.AccountStateResponse> => {
	const { getAccountState } = await clearingCanister({ identity });

	return await getAccountState(rest);
};

/**
 * Query-only account-state read. Declared `query` in Candid, so it's fast and
 * does NOT refresh from external ledgers. Use for the "first paint" path and
 * follow up with {@link getAccountState} (`refresh: true`) to re-price and
 * certify.
 */
export const getAccountStateQuery = async ({
	identity,
	...queryParams
}: {
	identity: Identity;
} & QueryParams): Promise<ClearingDid.AccountStateResponse> => {
	const { getAccountStateQuery } = await clearingCanister({ identity });

	return await getAccountStateQuery(queryParams);
};

export const listCollateralAssets = async ({
	identity,
	...queryParams
}: {
	identity: Identity;
} & QueryParams): Promise<ClearingDid.CollateralAssetInfo[]> => {
	const { listCollateralAssets } = await clearingCanister({ identity });

	return await listCollateralAssets(queryParams);
};

export const getPositions = async ({
	identity,
	...queryParams
}: {
	identity: Identity;
} & QueryParams): Promise<ClearingDid.Position[]> => {
	const { getPositions } = await clearingCanister({ identity });

	return await getPositions(queryParams);
};

/**
 * Aggregate long/short lean over a supplied principal set for one series. See
 * {@link ClearingCanister.aggregateLean} — returns counts only, no identities.
 */
export const aggregateLean = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.AggregateLeanParams;
} & QueryParams): Promise<ClearingDid.AggregateLean> => {
	const { aggregateLean } = await clearingCanister({ identity });

	return await aggregateLean(rest);
};

/**
 * Returns the authoritative set of settled (resolved) series ids from the
 * clearing canister. See {@link ClearingCanister.listSettledSeries}.
 */
export const listSettledSeries = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params?: ClearingDid.ListSettledSeriesParams;
} & QueryParams): Promise<string[]> => {
	const { listSettledSeries } = await clearingCanister({ identity });

	return await listSettledSeries({ params, ...queryParams });
};

/**
 * Returns clearing's public settlement view for one series (or `undefined`
 * when unresolved). See {@link ClearingCanister.getSettlementStatus}.
 */
export const getSettlementStatus = async ({
	identity,
	...rest
}: {
	identity: Identity;
	seriesId: string;
} & QueryParams): Promise<ClearingDid.SettlementStatusView | undefined> => {
	const { getSettlementStatus } = await clearingCanister({ identity });

	return await getSettlementStatus(rest);
};

export const settleSeries = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.SettleSeriesParams;
} & QueryParams): Promise<void> => {
	const { settleSeries } = await clearingCanister({ identity });

	return await settleSeries(rest);
};

export const getPosition = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.GetPositionParams;
} & QueryParams): Promise<ClearingDid.Position | undefined> => {
	const { getPosition } = await clearingCanister({ identity });

	return await getPosition(rest);
};

export const submitLimitOrder = async ({
	identity,
	params
}: {
	identity: Identity;
	params: ClearingDid.SubmitLimitOrderParams;
}): Promise<boolean> => {
	const { submitLimitOrder } = await clearingCanister({ identity });

	return await submitLimitOrder({ params });
};

export const submitMarketOrder = async ({
	identity,
	params
}: {
	identity: Identity;
	params: ClearingDid.SubmitMarketOrderParams;
}): Promise<boolean> => {
	const { submitMarketOrder } = await clearingCanister({ identity });

	return await submitMarketOrder({ params });
};

export const cancelLimitOrder = async ({
	identity,
	params
}: {
	identity: Identity;
	params: ClearingDid.CancelLimitOrderParams;
}): Promise<boolean> => {
	const { cancelLimitOrder } = await clearingCanister({ identity });

	return await cancelLimitOrder({ params });
};

export const getOrders = async ({
	identity,
	...queryParams
}: {
	identity: Identity;
} & QueryParams): Promise<ClearingDid.LimitOrder[]> => {
	const { getOrders } = await clearingCanister({ identity });

	return await getOrders(queryParams);
};

export const getTradeHistory = async ({
	identity,
	...queryParams
}: {
	identity: Identity;
} & QueryParams): Promise<ClearingDid.Event[]> => {
	const { getTradeHistory } = await clearingCanister({ identity });

	return await getTradeHistory(queryParams);
};

/**
 * Market-wide price history for one series as fixed-width OHLC candles —
 * every participant's fills, not just the caller's. See
 * {@link ClearingCanister.getSeriesPriceHistory}.
 */
export const getSeriesPriceHistory = async ({
	identity,
	seriesId,
	interval,
	startTimeNs,
	endTimeNs,
	...queryParams
}: {
	identity: Identity;
	seriesId: string;
	interval: ClearingDid.PriceHistoryInterval;
	startTimeNs?: bigint;
	endTimeNs?: bigint;
} & QueryParams): Promise<ClearingDid.SeriesPriceCandle[]> => {
	const { getSeriesPriceHistory } = await clearingCanister({ identity });

	return await getSeriesPriceHistory({
		seriesId,
		interval,
		startTimeNs,
		endTimeNs,
		...queryParams
	});
};

/**
 * One page of a series' market-wide executed-trade history. See
 * {@link ClearingCanister.listSeriesTradeHistory}.
 */
export const listSeriesTradeHistory = async ({
	identity,
	seriesId,
	startAfter,
	limit,
	...queryParams
}: {
	identity: Identity;
	seriesId: string;
	startAfter?: bigint;
	limit?: bigint;
} & QueryParams): Promise<ClearingDid.SeriesTradeHistoryPage> => {
	const { listSeriesTradeHistory } = await clearingCanister({ identity });

	return await listSeriesTradeHistory({
		seriesId,
		startAfter,
		limit,
		...queryParams
	});
};

/**
 * Market-wide traded volume for a set of series in one call. See
 * {@link ClearingCanister.listSeriesTradedVolumes}.
 */
export const listSeriesTradedVolumes = async ({
	identity,
	seriesIds,
	...queryParams
}: {
	identity: Identity;
	seriesIds: string[];
} & QueryParams): Promise<ClearingDid.SeriesTradedVolume[]> => {
	const { listSeriesTradedVolumes } = await clearingCanister({ identity });

	return await listSeriesTradedVolumes({ seriesIds, ...queryParams });
};

export const listOrders = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.ListOrdersParams;
} & QueryParams): Promise<ClearingDid.LimitOrder[]> => {
	const { listOrders } = await clearingCanister({ identity });

	return await listOrders(rest);
};

export const mintCompleteSet = async ({
	identity,
	...rest
}: {
	identity: Identity;
	seriesId: string;
	qty: bigint;
} & QueryParams): Promise<boolean> => {
	const { mintCompleteSet } = await clearingCanister({ identity });

	return await mintCompleteSet(rest);
};

export const redeemCompleteSet = async ({
	identity,
	...rest
}: {
	identity: Identity;
	seriesId: string;
	qty: bigint;
} & QueryParams): Promise<boolean> => {
	const { redeemCompleteSet } = await clearingCanister({ identity });

	return await redeemCompleteSet(rest);
};

export const registerIcrcAsset = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: ClearingDid.RegisterIcrcAssetParams;
} & QueryParams): Promise<void> => {
	const { registerIcrcAsset } = await clearingCanister({ identity });

	return await registerIcrcAsset({ params, ...queryParams });
};

/**
 * Per-window ranked standings (week / month / all-time) by net realized P&L.
 * See {@link ClearingCanister.listLeaderboard} — drains the cursor (bounded by
 * `maxPages`) and returns the ranked entries plus the full `total` count.
 */
export const listLeaderboard = async ({
	identity,
	window,
	members,
	pageLimit,
	maxPages,
	...queryParams
}: {
	identity: Identity;
	window: ClearingDid.LeaderboardWindow;
	members?: Principal[];
	pageLimit?: bigint;
	maxPages?: number;
} & QueryParams): Promise<{ items: ClearingDid.LeaderboardEntry[]; total: bigint }> => {
	const { listLeaderboard } = await clearingCanister({ identity });

	return await listLeaderboard({ window, members, pageLimit, maxPages, ...queryParams });
};

const clearingCanister = async ({
	identity
}: {
	identity: Identity;
}): Promise<ClearingCanister> => {
	const agent = await getAgent({ identity });

	return ClearingCanister.create({
		agent,
		canisterId: CLEARING_CANISTER_ID
	});
};
