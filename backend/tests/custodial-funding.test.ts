// The custodial funding path a new account walks: an award lands on the
// ledger, the wallet reports the live balance, a deposit approves clearing and
// lets it pull the funds. Runs against the E2E fakes, whose ledger and clearing
// enforce the real allowance and domain rules, plus a recording actor where the
// exact calls are the point.

import { isNullish, toNullable } from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
	FAKE_LEDGER_FEE,
	fakeEngineActorProvider,
	fakeLedgerBalance,
	fundFakeAccount,
	VXP_LEDGER_CANISTER_ID
} from '../e2e/fake-engine';
import { createSession } from '../src/auth/sessions';
import { icAdapter } from '../src/chains/ic/adapter';
import { tickDepositWatchers } from '../src/chains/watchers';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import { query } from '../src/db/client';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider, type IcrcLedgerActor } from '../src/engine/actors';
import { clearCache } from '../src/engine/cache';
import { env } from '../src/env';
import { app } from '../src/index';
import { ZERO } from '../src/lib/constants';
import { userIcPrincipalText } from '../src/lib/keys';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const AWARD = BigInt(15_000_000);
const FULL_SWEEP = AWARD - FAKE_LEDGER_FEE * BigInt(2);

const VXP_CATALOG = [
	{
		metrics: [],
		config: {
			decimals: 4,
			asset: { Icrc: Principal.fromText(VXP_LEDGER_CANISTER_ID) },
			is_enabled: true,
			allowed_balance_domains: [{ ViciXp: null }],
			oracle_id: [],
			asset_id: 'VXP',
			symbol: 'VXP'
		}
	}
];

interface WalletBody {
	accounts: { chain: string; address: string }[];
	balances: { symbol: string; chain: string; balance: string }[];
}

let restore: (() => void) | undefined;
let nextOperation = 0;

const operationId = (): string => {
	nextOperation += 1;

	return `op-${process.pid}-${Date.now()}-${nextOperation}`;
};

afterEach(() => {
	restore?.();
	restore = undefined;
	clearCache();
});

const useFakes = (overrides: { ledger?: typeof fakeEngineActorProvider.ledger } = {}): void => {
	restore = setEngineActorProvider({ ...fakeEngineActorProvider, ...overrides });
};

const fundedUser = async (amount = AWARD): Promise<{ userId: string; owner: Principal }> => {
	const userId = await createTestUser();
	const owner = Principal.fromText(userIcPrincipalText(userId));

	fundFakeAccount({ owner, amount });

	return { userId, owner };
};

const authedRequest = async ({
	userId,
	path,
	body
}: {
	userId: string;
	path: string;
	body?: Record<string, unknown>;
}): Promise<Response> => {
	const token = await createSession(userId);

	return await app.handle(
		new Request(`http://localhost${path}`, {
			method: isNullish(body) ? 'GET' : 'POST',
			headers: { cookie: `vici_session=${token}`, 'content-type': 'application/json' },
			...(isNullish(body) ? {} : { body: JSON.stringify(body) })
		})
	);
};

const wallet = async (userId: string): Promise<WalletBody> => {
	const res = await authedRequest({ userId, path: '/api/v1/wallet/balances' });

	expect(res.status).toBe(200);

	return (await res.json()) as WalletBody;
};

const vxpOf = (body: WalletBody): string | undefined =>
	body.balances.find(({ symbol }) => symbol === 'VXP')?.balance;

const deposit = ({
	userId,
	depositId = operationId(),
	amount = FULL_SWEEP,
	assetId = 'VXP'
}: {
	userId: string;
	depositId?: string;
	amount?: bigint;
	assetId?: string;
}): Promise<Response> =>
	authedRequest({
		userId,
		path: '/api/v1/engine/collateral/deposit',
		body: { depositId, assetId, amount: amount.toString() }
	});

const freshIdentity = (): Identity => {
	const principal = Principal.fromText(userIcPrincipalText(crypto.randomUUID()));

	return { getPrincipal: () => principal } as Identity;
};

describe('fake clearing parity', () => {
	test('a deposit without a prior approve fails', async () => {
		const identity = freshIdentity();

		fundFakeAccount({ owner: identity.getPrincipal(), amount: AWARD });

		const clearing = await fakeEngineActorProvider.clearing(identity, true);

		expect(
			await clearing.deposit_collateral({
				deposit_id: operationId(),
				asset_id: 'VXP',
				amount: FULL_SWEEP,
				domain: toNullable({ ViciXp: null })
			})
		).toMatchObject({ Err: { Asset: { TransferError: expect.any(String) } } });
		expect(fakeLedgerBalance({ owner: identity.getPrincipal() })).toBe(AWARD);
	});

	test('a deposit without a domain lands on Settlement, which VXP does not allow', async () => {
		const identity = freshIdentity();
		const clearing = await fakeEngineActorProvider.clearing(identity, true);

		expect(
			await clearing.deposit_collateral({
				deposit_id: operationId(),
				asset_id: 'VXP',
				amount: FULL_SWEEP,
				domain: toNullable()
			})
		).toMatchObject({ Err: { DomainNotAllowed: { asset_id: 'VXP' } } });
	});
});

describe.if(dbAvailable)('GET /api/v1/wallet/balances', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('reports the on-chain figure with no ledger entries and provisions the account', async () => {
		useFakes();

		const { userId, owner } = await fundedUser();

		const body = await wallet(userId);

		expect(vxpOf(body)).toBe(AWARD.toString());
		expect(body.accounts).toEqual([{ chain: 'ic', address: owner.toText() }]);

		const entries = await query<{ count: string }>(
			`select count(*)::text as count from ledger_entries l
			 join custody_accounts c on c.id = l.account_id
			 where c.user_id = $1`,
			[userId]
		);

		expect(entries[0]?.count).toBe('0');
	});

	test('an invalid ledger id is reported once, not on every request', async () => {
		useFakes();

		const { userId } = await fundedUser();
		const symbol = `BAD${process.pid}${Date.now()}`;

		await query(
			`insert into assets (chain, symbol, decimals, ledger_ref, enabled)
			 values ('ic', $1, 8, 'mxz4u-wiaaa-aaaar-qaada-cai', true)`,
			[symbol]
		);

		const errors = spyOn(console, 'error');

		try {
			const first = await wallet(userId);
			const second = await wallet(userId);

			for (const { balances } of [first, second]) {
				expect(balances.map((row) => row.symbol)).toContain('VXP');
				expect(balances.map((row) => row.symbol)).not.toContain(symbol);
			}

			const reports = errors.mock.calls.filter((call) => String(call[1]).includes(symbol));

			expect(reports).toHaveLength(1);
		} finally {
			errors.mockRestore();
			await query(`delete from assets where symbol = $1`, [symbol]);
		}
	});

	test('reads the custodial principal on its default account', async () => {
		const owners: { owner: Principal; subaccount?: unknown }[] = [];

		useFakes({
			ledger: () =>
				Promise.resolve({
					balance: (params: { owner: Principal; subaccount?: unknown }) => {
						owners.push(params);

						return Promise.resolve(ZERO);
					}
				} as unknown as IcrcLedgerActor)
		});

		const userId = await createTestUser();

		await wallet(userId);

		expect(owners.length).toBeGreaterThan(0);

		for (const { owner, subaccount } of owners) {
			expect(owner.toText()).toBe(userIcPrincipalText(userId));
			expect(subaccount).toBeUndefined();
		}
	});

	test('an unreadable asset is left out and keeps the others', async () => {
		const icp = await getAssetBySymbol({ chain: 'ic', symbol: 'ICP' });

		useFakes({
			ledger: (identity, ledger) =>
				ledger === icp?.ledger_ref
					? Promise.reject(new Error('replica unreachable'))
					: fakeEngineActorProvider.ledger(identity, ledger)
		});

		const { userId } = await fundedUser();

		const body = await wallet(userId);

		expect(vxpOf(body)).toBe(AWARD.toString());
		expect(body.balances.map(({ symbol }) => symbol)).not.toContain('ICP');
	});

	test('other chains keep the internal ledger', async () => {
		useFakes();

		const userId = await createTestUser();
		const eth = await getAssetBySymbol({ chain: 'evm', symbol: 'ETH' });
		const account = await ensureUserAccount({ userId, chain: 'evm', address: `0x${userId}` });
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: 'evm',
			address: 'external'
		});

		await postLedgerEvent({
			eventKey: `test:wallet:${userId}`,
			kind: 'deposit',
			legs: [
				{ accountId: account.id, assetId: eth?.id ?? '', delta: '42' },
				{ accountId: external.id, assetId: eth?.id ?? '', delta: '-42' }
			]
		});

		const { balances } = await wallet(userId);

		expect(balances.find(({ symbol }) => symbol === 'ETH')?.balance).toBe('42');
	});
});

describe.if(dbAvailable)('ic deposit watcher', () => {
	let stopWatching: (() => void) | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	afterEach(() => {
		stopWatching?.();
		stopWatching = undefined;
	});

	/** Other suites leave accounts in this shared database whose addresses are
	 * not principals, and one of those fails a real pass. Only the address list
	 * is narrowed to the account under test; everything else is the real tick. */
	const tickFor = async (owner: Principal): Promise<string[]> => {
		const { watchDeposits } = icAdapter;
		const spy = spyOn(icAdapter, 'watchDeposits').mockImplementation(({ assets }) =>
			watchDeposits({ addresses: [owner.toText()], assets })
		);

		stopWatching = () => spy.mockRestore();

		await tickDepositWatchers();

		return spy.mock.calls.flatMap(([{ assets }]) => assets.map(({ symbol }) => symbol));
	};

	const provisionedUser = async (): Promise<{ userId: string; owner: Principal }> => {
		const user = await fundedUser();

		await ensureUserAccount({ userId: user.userId, chain: 'ic', address: user.owner.toText() });

		return user;
	};

	const depositsOf = (
		userId: string
	): Promise<{ symbol: string; amount: string; state: string }[]> =>
		query(
			`select a.symbol, d.amount::text as amount, d.state
			 from deposits d
			 join assets a on a.id = d.asset_id
			 join custody_accounts c on c.id = d.account_id
			 where c.user_id = $1`,
			[userId]
		);

	const ledgerEntriesOf = (userId: string): Promise<{ symbol: string; delta: string }[]> =>
		query(
			`select a.symbol, l.delta::text as delta
			 from ledger_entries l
			 join assets a on a.id = l.asset_id
			 join custody_accounts c on c.id = l.account_id
			 where c.user_id = $1`,
			[userId]
		);

	test('on-chain VXP is not read, not booked, and stays non-withdrawable', async () => {
		useFakes();

		const { userId, owner } = await provisionedUser();

		const watched = await tickFor(owner);

		expect(watched.length).toBeGreaterThan(0);
		expect(watched).not.toContain('VXP');
		expect(await depositsOf(userId)).toEqual([]);
		expect(await ledgerEntriesOf(userId)).toEqual([]);

		const vxp = await getAssetBySymbol({ chain: 'ic', symbol: 'VXP' });
		const res = await authedRequest({
			userId,
			path: '/api/v1/wallet/withdrawals',
			body: { assetId: vxp?.id, amount: '100', destination: owner.toText() }
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'insufficient_balance' });
		expect(await query(`select 1 from withdrawals where user_id = $1`, [userId])).toEqual([]);

		expect(vxpOf(await wallet(userId))).toBe(AWARD.toString());
	});

	test.each(['ckBTC', 'ckETH', 'ckUSDC', 'ICP'])(
		'a %s deposit is credited beside untouched VXP',
		async (symbol) => {
			useFakes();

			const { userId, owner } = await provisionedUser();
			const asset = await getAssetBySymbol({ chain: 'ic', symbol });
			const amount = BigInt(250_000);

			fundFakeAccount({ owner, amount, ledger: asset?.ledger_ref ?? '' });

			await tickFor(owner);

			expect(await depositsOf(userId)).toEqual([
				{ symbol, amount: amount.toString(), state: 'credited' }
			]);
			expect(await ledgerEntriesOf(userId)).toEqual([{ symbol, delta: amount.toString() }]);
		}
	);
});

describe.if(dbAvailable)('POST /api/v1/engine/collateral/deposit', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	describe('against the faithful fakes', () => {
		beforeEach(() => {
			useFakes();
		});

		test('a full sweep drains the wallet into clearing, fees included', async () => {
			const { userId, owner } = await fundedUser();

			const res = await deposit({ userId });

			expect(res.status).toBe(200);
			expect(fakeLedgerBalance({ owner })).toBe(ZERO);
			expect(vxpOf(await wallet(userId))).toBe('0');

			const account = await authedRequest({
				userId,
				path: '/api/v1/engine/account?domain=ViciXp'
			});
			const body = (await account.json()) as {
				account: { state: { balances: unknown[] }; available_margin_usd: string };
			};

			expect(body.account.state.balances).toEqual([
				[{ ViciXp: null }, [['VXP', FULL_SWEEP.toString()]]]
			]);
			expect(body.account.available_margin_usd).toBe(FULL_SWEEP.toString());
		});

		test('one fee short of the reserve fails cleanly and frees the id', async () => {
			const { userId, owner } = await fundedUser();
			const depositId = operationId();

			const res = await deposit({ userId, depositId, amount: AWARD - FAKE_LEDGER_FEE });

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'collateral_rejected' });
			expect(fakeLedgerBalance({ owner })).toBe(AWARD - FAKE_LEDGER_FEE);

			const retry = await deposit({
				userId,
				depositId,
				amount: AWARD - FAKE_LEDGER_FEE * BigInt(3)
			});

			expect(retry.status).toBe(200);
		});

		test('an account below one fee reports the shortfall', async () => {
			const { userId } = await fundedUser(FAKE_LEDGER_FEE - BigInt(1));

			const res = await deposit({ userId, amount: BigInt(1) });

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'insufficient_balance' });
		});

		test('replaying a finished id moves nothing and pays no second fee', async () => {
			const { userId, owner } = await fundedUser();
			const depositId = operationId();

			await deposit({ userId, depositId, amount: BigInt(1_000_000) });

			const left = fakeLedgerBalance({ owner });

			const replay = await deposit({ userId, depositId, amount: BigInt(1_000_000) });

			expect(replay.status).toBe(200);
			expect(fakeLedgerBalance({ owner })).toBe(left);
		});

		test('rejects an unknown asset and a zero amount before signing anything', async () => {
			const { userId, owner } = await fundedUser();

			const unknown = await deposit({ userId, assetId: 'NOPE' });

			expect(unknown.status).toBe(400);
			expect(await unknown.json()).toEqual({ error: 'unknown_asset' });

			const zero = await deposit({ userId, amount: ZERO });

			expect(zero.status).toBe(400);
			expect(await zero.json()).toEqual({ error: 'invalid_amount' });
			expect(fakeLedgerBalance({ owner })).toBe(AWARD);
		});
	});

	describe('recording the calls', () => {
		const stubbed = ({
			depositResult,
			calls
		}: {
			depositResult: () => Promise<unknown>;
			calls: Record<string, unknown>[];
		}): void => {
			restore = setEngineActorProvider({
				clearing: (identity) =>
					Promise.resolve({
						list_collateral_assets: () => Promise.resolve(VXP_CATALOG),
						deposit_collateral: (params: Record<string, unknown>) => {
							calls.push({
								call: 'deposit',
								caller: identity.getPrincipal().toText(),
								...params
							});

							return depositResult();
						}
					} as unknown as ClearingService),
				registry: () => Promise.resolve({} as unknown as RegistryService),
				ledger: (identity, ledgerCanisterId) =>
					Promise.resolve({
						transactionFee: () => Promise.resolve(FAKE_LEDGER_FEE),
						approve: (params: Record<string, unknown>) => {
							calls.push({
								call: 'approve',
								caller: identity.getPrincipal().toText(),
								ledgerCanisterId,
								...params
							});

							return Promise.resolve(BigInt(1));
						}
					} as unknown as IcrcLedgerActor)
			});
		};

		test('approves clearing for amount + fee from the custodial identity, then deposits', async () => {
			const calls: Record<string, unknown>[] = [];

			stubbed({ calls, depositResult: () => Promise.resolve({ Ok: null }) });

			const userId = await createTestUser();
			const depositId = operationId();
			const before = BigInt(Date.now()) * BigInt(1_000_000);

			const res = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(res.status).toBe(200);
			expect(calls.map(({ call }) => call)).toEqual(['approve', 'deposit']);

			const [approve, depositCall] = calls;

			expect(approve).toMatchObject({
				caller: userIcPrincipalText(userId),
				ledgerCanisterId: VXP_LEDGER_CANISTER_ID,
				amount: BigInt(700) + FAKE_LEDGER_FEE
			});
			expect(approve?.spender).toEqual({
				owner: Principal.fromText(env.ic.clearingCanisterId),
				subaccount: []
			});
			expect(approve?.expires_at).toBeGreaterThan(before);
			expect(depositCall).toEqual({
				call: 'deposit',
				caller: userIcPrincipalText(userId),
				deposit_id: depositId,
				asset_id: 'VXP',
				amount: BigInt(700),
				domain: [{ ViciXp: null }]
			});
		});

		test('a refused approve never reaches clearing', async () => {
			const calls: Record<string, unknown>[] = [];

			restore = setEngineActorProvider({
				clearing: () =>
					Promise.resolve({
						list_collateral_assets: () => Promise.resolve(VXP_CATALOG),
						deposit_collateral: () => {
							calls.push({ call: 'deposit' });

							return Promise.resolve({ Ok: null });
						}
					} as unknown as ClearingService),
				registry: () => Promise.resolve({} as unknown as RegistryService),
				ledger: () =>
					Promise.resolve({
						transactionFee: () => Promise.resolve(FAKE_LEDGER_FEE),
						approve: () =>
							Promise.reject(
								new IcrcTransferError({
									msg: 'approve',
									errorType: { TemporarilyUnavailable: null }
								})
							)
					} as unknown as IcrcLedgerActor)
			});

			const res = await deposit({ userId: await createTestUser(), amount: BigInt(700) });

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'collateral_rejected' });
			expect(calls).toEqual([]);
		});

		test('overlapping calls with one id reach clearing once', async () => {
			const calls: Record<string, unknown>[] = [];
			let finish: (value: unknown) => void = () => undefined;

			stubbed({
				calls,
				depositResult: () =>
					new Promise((resolve) => {
						finish = resolve;
					})
			});

			const userId = await createTestUser();
			const depositId = operationId();

			const first = deposit({ userId, depositId, amount: BigInt(700) });

			while (calls.filter(({ call }) => call === 'deposit').length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}

			const overlapping = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(overlapping.status).toBe(409);
			expect(await overlapping.json()).toEqual({ error: 'operation_in_progress' });

			finish({ Ok: null });

			expect((await first).status).toBe(200);
			expect(calls.filter(({ call }) => call === 'deposit')).toHaveLength(1);
		});

		test('an unknown outcome holds the id until the lease lapses, then skips the approve', async () => {
			const calls: Record<string, unknown>[] = [];
			let attempts = 0;

			stubbed({
				calls,
				depositResult: () => {
					attempts += 1;

					return attempts === 1
						? Promise.reject(new Error('ingress expired'))
						: Promise.resolve({ Ok: null });
				}
			});

			const userId = await createTestUser();
			const depositId = operationId();

			const lost = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(lost.status).toBe(500);

			const early = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(early.status).toBe(409);

			await query(
				`update collateral_operations set claimed_at = now() - interval '16 minutes'
				 where user_id = $1 and operation_id = $2`,
				[userId, depositId]
			);

			calls.length = 0;

			const resumed = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(resumed.status).toBe(200);
			expect(calls.map(({ call }) => call)).toEqual(['deposit']);
		});

		const flakyPreflight = ({
			catalogFails,
			feeFails,
			calls
		}: {
			catalogFails: boolean;
			feeFails: boolean;
			calls: string[];
		}): void => {
			let catalogDown = catalogFails;
			let feeDown = feeFails;

			restore = setEngineActorProvider({
				clearing: () =>
					Promise.resolve({
						list_collateral_assets: () => {
							if (catalogDown) {
								catalogDown = false;

								return Promise.reject(new Error('replica unreachable'));
							}

							return Promise.resolve(VXP_CATALOG);
						},
						deposit_collateral: () => {
							calls.push('deposit');

							return Promise.resolve({ Ok: null });
						}
					} as unknown as ClearingService),
				registry: () => Promise.resolve({} as unknown as RegistryService),
				ledger: () =>
					Promise.resolve({
						transactionFee: () => {
							if (feeDown) {
								feeDown = false;

								return Promise.reject(new Error('replica unreachable'));
							}

							return Promise.resolve(FAKE_LEDGER_FEE);
						},
						approve: () => {
							calls.push('approve');

							return Promise.resolve(BigInt(1));
						}
					} as unknown as IcrcLedgerActor)
			});
		};

		test.each([
			['catalog read', { catalogFails: true, feeFails: false }],
			['ledger fee read', { catalogFails: false, feeFails: true }]
		])('a failed %s signs nothing and can be retried at once', async (_label, failure) => {
			const calls: string[] = [];

			flakyPreflight({ ...failure, calls });

			const userId = await createTestUser();
			const depositId = operationId();

			const failed = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(failed.status).toBe(503);
			expect(await failed.json()).toEqual({ error: 'collateral_unavailable' });
			expect(calls).toEqual([]);

			const retry = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(retry.status).toBe(200);
			expect(calls).toEqual(['approve', 'deposit']);
		});

		test('an approve with an unknown outcome holds the id', async () => {
			const calls: Record<string, unknown>[] = [];

			restore = setEngineActorProvider({
				clearing: () =>
					Promise.resolve({
						list_collateral_assets: () => Promise.resolve(VXP_CATALOG),
						deposit_collateral: () => {
							calls.push({ call: 'deposit' });

							return Promise.resolve({ Ok: null });
						}
					} as unknown as ClearingService),
				registry: () => Promise.resolve({} as unknown as RegistryService),
				ledger: () =>
					Promise.resolve({
						transactionFee: () => Promise.resolve(FAKE_LEDGER_FEE),
						approve: () => Promise.reject(new Error('ingress expired'))
					} as unknown as IcrcLedgerActor)
			});

			const userId = await createTestUser();
			const depositId = operationId();

			const lost = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(lost.status).toBe(500);

			const early = await deposit({ userId, depositId, amount: BigInt(700) });

			expect(early.status).toBe(409);
			expect(await early.json()).toEqual({ error: 'operation_in_progress' });
			expect(calls).toEqual([]);
		});
	});
});

describe.if(dbAvailable)('POST /api/v1/engine/collateral/withdraw', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('names the asset domain and reports a refusal cleanly', async () => {
		const params: Record<string, unknown>[] = [];

		restore = setEngineActorProvider({
			clearing: () =>
				Promise.resolve({
					list_collateral_assets: () => Promise.resolve(VXP_CATALOG),
					withdraw_collateral: (next: Record<string, unknown>) => {
						params.push(next);

						return Promise.resolve({ Err: { MathOverflow: null } });
					}
				} as unknown as ClearingService),
			registry: () => Promise.resolve({} as unknown as RegistryService)
		});

		const res = await authedRequest({
			userId: await createTestUser(),
			path: '/api/v1/engine/collateral/withdraw',
			body: { withdrawalId: operationId(), assetId: 'VXP', amount: '700' }
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'collateral_rejected' });
		expect(params[0]?.domain).toEqual([{ ViciXp: null }]);
	});
});

describe.if(dbAvailable)('GET /api/v1/engine/account', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a domain scopes the figures, the bare route keeps the Settlement query', async () => {
		useFakes();

		const { userId } = await fundedUser();

		await deposit({ userId });

		const scoped = await authedRequest({ userId, path: '/api/v1/engine/account?domain=ViciXp' });
		const bare = await authedRequest({ userId, path: '/api/v1/engine/account' });

		expect(
			((await scoped.json()) as { account: { total_equity_usd: string } }).account.total_equity_usd
		).toBe(FULL_SWEEP.toString());
		expect(
			((await bare.json()) as { account: { total_equity_usd: string } }).account.total_equity_usd
		).toBe('0');
	});

	test.each(['Nope', 'toString'])('refuses the unknown domain %s', async (domain) => {
		useFakes();

		const res = await authedRequest({
			userId: await createTestUser(),
			path: `/api/v1/engine/account?domain=${domain}`
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid_domain' });
	});
});
