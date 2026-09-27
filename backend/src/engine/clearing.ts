// Typed wrappers over the clearing canister: the same method surface the app
// consumes on-chain today, re-exposed server-side. Public market-wide reads
// sign with the engine reader identity behind a short TTL cache (clearing
// rejects anonymous callers); account-scoped calls sign with the calling
// user's derived custodial identity; settlement-grade calls sign with the
// admin identity.

import { fromNullable, isNullish, jsonReplacer, toNullable } from '@dfinity/utils';
import type { Principal } from '@icp-sdk/core/principal';
import type { ClearingDid } from '../declarations';
import { ZERO } from '../lib/constants';
import { userIcIdentity } from '../lib/keys';
import { adminClearing, readerClearing, userClearing } from './actors';
import { cached } from './cache';

const PUBLIC_READ_TTL_MS = 15_000;

const expectOk = <O>(result: { Ok: O } | { Err: unknown }, label: string): O => {
	if ('Ok' in result) {
		return result.Ok;
	}

	throw new Error(`${label} failed: ${JSON.stringify(result.Err, jsonReplacer)}`);
};

/** The account state of a principal clearing holds no row for: exactly what
 * clearing's own refreshing read answers for it (a fresh empty account). */
const emptyAccountState = (user: Principal): ClearingDid.AccountStateResponse => ({
	assets: [],
	state: { user, reserved_margins_usd: [], cash_balances_usd: [], balances: [] },
	total_equity_usd: ZERO,
	available_margin_usd: ZERO
});

/** A custodial principal that has never deposited has no clearing account
 * yet, which is the normal state of every new account, so that one miss
 * reads as an empty account; every other error still throws. */
const accountStateOrEmpty = ({
	result,
	userId,
	label
}: {
	result: ClearingDid.GetAccountStateResult;
	userId: string;
	label: string;
}): ClearingDid.AccountStateResponse =>
	'Err' in result && 'NoAccountStateFound' in result.Err
		? emptyAccountState(userIcIdentity(userId).getPrincipal())
		: expectOk(result, label);

// Account-scoped calls (signed with the user's derived identity)

export const depositCollateral = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.DepositCollateralParams;
}): Promise<void> => {
	const actor = await userClearing(userId);

	expectOk(await actor.deposit_collateral(params), 'deposit_collateral');
};

export const withdrawCollateral = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.WithdrawCollateralParams;
}): Promise<void> => {
	const actor = await userClearing(userId);

	expectOk(await actor.withdraw_collateral(params), 'withdraw_collateral');
};

export const getAccountState = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.GetAccountStateParams;
}): Promise<ClearingDid.AccountStateResponse> => {
	const actor = await userClearing(userId);

	return accountStateOrEmpty({
		result: await actor.get_account_state(params),
		userId,
		label: 'get_account_state'
	});
};

export const getAccountStateQuery = async ({
	userId
}: {
	userId: string;
}): Promise<ClearingDid.AccountStateResponse> => {
	const actor = await userClearing(userId);

	return accountStateOrEmpty({
		result: await actor.get_account_state_query(),
		userId,
		label: 'get_account_state_query'
	});
};

export const getPositions = async ({
	userId
}: {
	userId: string;
}): Promise<ClearingDid.Position[]> => {
	const actor = await userClearing(userId);

	return await actor.get_positions();
};

export const getPosition = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.GetPositionParams;
}): Promise<ClearingDid.Position | undefined> => {
	const actor = await userClearing(userId);

	return fromNullable(await actor.get_position(params));
};

export const getOrders = async ({
	userId
}: {
	userId: string;
}): Promise<ClearingDid.LimitOrder[]> => {
	const actor = await userClearing(userId);

	return await actor.get_orders();
};

export const listOrders = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.ListOrdersParams;
}): Promise<ClearingDid.LimitOrder[]> => {
	const actor = await userClearing(userId);

	return await actor.list_orders(params);
};

export const getTradeHistory = async ({
	userId
}: {
	userId: string;
}): Promise<ClearingDid.Event[]> => {
	const actor = await userClearing(userId);

	return await actor.get_trade_history();
};

export const submitLimitOrder = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.SubmitLimitOrderParams;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOk(await actor.submit_limit_order(params), 'submit_limit_order');
};

export const submitMarketOrder = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.SubmitMarketOrderParams;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOk(await actor.submit_market_order(params), 'submit_market_order');
};

export const cancelLimitOrder = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.CancelLimitOrderParams;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOk(await actor.cancel_limit_order(params), 'cancel_limit_order');
};

export const mintCompleteSet = async ({
	userId,
	seriesId,
	qty
}: {
	userId: string;
	seriesId: string;
	qty: bigint;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOk(await actor.mint_complete_set(seriesId, qty), 'mint_complete_set');
};

export const redeemCompleteSet = async ({
	userId,
	seriesId,
	qty
}: {
	userId: string;
	seriesId: string;
	qty: bigint;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOk(await actor.redeem_complete_set(seriesId, qty), 'redeem_complete_set');
};

// Public market-wide reads (engine reader identity, cached)

export const listCollateralAssets = (): Promise<ClearingDid.CollateralAssetInfo[]> =>
	cached({
		key: 'clearing:collateral-assets',
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();

			return await actor.list_collateral_assets();
		}
	});

export const aggregateLean = async (
	params: ClearingDid.AggregateLeanParams
): Promise<ClearingDid.AggregateLean> => {
	const actor = await readerClearing();

	return await actor.aggregate_lean(params);
};

/** Per-principal settled-position win/total counts over an arbitrary
 * half-open window: the source of truth league-battle scoring reads.
 * Uncached: each battle resolve/live read scores a bespoke window. */
export const aggregateSettlementAccuracy = async (
	params: ClearingDid.AggregateSettlementAccuracyParams
): Promise<ClearingDid.SettlementAccuracyEntry[]> => {
	const actor = await readerClearing();

	return await actor.aggregate_settlement_accuracy(params);
};

/** The per-participant settlement plan for a resolved series. Uncached: it
 * is read once per settlement to fan out resolved-result rows, and a stale
 * plan would fan out against superseded positions. */
export const getSettlementPlan = async (
	seriesId: string
): Promise<ClearingDid.SettlementPlan | undefined> => {
	const actor = await readerClearing();

	return fromNullable(await actor.get_settlement_plan(seriesId));
};

export const getSettlementStatus = (
	seriesId: string
): Promise<ClearingDid.SettlementStatusView | undefined> =>
	cached({
		key: `clearing:settlement:${seriesId}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();

			return fromNullable(await actor.get_settlement_status(seriesId));
		}
	});

/** Drains the settled-series cursor to completion, exactly like the app's
 * canister wrapper. */
export const listSettledSeries = (
	params?: ClearingDid.ListSettledSeriesParams
): Promise<string[]> =>
	cached({
		key: `clearing:settled:${JSON.stringify(params ?? {}, jsonReplacer)}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();
			const balanceDomain = params?.balance_domain ?? toNullable();
			const pageLimit = params?.limit ?? toNullable();
			const items: string[] = [];
			let startAfter = params?.start_after ?? toNullable();

			for (;;) {
				const page = await actor.list_settled_series({
					start_after: startAfter,
					limit: pageLimit,
					balance_domain: balanceDomain
				});

				items.push(...page.items);

				const next = fromNullable(page.next_cursor);

				if (isNullish(next)) {
					return items;
				}

				startAfter = toNullable(next);
			}
		}
	});

export const getSeriesPriceHistory = ({
	seriesId,
	interval,
	startTimeNs,
	endTimeNs
}: {
	seriesId: string;
	interval: ClearingDid.PriceHistoryInterval;
	startTimeNs?: bigint;
	endTimeNs?: bigint;
}): Promise<ClearingDid.SeriesPriceCandle[]> =>
	cached({
		key: `clearing:candles:${seriesId}:${JSON.stringify(interval)}:${startTimeNs ?? ''}:${endTimeNs ?? ''}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();
			const { candles } = await actor.get_series_price_history({
				series_id: seriesId,
				interval,
				start_time: toNullable(startTimeNs),
				end_time: toNullable(endTimeNs)
			});

			return candles;
		}
	});

export const listSeriesTradeHistory = ({
	seriesId,
	startAfter,
	limit
}: {
	seriesId: string;
	startAfter?: bigint;
	limit?: bigint;
}): Promise<ClearingDid.SeriesTradeHistoryPage> =>
	cached({
		key: `clearing:trades:${seriesId}:${startAfter ?? ''}:${limit ?? ''}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();

			return await actor.list_series_trade_history({
				series_id: seriesId,
				start_after: toNullable(startAfter),
				limit: toNullable(limit)
			});
		}
	});

export const listSeriesTradedVolumes = async (
	seriesIds: string[]
): Promise<ClearingDid.SeriesTradedVolume[]> => {
	const actor = await readerClearing();

	return await actor.list_series_traded_volumes({ series_ids: seriesIds });
};

/** Drains the leaderboard cursor (bounded by maxPages), like the app. */
export const listLeaderboard = async ({
	window,
	members,
	pageLimit,
	maxPages
}: {
	window: ClearingDid.LeaderboardWindow;
	members?: Principal[];
	pageLimit?: bigint;
	maxPages?: number;
}): Promise<{ items: ClearingDid.LeaderboardEntry[]; total: bigint }> => {
	const actor = await readerClearing();
	const items: ClearingDid.LeaderboardEntry[] = [];
	let startAfter: [] | [bigint] = toNullable();
	let total = BigInt(0);
	let pages = 0;

	while (isNullish(maxPages) || pages < maxPages) {
		const page = await actor.list_leaderboard({
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

// Privileged calls (admin identity)

export const submitMatchedTrade = async (
	params: ClearingDid.SubmitMatchedTradeParams
): Promise<boolean> => {
	const actor = await adminClearing();

	return expectOk(await actor.submit_matched_trade(params), 'submit_matched_trade');
};

export const settleSeries = async (params: ClearingDid.SettleSeriesParams): Promise<void> => {
	const actor = await adminClearing();

	for (;;) {
		const result = await actor.settle_series(params);

		if (!('Processing' in result)) {
			expectOk(result, 'settle_series');

			return;
		}
	}
};

export const registerIcrcAsset = async (
	params: ClearingDid.RegisterIcrcAssetParams
): Promise<void> => {
	const actor = await adminClearing();

	expectOk(await actor.register_icrc_asset(params), 'register_icrc_asset');
};
