import {
	idlFactoryCertifiedClearing,
	idlFactoryClearing,
	type ClearingDid,
	type ClearingService
} from '#declarations';
import { TradeExecutionError } from '#lib/canisters/clearing.errors.ts';
import { ZERO } from '#lib/constants/app.constants.ts';
import type { CreateCanisterOptions } from '#lib/types/canister.ts';
import {
	Canister,
	createServices,
	fromNullable,
	isNullish,
	jsonReplacer,
	toNullable,
	type QueryParams
} from '@dfinity/utils';
import type { Principal } from '@icp-sdk/core/principal';

export class ClearingCanister extends Canister<ClearingService> {
	static create(options: CreateCanisterOptions<ClearingService>) {
		const { service, certifiedService, canisterId } = createServices<ClearingService>({
			options,
			idlFactory: idlFactoryClearing,
			certifiedIdlFactory: idlFactoryCertifiedClearing
		});

		return new ClearingCanister(canisterId, service, certifiedService);
	}

	depositCollateral = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.DepositCollateralParams;
	} & QueryParams): Promise<void> => {
		const { deposit_collateral } = this.caller(queryParams);
		const result = await deposit_collateral(params);

		if ('Ok' in result) {
			return;
		}

		throw new Error(`Failed to deposit collateral: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	withdrawCollateral = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.WithdrawCollateralParams;
	} & QueryParams): Promise<void> => {
		const { withdraw_collateral } = this.caller(queryParams);
		const result = await withdraw_collateral(params);

		if ('Ok' in result) {
			return;
		}

		throw new Error(`Failed to withdraw collateral: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	submitMatchedTrade = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.SubmitMatchedTradeParams;
	} & QueryParams): Promise<boolean> => {
		const { submit_matched_trade } = this.caller(queryParams);
		const result = await submit_matched_trade(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to submit matched trade: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	getAccountState = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.GetAccountStateParams;
	} & QueryParams): Promise<ClearingDid.AccountStateResponse> => {
		const { get_account_state } = this.caller(queryParams);
		const result = await get_account_state(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to get account state: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	getAccountStateQuery = async (
		queryParams: QueryParams
	): Promise<ClearingDid.AccountStateResponse> => {
		const { get_account_state_query } = this.caller(queryParams);
		const result = await get_account_state_query();

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to query account state: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	listCollateralAssets = async (
		queryParams: QueryParams
	): Promise<ClearingDid.CollateralAssetInfo[]> => {
		const { list_collateral_assets } = this.caller(queryParams);

		return await list_collateral_assets();
	};

	getPosition = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.GetPositionParams;
	} & QueryParams): Promise<ClearingDid.Position | undefined> => {
		const { get_position } = this.caller(queryParams);
		const result = await get_position(params);

		return fromNullable(result);
	};

	getPositions = async (queryParams: QueryParams): Promise<ClearingDid.Position[]> => {
		const { get_positions } = this.caller(queryParams);

		return await get_positions();
	};

	/**
	 * Aggregate long/short lean of a supplied set of principals on one series.
	 *
	 * Privacy-preserving by construction: the query returns per-outcome counts
	 * only (`long` / `short` / `total`): never individual identities, sides,
	 * quantities, or P&L. The principal set is caller-supplied; the clearing
	 * layer ascribes no meaning to it (here it is the viewer's followed set).
	 */
	aggregateLean = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.AggregateLeanParams;
	} & QueryParams): Promise<ClearingDid.AggregateLean> => {
		const { aggregate_lean } = this.caller(queryParams);

		return await aggregate_lean(params);
	};

	listSeries = async (queryParams: QueryParams): Promise<ClearingDid.Series[]> => {
		const { list_series } = this.caller(queryParams);

		return await list_series();
	};

	/**
	 * Returns the authoritative set of settled (resolved) series ids, draining
	 * the clearing canister's stable, exclusive pagination cursor to completion.
	 *
	 * Clearing is the single source of truth for resolution: a series is settled
	 * the moment a settlement plan opens for it. Front ends subtract this set
	 * from the registry's open/unexpired catalog to derive the open set
	 * (open = unexpired − settled). Filter to one `balance_domain` to shrink the
	 * response to a single deck's relevant subset.
	 */
	listSettledSeries = async ({
		params,
		...queryParams
	}: {
		params?: ClearingDid.ListSettledSeriesParams;
	} & QueryParams = {}): Promise<string[]> => {
		const { list_settled_series } = this.caller(queryParams);

		const balanceDomain = params?.balance_domain ?? toNullable();
		const pageLimit = params?.limit ?? toNullable();

		const items: string[] = [];
		let startAfter = params?.start_after ?? toNullable();
		let done = false;

		while (!done) {
			const page = await list_settled_series({
				start_after: startAfter,
				limit: pageLimit,
				balance_domain: balanceDomain
			});

			items.push(...page.items);

			const next = fromNullable(page.next_cursor);

			if (isNullish(next)) {
				done = true;
			} else {
				startAfter = toNullable(next);
			}
		}

		return items;
	};

	/**
	 * Returns clearing's public settlement view for one series, or `undefined`
	 * when no settlement plan exists (i.e. the series is unresolved). The view
	 * exists from the moment a plan opens (the same instant
	 * {@link listSettledSeries} starts reporting the id) and carries the
	 * authoritative `SettlementInput` (settlement price or outcome id).
	 */
	getSettlementStatus = async ({
		seriesId,
		...queryParams
	}: {
		seriesId: string;
	} & QueryParams): Promise<ClearingDid.SettlementStatusView | undefined> => {
		const { get_settlement_status } = this.caller(queryParams);

		return fromNullable(await get_settlement_status(seriesId));
	};

	setRegistryCanister = async ({
		registryId,
		...queryParams
	}: {
		registryId: Principal;
	} & QueryParams): Promise<void> => {
		const { set_registry_canister } = this.caller(queryParams);

		return await set_registry_canister(registryId);
	};

	settleSeries = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.SettleSeriesParams;
	} & QueryParams): Promise<void> => {
		const { settle_series } = this.caller(queryParams);

		type SettleResult = Awaited<ReturnType<typeof settle_series>>;
		type FinalSettleResult = Exclude<SettleResult, { Processing: null }>;

		const pollUntilFinal = async (): Promise<FinalSettleResult> => {
			const r = await settle_series(params);

			return 'Processing' in r ? pollUntilFinal() : r;
		};

		const result = await pollUntilFinal();

		if ('Ok' in result) {
			return;
		}

		throw new Error(`Failed to settle series: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	acceptPositionTransfer = async ({
		proof,
		...queryParams
	}: {
		proof: ClearingDid.PositionProof;
	} & QueryParams): Promise<boolean> => {
		const { accept_position_transfer } = this.caller(queryParams);
		const result = await accept_position_transfer(proof);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(
			`Failed to accept position transfer: ${JSON.stringify(result.Err, jsonReplacer)}`
		);
	};

	freezePositionForTransfer = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.FreezePositionForTransferParams;
	} & QueryParams): Promise<ClearingDid.PositionProof | undefined> => {
		const { freeze_position_for_transfer } = this.caller(queryParams);
		const result = await freeze_position_for_transfer(params);

		return fromNullable(result);
	};

	submitLimitOrder = async ({
		params
	}: {
		params: ClearingDid.SubmitLimitOrderParams;
	}): Promise<boolean> => {
		const { submit_limit_order } = this.caller({ certified: true });
		const result = await submit_limit_order(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new TradeExecutionError(result.Err);
	};

	submitMarketOrder = async ({
		params
	}: {
		params: ClearingDid.SubmitMarketOrderParams;
	}): Promise<boolean> => {
		const { submit_market_order } = this.caller({ certified: true });
		const result = await submit_market_order(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new TradeExecutionError(result.Err);
	};

	cancelLimitOrder = async ({
		params
	}: {
		params: ClearingDid.CancelLimitOrderParams;
	}): Promise<boolean> => {
		const { cancel_limit_order } = this.caller({ certified: true });
		const result = await cancel_limit_order(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new TradeExecutionError(result.Err);
	};

	getOrders = async (queryParams: QueryParams): Promise<ClearingDid.LimitOrder[]> => {
		const { get_orders } = this.caller(queryParams);

		return await get_orders();
	};

	listOrders = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.ListOrdersParams;
	} & QueryParams): Promise<ClearingDid.LimitOrder[]> => {
		const { list_orders } = this.caller(queryParams);

		return await list_orders(params);
	};

	getTradeHistory = async (queryParams: QueryParams): Promise<ClearingDid.Event[]> => {
		const { get_trade_history } = this.caller(queryParams);

		return await get_trade_history();
	};

	/**
	 * Returns one market's executed-trade history aggregated into fixed-width
	 * OHLC + volume + trade-count candles, so a front end can render a
	 * time-scoped consensus/price chart (the YES-probability sparkline)
	 * directly instead of draining and re-bucketing the raw per-trade tape.
	 *
	 * Market-wide (every participant's fills, not just the caller's), so the
	 * derived series reflects the true market movement for all viewers,
	 * including signed-out visitors reading under the anonymous identity.
	 * `interval` picks the resolution (hourly for short windows, daily for
	 * long) and the optional `startTimeNs` / `endTimeNs` bounds (ns) request
	 * just the window the chart draws. Candles come back ascending by
	 * `bucket_start_ns`; empty buckets are omitted, so a young or untraded
	 * series yields an empty vector rather than fabricated points.
	 */
	getSeriesPriceHistory = async ({
		seriesId,
		interval,
		startTimeNs,
		endTimeNs,
		...queryParams
	}: {
		seriesId: string;
		interval: ClearingDid.PriceHistoryInterval;
		startTimeNs?: bigint;
		endTimeNs?: bigint;
	} & QueryParams): Promise<ClearingDid.SeriesPriceCandle[]> => {
		const { get_series_price_history } = this.caller(queryParams);

		const { candles } = await get_series_price_history({
			series_id: seriesId,
			interval,
			start_time: toNullable(startTimeNs),
			end_time: toNullable(endTimeNs)
		});

		return candles;
	};

	/**
	 * One page of a series' market-wide executed-trade history (every
	 * participant's fills, not just the caller's). Each {@link
	 * ClearingDid.SeriesTradePoint} carries the trade's `qty` and `price`, so a
	 * front end can aggregate traded notional (Σ qty·price) or replot the tape.
	 * Pass the previous response's `next_cursor` back as `startAfter` to page;
	 * `limit` unset returns all remaining trades.
	 */
	listSeriesTradeHistory = async ({
		seriesId,
		startAfter,
		limit,
		...queryParams
	}: {
		seriesId: string;
		startAfter?: bigint;
		limit?: bigint;
	} & QueryParams): Promise<ClearingDid.SeriesTradeHistoryPage> => {
		const { list_series_trade_history } = this.caller(queryParams);

		return await list_series_trade_history({
			series_id: seriesId,
			start_after: toNullable(startAfter),
			limit: toNullable(limit)
		});
	};

	/**
	 * Market-wide traded volume for a set of series in one call; the notional
	 * that changed hands (Σ qty·price) in USD base units, plus each series'
	 * executed-trade count. Lets the list/cards label a page of markets without
	 * a per-card read; unknown or untraded ids come back zeroed.
	 */
	listSeriesTradedVolumes = async ({
		seriesIds,
		...queryParams
	}: {
		seriesIds: string[];
	} & QueryParams): Promise<ClearingDid.SeriesTradedVolume[]> => {
		const { list_series_traded_volumes } = this.caller(queryParams);

		return await list_series_traded_volumes({ series_ids: seriesIds });
	};

	mintCompleteSet = async ({
		seriesId,
		qty,
		...queryParams
	}: {
		seriesId: string;
		qty: bigint;
	} & QueryParams): Promise<boolean> => {
		const { mint_complete_set } = this.caller(queryParams);
		const result = await mint_complete_set(seriesId, qty);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to mint complete set: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	redeemCompleteSet = async ({
		seriesId,
		qty,
		...queryParams
	}: {
		seriesId: string;
		qty: bigint;
	} & QueryParams): Promise<boolean> => {
		const { redeem_complete_set } = this.caller(queryParams);
		const result = await redeem_complete_set(seriesId, qty);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to redeem complete set: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	/**
	 * Per-window ranked standings (week / month / all-time) by net realized
	 * P&L, draining the clearing canister's exclusive `start_after` cursor.
	 *
	 * The query is an aggregate: each entry carries the principal's rank, the
	 * prior-window rank (for ↑/↓ deltas), net realized P&L, and settled / win
	 * counts (`win_count / settled_count` is the window accuracy). When
	 * `members` is supplied the ranking is computed within that league set in
	 * isolation (inactive members included with a zeroed aggregate); otherwise
	 * the global standings are returned. `total` is the full ranked count after
	 * any `members` filter, so a caller can show "rank X of total" without
	 * paging to the end. `maxPages` bounds the drain so a large window can't
	 * fan out into an unbounded number of round-trips.
	 */
	listLeaderboard = async ({
		window,
		members,
		pageLimit,
		maxPages,
		...queryParams
	}: {
		window: ClearingDid.LeaderboardWindow;
		members?: Principal[];
		pageLimit?: bigint;
		maxPages?: number;
	} & QueryParams): Promise<{ items: ClearingDid.LeaderboardEntry[]; total: bigint }> => {
		const { list_leaderboard } = this.caller(queryParams);

		const items: ClearingDid.LeaderboardEntry[] = [];
		let startAfter: [] | [bigint] = toNullable();
		let total = ZERO;
		let pages = 0;

		while (isNullish(maxPages) || pages < maxPages) {
			const page = await list_leaderboard({
				window,
				members: isNullish(members) ? toNullable() : toNullable(members),
				start_after: startAfter,
				limit: isNullish(pageLimit) ? toNullable() : toNullable(pageLimit)
			});

			const { items: pageItems, total: pageTotal } = page;

			items.push(...pageItems);
			total = pageTotal;
			pages += 1;

			const next = fromNullable(page.next_cursor);

			if (isNullish(next)) {
				break;
			}

			startAfter = toNullable(next);
		}

		return { items, total };
	};

	registerIcrcAsset = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.RegisterIcrcAssetParams;
	} & QueryParams): Promise<void> => {
		const { register_icrc_asset } = this.caller(queryParams);
		const result = await register_icrc_asset(params);

		if ('Ok' in result) {
			return;
		}

		throw new Error(`Failed to register ICRC asset: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};
}
