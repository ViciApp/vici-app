// Engine surface: public market reads (signed by the engine reader identity,
// cached server-side) and session-gated account operations (orders,
// collateral). The signing identity for gated calls is the caller's derived
// custodial IC identity, so the engine sees the same principal that owns the
// user's positions.

import { isNullish, toNullable } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import {
	claimCollateralOperation,
	completeCollateralOperation,
	releaseCollateralOperation,
	type CollateralOperationKind
} from '../custody/collateral-operations';
import type { ClearingDid } from '../declarations';
import * as clearing from '../engine/clearing';
import * as registry from '../engine/registry';
import { toJson } from '../engine/serialize';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';

interface StatusContext {
	status?: number | string;
}

const badRequest = (set: StatusContext, error: string): { error: string } => {
	set.status = 400;

	return { error };
};

/** Runs a collateral call under its id's claim. A finished id answers without
 * touching the chain and a held one answers 409. A refusal releases the claim
 * for a retry; any other failure leaves the outcome unknown, so the claim stays
 * until its lease proves the call cannot still be executing. */
const runCollateralOperation = async ({
	set,
	run,
	...operation
}: {
	set: StatusContext;
	userId: string;
	kind: CollateralOperationKind;
	operationId: string;
	run: (attempt: { resumed: boolean }) => Promise<void>;
}): Promise<{ ok: true } | { error: string }> => {
	const claim = await claimCollateralOperation(operation);

	if (claim === 'done') {
		return { ok: true };
	}

	if (claim === 'in_flight') {
		set.status = 409;

		return { error: 'operation_in_progress' };
	}

	try {
		await run({ resumed: claim === 'resumed' });
	} catch (err: unknown) {
		if (err instanceof clearing.CollateralRejectedError) {
			logger.warn(`collateral ${operation.kind} refused:`, err.message);

			await releaseCollateralOperation(operation);

			return badRequest(set, err.code);
		}

		throw err;
	}

	await completeCollateralOperation(operation);

	return { ok: true };
};

const INTERVALS: Record<string, ClearingDid.PriceHistoryInterval> = {
	hour: { Hour: null },
	day: { Day: null }
};

const WINDOWS: Record<string, ClearingDid.LeaderboardWindow> = {
	week: { Week: null },
	month: { Month: null },
	all_time: { AllTime: null }
};

const BALANCE_DOMAINS: Record<string, ClearingDid.BalanceDomain> = {
	Settlement: { Settlement: null },
	ViciXp: { ViciXp: null },
	Playground: { Playground: null },
	Social: { Social: null }
};

// Total parse: a malformed query value degrades to "not provided" instead of
// a thrown BigInt error surfacing as a 500.
const optionalBigInt = (value: string | undefined): bigint | undefined =>
	isNullish(value) || !/^\d+$/.test(value) ? undefined : BigInt(value);

export const engineRoutes = new Elysia({ prefix: '/api/v1/engine' })
	// Public market catalog + market-wide reads
	.get('/series', async ({ query: qs }) => {
		const tradeableNow = qs.tradeable_now === 'true';
		const series = await registry.listSeries(
			tradeableNow
				? {
						strike: toNullable(),
						creator: toNullable(),
						payoff_type: toNullable(),
						payout_unit: toNullable(),
						tradeable_now: toNullable(true),
						pagination: toNullable(),
						underlying: toNullable(),
						only_unexpired: toNullable(),
						search_term: toNullable(),
						balance_domain: toNullable(),
						oracle_source: toNullable(),
						due: toNullable()
					}
				: undefined
		);

		return { series: toJson(series) };
	})
	.get('/series/:id', async ({ params, set }) => {
		const series = await registry.getSeries(params.id);

		if (isNullish(series)) {
			set.status = 404;

			return { error: 'not_found' };
		}

		return { series: toJson(series) };
	})
	.get('/series/:id/settlement', async ({ params }) => {
		const settlement = await clearing.getSettlementStatus(params.id);

		return { settlement: toJson(settlement ?? null) };
	})
	.get('/series/:id/price-history', async ({ params, query: qs, set }) => {
		const interval = INTERVALS[qs.interval ?? 'hour'];

		if (isNullish(interval)) {
			return badRequest(set, 'invalid_interval');
		}

		const candles = await clearing.getSeriesPriceHistory({
			seriesId: params.id,
			interval,
			startTimeNs: optionalBigInt(qs.start_ns),
			endTimeNs: optionalBigInt(qs.end_ns)
		});

		return { candles: toJson(candles) };
	})
	.get('/series/:id/trades', async ({ params, query: qs }) => {
		const page = await clearing.listSeriesTradeHistory({
			seriesId: params.id,
			startAfter: optionalBigInt(qs.start_after),
			limit: optionalBigInt(qs.limit)
		});

		return { page: toJson(page) };
	})
	.post(
		'/series/volumes',
		async ({ body }) => {
			const volumes = await clearing.listSeriesTradedVolumes(body.seriesIds);

			return { volumes: toJson(volumes) };
		},
		{ body: t.Object({ seriesIds: t.Array(t.String(), { maxItems: 100 }) }) }
	)
	.post(
		'/series/settlements',
		async ({ body }) => {
			const settlements = await clearing.listSettlementStatuses(body.seriesIds);

			return { settlements: toJson(settlements) };
		},
		{ body: t.Object({ seriesIds: t.Array(t.String(), { maxItems: 100 }) }) }
	)
	.get('/settled-series', async () => {
		const settled = await clearing.listSettledSeries();

		return { settled };
	})
	.get('/collateral-assets', async () => {
		const assets = await clearing.listCollateralAssets();

		return { assets: toJson(assets) };
	})
	.get('/leaderboard', async ({ query: qs, set }) => {
		const window = WINDOWS[qs.window ?? 'all_time'];

		if (isNullish(window)) {
			return badRequest(set, 'invalid_window');
		}

		const { items, total } = await clearing.listLeaderboard({
			window,
			pageLimit: optionalBigInt(qs.limit),
			maxPages: 5
		});

		return { items: toJson(items), total: total.toString() };
	})
	// Session-gated account surface
	.get('/account', async ({ request, set, query: qs }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		if (isNullish(qs.domain)) {
			const state = await clearing.getAccountStateQuery({ userId: user.id });

			return { account: toJson(state) };
		}

		const domain = BALANCE_DOMAINS[qs.domain];

		if (isNullish(domain)) {
			return badRequest(set, 'invalid_domain');
		}

		// The query always computes equity and margin for Settlement, so the
		// reserved figures of any other domain need this update call. `refresh`
		// stays off: it only pings the ledgers and rewrites nothing.
		const state = await clearing.getAccountState({
			userId: user.id,
			params: { refresh: toNullable(false), domain: toNullable(domain) }
		});

		return { account: toJson(state) };
	})
	.get('/positions', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const positions = await clearing.getPositions({ userId: user.id });

		return { positions: toJson(positions) };
	})
	.get('/orders', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const orders = await clearing.getOrders({ userId: user.id });

		return { orders: toJson(orders) };
	})
	.get('/trade-history', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const events = await clearing.getTradeHistory({ userId: user.id });

		return { events: toJson(events) };
	})
	.post(
		'/orders/limit',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const filled = await clearing.submitLimitOrder({
				userId: user.id,
				params: {
					order_id: body.orderId,
					series_id: body.seriesId,
					outcome_id: toNullable(body.outcomeId),
					side: body.side === 'buy' ? { Buy: null } : { Sell: null },
					qty: BigInt(body.qty),
					price: {
						timestamp: toNullable(),
						oracle_id: toNullable(),
						decimal: { value: BigInt(body.priceValue), decimals: body.priceDecimals }
					}
				}
			});

			return { filled };
		},
		{
			body: t.Object({
				orderId: t.String({ minLength: 1, maxLength: 128 }),
				seriesId: t.String({ minLength: 1 }),
				outcomeId: t.Optional(t.String()),
				side: t.Union([t.Literal('buy'), t.Literal('sell')]),
				qty: t.String({ pattern: '^\\d+$' }),
				/** Fixed-point price: mantissa + decimals, matching the engine's
				 * DecimalValue encoding. */
				priceValue: t.String({ pattern: '^\\d+$' }),
				priceDecimals: t.Integer({ minimum: 0, maximum: 18 })
			})
		}
	)
	.post(
		'/orders/market',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const filled = await clearing.submitMarketOrder({
				userId: user.id,
				params: {
					trade_id: body.tradeId,
					matching_order_id: body.matchingOrderId,
					qty: toNullable(optionalBigInt(body.qty))
				}
			});

			return { filled };
		},
		{
			body: t.Object({
				tradeId: t.String({ minLength: 1, maxLength: 128 }),
				matchingOrderId: t.String({ minLength: 1 }),
				qty: t.Optional(t.String({ pattern: '^\\d+$' }))
			})
		}
	)
	.post(
		'/orders/cancel',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const cancelled = await clearing.cancelLimitOrder({
				userId: user.id,
				params: { order_id: body.orderId }
			});

			return { cancelled };
		},
		{ body: t.Object({ orderId: t.String({ minLength: 1 }) }) }
	)
	.post(
		'/collateral/deposit',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const amount = BigInt(body.amount);

			if (amount <= ZERO) {
				return badRequest(set, 'invalid_amount');
			}

			return await runCollateralOperation({
				set,
				userId: user.id,
				kind: 'deposit',
				operationId: body.depositId,
				run: ({ resumed }) =>
					clearing.depositCollateral({
						userId: user.id,
						depositId: body.depositId,
						assetId: body.assetId,
						amount,
						resumed
					})
			});
		},
		{
			body: t.Object({
				depositId: t.String({ minLength: 1, maxLength: 128 }),
				assetId: t.String({ minLength: 1 }),
				amount: t.String({ pattern: '^\\d+$' })
			})
		}
	)
	.post(
		'/collateral/withdraw',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const amount = BigInt(body.amount);

			if (amount <= ZERO) {
				return badRequest(set, 'invalid_amount');
			}

			return await runCollateralOperation({
				set,
				userId: user.id,
				kind: 'withdraw',
				operationId: body.withdrawalId,
				run: () =>
					clearing.withdrawCollateral({
						userId: user.id,
						withdrawalId: body.withdrawalId,
						assetId: body.assetId,
						amount
					})
			});
		},
		{
			body: t.Object({
				withdrawalId: t.String({ minLength: 1, maxLength: 128 }),
				assetId: t.String({ minLength: 1 }),
				amount: t.String({ pattern: '^\\d+$' })
			})
		}
	);
