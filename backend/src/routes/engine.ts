// Engine surface: public market reads (signed by the engine reader identity,
// cached server-side) and session-gated account operations (orders,
// collateral). The signing identity for gated calls is the caller's derived
// custodial IC identity, so the engine sees the same principal that owns the
// user's positions.

import { isNullish, toNullable } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import type { ClearingDid } from '../declarations';
import * as clearing from '../engine/clearing';
import * as registry from '../engine/registry';
import { toJson } from '../engine/serialize';

interface StatusContext {
	status?: number | string;
}

const badRequest = (set: StatusContext, error: string): { error: string } => {
	set.status = 400;

	return { error };
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
						oracle_source: toNullable()
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
	.get('/account', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const state = await clearing.getAccountStateQuery({ userId: user.id });

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

			await clearing.depositCollateral({
				userId: user.id,
				params: {
					deposit_id: body.depositId,
					asset_id: body.assetId,
					amount: BigInt(body.amount),
					domain: toNullable()
				}
			});

			return { ok: true };
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

			await clearing.withdrawCollateral({
				userId: user.id,
				params: {
					withdrawal_id: body.withdrawalId,
					asset_id: body.assetId,
					amount: BigInt(body.amount),
					domain: toNullable()
				}
			});

			return { ok: true };
		},
		{
			body: t.Object({
				withdrawalId: t.String({ minLength: 1, maxLength: 128 }),
				assetId: t.String({ minLength: 1 }),
				amount: t.String({ pattern: '^\\d+$' })
			})
		}
	);
