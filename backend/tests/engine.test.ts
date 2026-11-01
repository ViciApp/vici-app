// Engine client behavior with the actor mocked at the provider boundary:
// per-user signing identities, the reader identity behind every public read,
// result unwrapping (including the missing-account mapping), cursor
// draining, the public-read cache (TTL, in-flight dedupe, Finalised retention)
// and the bulk settlement route.

import { toNullable } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import { afterEach, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { cached, clearCache } from '../src/engine/cache';
import * as clearing from '../src/engine/clearing';
import * as registry from '../src/engine/registry';
import { app } from '../src/index';
import { engineReaderIcIdentity, userIcPrincipalText } from '../src/lib/keys';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const USER_A = '44444444-4444-4444-4444-444444444444';
const USER_B = '55555555-5555-5555-5555-555555555555';

let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	clearCache();
});

const mockProvider = ({
	clearing: clearingActor,
	registry: registryActor,
	onIdentity
}: {
	clearing?: Record<string, unknown>;
	registry?: Record<string, unknown>;
	onIdentity?: (identity: Identity) => void;
}): void => {
	restore = setEngineActorProvider({
		clearing: (identity) => {
			onIdentity?.(identity);

			return Promise.resolve((clearingActor ?? {}) as unknown as ClearingService);
		},
		registry: (identity) => {
			onIdentity?.(identity);

			return Promise.resolve((registryActor ?? {}) as unknown as RegistryService);
		}
	});
};

describe('per-user signing', () => {
	test('account calls sign with the derived custodial identity of the caller', async () => {
		const principals: string[] = [];

		mockProvider({
			clearing: { get_positions: () => Promise.resolve([]) },
			onIdentity: (identity) => principals.push(identity.getPrincipal().toText())
		});

		await clearing.getPositions({ userId: USER_A });
		await clearing.getPositions({ userId: USER_B });

		expect(principals).toEqual([userIcPrincipalText(USER_A), userIcPrincipalText(USER_B)]);
		expect(principals[0]).not.toBe(principals[1]);
	});

	test('public reads sign with the engine reader identity, never anonymously', async () => {
		const principals: string[] = [];

		mockProvider({
			clearing: { list_collateral_assets: () => Promise.resolve([]) },
			registry: { get_series: () => Promise.resolve(toNullable()) },
			onIdentity: (identity) => principals.push(identity.getPrincipal().toText())
		});

		await clearing.listCollateralAssets();
		await registry.getSeries('series-1');

		const reader = engineReaderIcIdentity().getPrincipal().toText();

		expect(principals).toEqual([reader, reader]);
		expect(principals).not.toContain('2vxsx-fae');
	});
});

describe('account state', () => {
	test('a principal with no clearing account reads as an empty account', async () => {
		mockProvider({
			clearing: {
				get_account_state_query: () => Promise.resolve({ Err: { NoAccountStateFound: null } })
			}
		});

		const state = await clearing.getAccountStateQuery({ userId: USER_A });

		expect(state.assets).toEqual([]);
		expect(state.state.balances).toEqual([]);
		expect(state.state.reserved_margins_usd).toEqual([]);
		expect(state.state.cash_balances_usd).toEqual([]);
		expect(state.total_equity_usd).toBe(BigInt(0));
		expect(state.available_margin_usd).toBe(BigInt(0));
		expect(state.state.user.toText()).toBe(userIcPrincipalText(USER_A));
	});

	test('every other account error still throws', async () => {
		mockProvider({
			clearing: {
				get_account_state_query: () => Promise.resolve({ Err: { MathOverflow: null } }),
				get_account_state: () => Promise.resolve({ Err: { MathOverflow: null } })
			}
		});

		await expect(clearing.getAccountStateQuery({ userId: USER_A })).rejects.toThrow(
			'get_account_state_query failed'
		);
		await expect(
			clearing.getAccountState({
				userId: USER_A,
				params: { refresh: toNullable(), domain: toNullable() }
			})
		).rejects.toThrow('get_account_state failed');
	});
});

describe('result unwrapping', () => {
	test('Ok results unwrap, Err results throw with the encoded error', async () => {
		mockProvider({
			clearing: {
				submit_limit_order: () => Promise.resolve({ Ok: true }),
				cancel_limit_order: () => Promise.resolve({ Err: { OrderNotFound: null } })
			}
		});

		const params = {
			order_id: 'o1',
			series_id: 's1',
			outcome_id: toNullable<string>(),
			side: { Buy: null },
			qty: BigInt(1),
			price: {
				timestamp: toNullable<bigint>(),
				oracle_id: toNullable<string>(),
				decimal: { value: BigInt(50), decimals: 2 }
			}
		};

		expect(await clearing.submitLimitOrder({ userId: USER_A, params })).toBe(true);
		expect(
			clearing.cancelLimitOrder({ userId: USER_A, params: { order_id: 'nope' } })
		).rejects.toThrow('cancel_limit_order failed');
	});
});

describe('cursor draining', () => {
	test('listSettledSeries follows next_cursor to completion', async () => {
		const calls: unknown[] = [];

		mockProvider({
			clearing: {
				list_settled_series: (params: { start_after: [] | [string] }) => {
					calls.push(params.start_after);

					return Promise.resolve(
						params.start_after.length === 0
							? { items: ['s1', 's2'], next_cursor: toNullable('s2'), total: BigInt(3) }
							: { items: ['s3'], next_cursor: toNullable<string>(), total: BigInt(3) }
					);
				}
			}
		});

		expect(await clearing.listSettledSeries()).toEqual(['s1', 's2', 's3']);
		expect(calls).toHaveLength(2);
	});
});

describe('public read cache', () => {
	test('a second read inside the TTL never hits the actor', async () => {
		let loads = 0;

		mockProvider({
			registry: {
				get_series: () => {
					loads++;

					return Promise.resolve(toNullable());
				}
			}
		});

		await registry.getSeries('series-1');
		await registry.getSeries('series-1');

		expect(loads).toBe(1);

		// A different key loads independently.
		await registry.getSeries('series-2');

		expect(loads).toBe(2);
	});

	test('concurrent callers of one key share a single load', async () => {
		let loads = 0;

		let finish: (value: string) => void = () => {};

		const load = (): Promise<string> => {
			loads++;

			return new Promise((resolve) => {
				finish = resolve;
			});
		};

		const reads = [1, 2, 3].map(() => cached({ key: 'shared', ttlMs: 1_000, load }));

		finish('value');

		expect(await Promise.all(reads)).toEqual(['value', 'value', 'value']);
		expect(loads).toBe(1);
	});

	test('a failed load rejects every waiter and the next read retries', async () => {
		let loads = 0;

		const load = (): Promise<string> => {
			loads++;

			return loads === 1 ? Promise.reject(new Error('canister down')) : Promise.resolve('value');
		};

		const reads = await Promise.allSettled(
			[1, 2].map(() => cached({ key: 'flaky', ttlMs: 1_000, load }))
		);

		expect(reads.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
		expect(loads).toBe(1);

		expect(await cached({ key: 'flaky', ttlMs: 1_000, load })).toBe('value');
		expect(loads).toBe(2);
	});
});

describe('POST /api/v1/engine/series/settlements', () => {
	const PAST_THE_TTL_MS = 16_000;

	const status = (name: 'Finalised' | 'Planned' | 'Executing'): Record<string, null> => ({
		[name]: null
	});

	const view = ({
		seriesId,
		name = 'Finalised'
	}: {
		seriesId: string;
		name?: 'Finalised' | 'Planned' | 'Executing';
	}): Record<string, unknown> => ({
		series_id: seriesId,
		status: status(name),
		fee_usd: BigInt(1),
		settlement: { Outcome: 'YES' }
	});

	/** Answers every id from `views` and records each canister read. */
	const mockStatuses = (
		views: Record<string, unknown>[]
	): { batches: string[][]; singles: string[] } => {
		const batches: string[][] = [];
		const singles: string[] = [];

		const lookup = (seriesId: string): [] | [Record<string, unknown>] =>
			toNullable(views.find(({ series_id }) => series_id === seriesId));

		mockProvider({
			clearing: {
				list_series_settlement_statuses: ({ series_ids }: { series_ids: string[] }) => {
					batches.push(series_ids);

					return Promise.resolve(
						series_ids.map((seriesId) => ({ series_id: seriesId, status: lookup(seriesId) }))
					);
				},
				get_settlement_status: (seriesId: string) => {
					singles.push(seriesId);

					return Promise.resolve(lookup(seriesId));
				}
			}
		});

		return { batches, singles };
	};

	const post = async (seriesIds: string[]): Promise<Response> =>
		await app.handle(
			new Request('http://localhost/api/v1/engine/series/settlements', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ seriesIds })
			})
		);

	const settlementIds = async (res: Response): Promise<string[]> => {
		const { settlements } = (await res.json()) as { settlements: { series_id: string }[] };

		return settlements.map(({ series_id }) => series_id);
	};

	afterEach(() => {
		setSystemTime();
	});

	test('reads the whole set in one canister call and serializes each view', async () => {
		const { batches } = mockStatuses([view({ seriesId: 's1' }), view({ seriesId: 's2' })]);

		const res = await post(['s1', 's2', 'unknown']);

		expect(res.status).toBe(200);

		const { settlements } = (await res.json()) as { settlements: Record<string, unknown>[] };

		expect(settlements.map(({ series_id }) => series_id)).toEqual(['s1', 's2']);
		expect(settlements[0]?.fee_usd).toBe('1');
		expect(batches).toEqual([['s1', 's2', 'unknown']]);
	});

	test('accepts 100 ids and refuses 101 before reaching the engine', async () => {
		const { batches } = mockStatuses([]);
		const ids = Array.from({ length: 101 }, (_, i) => `s${i}`);

		expect((await post(ids.slice(0, 100))).status).toBe(200);
		expect(batches).toHaveLength(1);

		expect((await post(ids)).status).toBe(400);
		expect(batches).toHaveLength(1);
	});

	test('an engine failure fails the request and leaves nothing behind', async () => {
		let reads = 0;

		mockProvider({
			clearing: {
				list_series_settlement_statuses: () => {
					reads++;

					return Promise.reject(new Error('canister down'));
				}
			}
		});

		expect((await post(['s1'])).status).toBe(500);
		expect((await post(['s1'])).status).toBe(500);
		expect(reads).toBe(2);
	});

	test('a Finalised settlement outlives the TTL and the entry bound', async () => {
		const { batches, singles } = mockStatuses([view({ seriesId: 's1' })]);

		await post(['s1']);

		for (let i = 0; i < 600; i++) {
			await cached({ key: `filler:${i}`, ttlMs: 1_000, load: () => Promise.resolve(i) });
		}

		setSystemTime(new Date(Date.now() + PAST_THE_TTL_MS));

		expect(await settlementIds(await post(['s1']))).toEqual(['s1']);
		expect((await clearing.getSettlementStatus('s1'))?.series_id).toBe('s1');
		expect(batches).toHaveLength(1);
		expect(singles).toEqual([]);
	});

	test('the single-series read retains a Finalised view for the bulk read', async () => {
		const { batches, singles } = mockStatuses([view({ seriesId: 's1' })]);

		await clearing.getSettlementStatus('s1');

		setSystemTime(new Date(Date.now() + PAST_THE_TTL_MS));

		expect(await settlementIds(await post(['s1']))).toEqual(['s1']);
		expect(singles).toEqual(['s1']);
		expect(batches).toEqual([]);
	});

	test('a non-final or missing status is reread once the TTL lapses', async () => {
		const seriesIds = ['planned', 'executing', 'missing'];
		const { batches } = mockStatuses([
			view({ seriesId: 'planned', name: 'Planned' }),
			view({ seriesId: 'executing', name: 'Executing' })
		]);

		await post(seriesIds);
		await post(seriesIds);

		expect(batches).toHaveLength(1);

		setSystemTime(new Date(Date.now() + PAST_THE_TTL_MS));

		await post(seriesIds);

		expect(batches).toHaveLength(2);
	});

	test('only the ids not yet retained reach the engine', async () => {
		const { batches } = mockStatuses([
			view({ seriesId: 'final' }),
			view({ seriesId: 'moving', name: 'Executing' })
		]);

		await post(['final']);

		expect(await settlementIds(await post(['final', 'moving']))).toEqual(['final', 'moving']);
		expect(batches).toEqual([['final'], ['moving']]);
	});

	test('a series that finalises is served Finalised once its TTL lapses', async () => {
		const views = [view({ seriesId: 's1', name: 'Executing' })];
		const { batches } = mockStatuses(views);

		await post(['s1']);

		views[0] = view({ seriesId: 's1' });

		setSystemTime(new Date(Date.now() + PAST_THE_TTL_MS));

		const { settlements } = (await (await post(['s1'])).json()) as {
			settlements: { status: Record<string, null> }[];
		};

		expect(settlements[0]?.status).toEqual({ Finalised: null });
		expect(batches).toHaveLength(2);
	});
});

describe('public engine routes', () => {
	const SERIES = 'series-1';

	// Every public route with the canister method it reaches: each must answer
	// 200 and every call it makes must be signed by the reader identity.
	const ROUTES: { path: string; init?: RequestInit }[] = [
		{ path: '/api/v1/engine/series' },
		{ path: '/api/v1/engine/series?tradeable_now=true' },
		{ path: `/api/v1/engine/series/${SERIES}` },
		{ path: `/api/v1/engine/series/${SERIES}/settlement` },
		{ path: `/api/v1/engine/series/${SERIES}/price-history?interval=day` },
		{ path: `/api/v1/engine/series/${SERIES}/trades` },
		{
			path: '/api/v1/engine/series/volumes',
			init: {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ seriesIds: [SERIES] })
			}
		},
		{
			path: '/api/v1/engine/series/settlements',
			init: {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ seriesIds: [SERIES] })
			}
		},
		{ path: '/api/v1/engine/settled-series' },
		{ path: '/api/v1/engine/collateral-assets' },
		{ path: '/api/v1/engine/leaderboard?window=week' }
	];

	const emptyPage = { items: [], next_cursor: toNullable() };

	test('every public read is signed by the engine reader identity', async () => {
		const reader = engineReaderIcIdentity().getPrincipal().toText();

		for (const { path, init } of ROUTES) {
			clearCache();

			const principals: string[] = [];

			mockProvider({
				clearing: {
					get_settlement_status: () => Promise.resolve(toNullable()),
					list_series_settlement_statuses: () => Promise.resolve([]),
					get_series_price_history: () => Promise.resolve({ candles: [] }),
					list_series_trade_history: () => Promise.resolve(emptyPage),
					list_series_traded_volumes: () => Promise.resolve([]),
					list_settled_series: () => Promise.resolve({ ...emptyPage, total: BigInt(0) }),
					list_collateral_assets: () => Promise.resolve([]),
					list_leaderboard: () => Promise.resolve({ ...emptyPage, total: BigInt(0) })
				},
				registry: {
					list_series: () => Promise.resolve(emptyPage),
					list_series_with: () => Promise.resolve(emptyPage),
					get_series: () => Promise.resolve(toNullable({ series_id: SERIES }))
				},
				onIdentity: (identity) => principals.push(identity.getPrincipal().toText())
			});

			const res = await app.handle(new Request(`http://localhost${path}`, init));

			expect({ path, status: res.status }).toEqual({ path, status: 200 });
			expect(principals.length).toBeGreaterThan(0);
			expect(new Set(principals)).toEqual(new Set([reader]));
		}
	});
});

describe.if(dbAvailable)('order routes', () => {
	const LIMIT_ORDER = {
		orderId: 'ORD_1',
		seriesId: 's1',
		side: 'buy',
		qty: '10',
		priceValue: '50',
		priceDecimals: 2
	};

	const LIMIT_ROUTE = { path: 'limit', method: 'submit_limit_order', body: LIMIT_ORDER };

	const ROUTES = [
		LIMIT_ROUTE,
		{
			path: 'market',
			method: 'submit_market_order',
			body: { tradeId: 'T1', matchingOrderId: 'O1' }
		},
		{ path: 'cancel', method: 'cancel_limit_order', body: { orderId: 'O1' } }
	];

	const ENGINE_TEXT = 'internal engine text';

	// Spelled out rather than read from the table: a moved code or status is a
	// wire contract change this suite must notice.
	const REJECTIONS: { err: Record<string, unknown>; status: number; code: string }[] = [
		{
			err: { SeriesNotStarted: { series_id: ENGINE_TEXT, start_ns: BigInt(1) } },
			status: 409,
			code: 'market_not_started'
		},
		{
			err: { SeriesExpired: { series_id: ENGINE_TEXT, expiry_ns: BigInt(1) } },
			status: 409,
			code: 'market_closed'
		},
		{ err: { SeriesAlreadySettled: ENGINE_TEXT }, status: 409, code: 'market_settled' },
		{ err: { SeriesNotFound: ENGINE_TEXT }, status: 404, code: 'market_not_found' },
		{ err: { OrderNotFound: ENGINE_TEXT }, status: 404, code: 'order_not_found' },
		{ err: { NotOrderCreator: null }, status: 403, code: 'not_order_creator' },
		{ err: { NotAuthorizedToTrade: null }, status: 403, code: 'market_restricted' },
		{ err: { SelfTradingNotAllowed: null }, status: 409, code: 'self_trade' },
		{
			err: { ArbitrageLimitExceeded: { sum_usd: BigInt(2), limit_usd: BigInt(1) } },
			status: 409,
			code: 'arbitrage_limit_exceeded'
		},
		{ err: { Common: { InvalidInput: ENGINE_TEXT } }, status: 400, code: 'invalid_order' }
	];

	const FAULTS: Record<string, unknown>[] = [
		{ RegistryError: ENGINE_TEXT },
		{ Common: { Internal: ENGINE_TEXT } },
		{ Common: { MathOverflow: null } },
		{ Common: { RegistryNotSet: null } },
		{ Common: { Unauthorized: null } },
		// A variant newer than these bindings must land on the fault side.
		{ AccountFrozen: ENGINE_TEXT }
	];

	let cookie: string;

	beforeAll(async () => {
		await ensureMigrated();

		cookie = `vici_session=${await createSession(await createTestUser())}`;
	});

	const post = async ({
		path,
		body
	}: {
		path: string;
		body: Record<string, unknown>;
	}): Promise<Response> =>
		await app.handle(
			new Request(`http://localhost/api/v1/engine/orders/${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie },
				body: JSON.stringify(body)
			})
		);

	const refuseWith = (err: Record<string, unknown>): void => {
		mockProvider({
			clearing: Object.fromEntries(
				ROUTES.map(({ method }) => [method, () => Promise.resolve({ Err: err })])
			)
		});
	};

	for (const { err, status, code } of REJECTIONS) {
		test(`${code} answers ${status} on every order route`, async () => {
			refuseWith(err);

			for (const route of ROUTES) {
				const res = await post(route);

				expect({ path: route.path, status: res.status }).toEqual({ path: route.path, status });
				expect(await res.json()).toEqual({ error: code });
			}
		});
	}

	test('insufficient margin carries the amounts and never the principal', async () => {
		const user = engineReaderIcIdentity().getPrincipal();

		refuseWith({
			InsufficientMargin: { user, balance: BigInt(1_500), required: BigInt(2_000) }
		});

		const res = await post(LIMIT_ROUTE);

		expect(res.status).toBe(400);

		const body = await res.text();

		expect(JSON.parse(body)).toEqual({
			error: 'insufficient_balance',
			available: '1500',
			required: '2000'
		});
		expect(body).not.toContain(user.toText());
	});

	for (const err of FAULTS) {
		test(`${JSON.stringify(err)} stays a 500 on every order route`, async () => {
			refuseWith(err);

			for (const route of ROUTES) {
				const res = await post(route);

				expect(res.status).toBe(500);
				expect(await res.json()).toEqual({ error: 'internal' });
			}
		});
	}

	test('an unreachable engine stays a 500', async () => {
		mockProvider({
			clearing: Object.fromEntries(
				ROUTES.map(({ method }) => [method, () => Promise.reject(new Error(ENGINE_TEXT))])
			)
		});

		for (const route of ROUTES) {
			const res = await post(route);

			expect(res.status).toBe(500);
			expect(await res.json()).toEqual({ error: 'internal' });
		}
	});

	test('an accepted order still answers 200', async () => {
		mockProvider({
			clearing: {
				submit_limit_order: () => Promise.resolve({ Ok: true }),
				submit_market_order: () => Promise.resolve({ Ok: false }),
				cancel_limit_order: () => Promise.resolve({ Ok: true })
			}
		});

		const [limit, market, cancel] = await Promise.all(ROUTES.map(post));

		expect(limit?.status).toBe(200);
		expect(await limit?.json()).toEqual({ filled: true });
		expect(await market?.json()).toEqual({ filled: false });
		expect(await cancel?.json()).toEqual({ cancelled: true });
	});
});

describe.if(dbAvailable)('GET /api/v1/engine/account', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const getAccount = async (): Promise<Response> => {
		const userId = await createTestUser();
		const token = await createSession(userId);

		return await app.handle(
			new Request('http://localhost/api/v1/engine/account', {
				headers: { cookie: `vici_session=${token}` }
			})
		);
	};

	test('answers 200 with an empty account for a principal clearing has never seen', async () => {
		mockProvider({
			clearing: {
				get_account_state_query: () => Promise.resolve({ Err: { NoAccountStateFound: null } })
			}
		});

		const res = await getAccount();

		expect(res.status).toBe(200);

		const { account } = (await res.json()) as {
			account: {
				assets: unknown[];
				state: { user: string; balances: unknown[] };
				total_equity_usd: string;
				available_margin_usd: string;
			};
		};

		expect(account.assets).toEqual([]);
		expect(account.state.balances).toEqual([]);
		expect(account.total_equity_usd).toBe('0');
		expect(account.available_margin_usd).toBe('0');
		expect(account.state.user).not.toBe('2vxsx-fae');
	});

	test('any other clearing error still fails the request', async () => {
		mockProvider({
			clearing: {
				get_account_state_query: () => Promise.resolve({ Err: { MathOverflow: null } })
			}
		});

		const res = await getAccount();

		expect(res.status).toBe(500);
	});
});
