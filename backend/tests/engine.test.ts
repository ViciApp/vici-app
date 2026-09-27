// Engine client behavior with the actor mocked at the provider boundary:
// per-user signing identities, the reader identity behind every public read,
// result unwrapping (including the missing-account mapping), cursor
// draining, and the public-read TTL cache.

import { toNullable } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { clearCache } from '../src/engine/cache';
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
