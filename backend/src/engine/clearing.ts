// Typed wrappers over the clearing canister: the same method surface the app
// consumes on-chain today, re-exposed server-side. Public market-wide reads
// sign with the engine reader identity behind a short TTL cache (clearing
// rejects anonymous callers); account-scoped calls sign with the calling
// user's derived custodial identity; settlement-grade calls sign with the
// admin identity.

import {
	fromNullable,
	isNullish,
	jsonReplacer,
	nonNullish,
	nowInBigIntNanoSeconds,
	toNullable
} from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { Principal } from '@icp-sdk/core/principal';
import type { ClearingDid } from '../declarations';
import { env } from '../env';
import { ZERO } from '../lib/constants';
import { userIcIdentity } from '../lib/keys';
import { adminClearing, readerClearing, userClearing, userLedger } from './actors';
import { cached, getRetained, retain } from './cache';
import { orderRejectedError } from './order-rejections';

const PUBLIC_READ_TTL_MS = 15_000;

/** Same window the signed-in on-chain deposit grants: the approval only has to
 * outlive the deposit call that follows it. */
const COLLATERAL_APPROVAL_TTL_NS = BigInt(60) * BigInt(1_000_000_000);

/** A collateral call that ended with nothing still executing: clearing or the
 * ledger refused it, or it never got as far as signing. A retry cannot overlap
 * it. `code` is the API's stable error. */
export class CollateralRejectedError extends Error {
	readonly code: string;
	readonly status: number;

	constructor({ code, message, status = 400 }: { code: string; message: string; status?: number }) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

/** A read that runs ahead of the first signed update: if it fails, nothing has
 * reached the chain. */
const beforeSigning = async <T>(read: () => Promise<T>): Promise<T> => {
	try {
		return await read();
	} catch (err: unknown) {
		if (err instanceof CollateralRejectedError) {
			throw err;
		}

		throw new CollateralRejectedError({
			code: 'collateral_unavailable',
			status: 503,
			message: `collateral read failed: ${err instanceof Error ? err.message : String(err)}`
		});
	}
};

const expectOk = <O>(result: { Ok: O } | { Err: unknown }, label: string): O => {
	if ('Ok' in result) {
		return result.Ok;
	}

	throw new Error(`${label} failed: ${JSON.stringify(result.Err, jsonReplacer)}`);
};

const expectOrderOk = (result: ClearingDid.SubmitMatchedTradeResult, label: string): boolean => {
	const rejected = 'Err' in result ? orderRejectedError({ err: result.Err, label }) : undefined;

	if (nonNullish(rejected)) {
		throw rejected;
	}

	return expectOk(result, label);
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

const expectCollateralOk = (result: { Ok: null } | { Err: unknown }, label: string): void => {
	if ('Err' in result) {
		throw new CollateralRejectedError({
			code: 'collateral_rejected',
			message: `${label} failed: ${JSON.stringify(result.Err, jsonReplacer)}`
		});
	}
};

/** The ledger and balance domain of a catalog asset. Clearing reads a missing
 * domain as Settlement and refuses any asset not allowlisted there, so a
 * ViciXp-only asset must name its domain. Answers before anything is signed,
 * since an approval pays a ledger fee whatever clearing then decides. */
const resolveCollateral = async (
	assetId: string
): Promise<{ ledgerCanisterId: string; domain: ClearingDid.BalanceDomain }> => {
	const assets = await listCollateralAssets();
	const config = assets.find(({ config: { asset_id } }) => asset_id === assetId)?.config;

	if (isNullish(config) || !config.is_enabled || !('Icrc' in config.asset)) {
		throw new CollateralRejectedError({
			code: 'unknown_asset',
			message: `no enabled ICRC collateral asset ${assetId}`
		});
	}

	const { allowed_balance_domains: allowed } = config;
	const domain =
		allowed.find((candidate) => 'Settlement' in candidate) ??
		(allowed.length === 1 ? allowed[0] : undefined);

	if (isNullish(domain)) {
		throw new CollateralRejectedError({
			code: 'unknown_asset',
			message: `collateral asset ${assetId} has no unambiguous balance domain`
		});
	}

	return { ledgerCanisterId: config.asset.Icrc.toText(), domain };
};

const approveClearing = async ({
	userId,
	ledgerCanisterId,
	amount
}: {
	userId: string;
	ledgerCanisterId: string;
	amount: bigint;
}): Promise<void> => {
	const { ledger, fee } = await beforeSigning(async () => {
		const actor = await userLedger({ userId, ledgerCanisterId });

		return { ledger: actor, fee: await actor.transactionFee({}) };
	});

	try {
		await ledger.approve({
			spender: { owner: Principal.fromText(env.ic.clearingCanisterId), subaccount: [] },
			// icrc2_transfer_from draws the amount plus its own fee from the allowance.
			amount: amount + fee,
			expires_at: nowInBigIntNanoSeconds() + COLLATERAL_APPROVAL_TTL_NS
		});
	} catch (err: unknown) {
		if (err instanceof IcrcTransferError) {
			const { errorType } = err as IcrcTransferError<Record<string, unknown>>;

			throw new CollateralRejectedError({
				code: 'InsufficientFunds' in errorType ? 'insufficient_balance' : 'collateral_rejected',
				message: `icrc2_approve failed: ${JSON.stringify(errorType, jsonReplacer)}`
			});
		}

		throw err;
	}
};

// Account-scoped calls (signed with the user's derived identity)

/** Approves clearing, then lets it pull the funds. A `resumed` attempt skips
 * the approval: the deposit may already be final, which clearing answers
 * without touching the ledger, and if it is not, the refusal lands the caller
 * back on a fresh attempt. */
export const depositCollateral = async ({
	userId,
	depositId,
	assetId,
	amount,
	resumed
}: {
	userId: string;
	depositId: string;
	assetId: string;
	amount: bigint;
	resumed: boolean;
}): Promise<void> => {
	const { ledgerCanisterId, domain } = await beforeSigning(() => resolveCollateral(assetId));

	if (!resumed) {
		await approveClearing({ userId, ledgerCanisterId, amount });
	}

	const actor = await userClearing(userId);

	expectCollateralOk(
		await actor.deposit_collateral({
			deposit_id: depositId,
			asset_id: assetId,
			amount,
			domain: toNullable(domain)
		}),
		'deposit_collateral'
	);
};

export const withdrawCollateral = async ({
	userId,
	withdrawalId,
	assetId,
	amount
}: {
	userId: string;
	withdrawalId: string;
	assetId: string;
	amount: bigint;
}): Promise<void> => {
	const { domain } = await beforeSigning(() => resolveCollateral(assetId));
	const actor = await userClearing(userId);

	expectCollateralOk(
		await actor.withdraw_collateral({
			withdrawal_id: withdrawalId,
			asset_id: assetId,
			amount,
			domain: toNullable(domain)
		}),
		'withdraw_collateral'
	);
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

	return expectOrderOk(await actor.submit_limit_order(params), 'submit_limit_order');
};

export const submitMarketOrder = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.SubmitMarketOrderParams;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOrderOk(await actor.submit_market_order(params), 'submit_market_order');
};

export const cancelLimitOrder = async ({
	userId,
	params
}: {
	userId: string;
	params: ClearingDid.CancelLimitOrderParams;
}): Promise<boolean> => {
	const actor = await userClearing(userId);

	return expectOrderOk(await actor.cancel_limit_order(params), 'cancel_limit_order');
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

const settlementKey = (seriesId: string): string => `clearing:settlement:${seriesId}`;

/** A Finalised plan is immutable: clearing's settle path returns early on one
 * and nothing rewrites or removes it, so a catalog-wide read must not pay for
 * it twice. Anything else is still moving (a Planned / Executing view) or may
 * yet appear (no view), and stays on the TTL. Only views the engine returned
 * as Finalised are kept, so unknown ids in a request cannot grow this. */
const retainIfFinalised = ({
	seriesId,
	view
}: {
	seriesId: string;
	view: ClearingDid.SettlementStatusView | undefined;
}): void => {
	if (nonNullish(view) && 'Finalised' in view.status) {
		retain({ key: settlementKey(seriesId), value: view });
	}
};

export const getSettlementStatus = async (
	seriesId: string
): Promise<ClearingDid.SettlementStatusView | undefined> => {
	const key = settlementKey(seriesId);
	const finalised = getRetained<ClearingDid.SettlementStatusView>(key);

	if (nonNullish(finalised)) {
		return finalised;
	}

	const view = await cached({
		key,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();

			return fromNullable(await actor.get_settlement_status(seriesId));
		}
	});

	retainIfFinalised({ seriesId, view });

	return view;
};

/** The settlement views of a series set, one canister read per call however
 * many ids it carries. Series with no plan are absent from the result. */
export const listSettlementStatuses = async (
	seriesIds: string[]
): Promise<ClearingDid.SettlementStatusView[]> => {
	const views: ClearingDid.SettlementStatusView[] = [];
	const unread: string[] = [];

	for (const seriesId of seriesIds) {
		const finalised = getRetained<ClearingDid.SettlementStatusView>(settlementKey(seriesId));

		if (nonNullish(finalised)) {
			views.push(finalised);
		} else {
			unread.push(seriesId);
		}
	}

	if (unread.length === 0) {
		return views;
	}

	const statuses = await cached({
		key: `clearing:settlements:${JSON.stringify(unread)}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerClearing();

			return await actor.list_series_settlement_statuses({ series_ids: unread });
		}
	});

	for (const { series_id: seriesId, status } of statuses) {
		const view = fromNullable(status);

		retainIfFinalised({ seriesId, view });

		if (nonNullish(view)) {
			views.push(view);
		}
	}

	return views;
};

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
