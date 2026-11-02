// The deposit watcher tick: bounded at 1,000 accounts, a failed read skipped and
// retried, cursors moved only past credited deposits, and every deposit booked
// exactly once. The ic tests run the real adapter over a fake ledger; the
// budget and scope tests use a scripted adapter, so what each read saw is exact.

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
	type Mock
} from 'bun:test';
import { randomBytes } from 'node:crypto';
import { fakeEngineActorProvider } from '../e2e/fake-engine';
import { watchBtcDeposits } from '../src/chains/btc/adapter';
import { watchEvmDeposits } from '../src/chains/evm/adapter';
import { icAdapter } from '../src/chains/ic/adapter';
import { getAdapter } from '../src/chains/registry';
import { watchSolDeposits } from '../src/chains/sol/adapter';
import type { ChainAdapter, DepositEvent } from '../src/chains/types';
import {
	DEFAULT_WATCH_LIMITS,
	tickDepositWatchers,
	type WatchLimits
} from '../src/chains/watchers';
import { getAssetBySymbol, listEnabledAssets, type Asset } from '../src/custody/assets';
import { requestWithdrawal, transitionWithdrawal } from '../src/custody/withdrawals';
import { query } from '../src/db/client';
import { readerLedger, setEngineActorProvider } from '../src/engine/actors';
import type { Chain } from '../src/lib/keys';
import { logger } from '../src/lib/logger';
import { jobs, tick } from '../src/worker';
import { ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const SWEEP_ALL: WatchLimits = { ...DEFAULT_WATCH_LIMITS, maxAccounts: 100_000 };
const SCRATCH_SYMBOL = `TST${process.pid}`;

interface Seeded {
	id: string;
	userId: string;
	address: string;
}

const seededAccountIds: string[] = [];
const seededUserIds: string[] = [];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const principalText = (): string => Principal.fromUint8Array(randomBytes(29)).toText();

const seedAccounts = async ({
	count,
	chain
}: {
	count: number;
	chain: Chain;
}): Promise<Seeded[]> => {
	const addresses = Array.from({ length: count }, principalText);
	const users = await query<{ id: string }>(
		`insert into users (role) select 'user' from generate_series(1, $1) returning id`,
		[count]
	);
	const userIds = users.map(({ id }) => id);
	const accounts = await query<{ id: string; user_id: string; address: string }>(
		`insert into custody_accounts (user_id, chain, address, kind)
		 select user_id, $1, address, 'user'
		 from unnest($2::uuid[], $3::text[]) as seed(user_id, address)
		 returning id, user_id, address`,
		[chain, userIds, addresses]
	);

	seededAccountIds.push(...accounts.map(({ id }) => id));
	seededUserIds.push(...userIds);

	return accounts.map(({ id, user_id, address }) => ({ id, userId: user_id, address }));
};

const seedAccount = async (chain: Chain): Promise<Seeded> => {
	const [account] = await seedAccounts({ count: 1, chain });

	if (isNullish(account)) {
		throw new Error('seed returned no account');
	}

	return account;
};

const requireAsset = async ({
	chain,
	symbol
}: {
	chain: Chain;
	symbol: string;
}): Promise<Asset> => {
	const asset = await getAssetBySymbol({ chain, symbol });

	if (isNullish(asset)) {
		throw new Error(`${chain} ${symbol} missing from seed`);
	}

	return asset;
};

const bookedBalance = async ({
	account,
	asset
}: {
	account: Seeded;
	asset: Asset;
}): Promise<bigint> => {
	const rows = await query<{ balance: string }>(
		`select coalesce(sum(delta), 0)::text as balance
		 from ledger_entries where account_id = $1 and asset_id = $2`,
		[account.id, asset.id]
	);

	return BigInt(rows[0]?.balance ?? '0');
};

const depositCount = async ({
	account,
	asset
}: {
	account: Seeded;
	asset: Asset;
}): Promise<number> => {
	const rows = await query<{ count: string }>(
		`select count(*)::text as count from deposits where account_id = $1 and asset_id = $2`,
		[account.id, asset.id]
	);

	return Number(rows[0]?.count ?? '0');
};

const cursorOf = async (key: string): Promise<string | undefined> => {
	const rows = await query<{ cursor: string }>(
		`select cursor from chain_cursors where chain = $1`,
		[key]
	);

	return rows[0]?.cursor;
};

const resetCursors = (): Promise<unknown> =>
	query(
		`delete from chain_cursors where chain like 'watch:%' or chain = 'evm' or chain like 'sol:%'`
	);

let restoreProvider: (() => void) | undefined;

/** The ic adapter over a ledger whose balances the test scripts. */
const useLedger = (
	balance: (read: { ledgerId: string; owner: string }) => Promise<bigint> | bigint,
	build?: (ledgerId: string) => void
): void => {
	restoreProvider?.();
	restoreProvider = setEngineActorProvider({
		...fakeEngineActorProvider,
		ledger: async (identity, ledgerId) => {
			build?.(ledgerId);

			return {
				...(await fakeEngineActorProvider.ledger(identity, ledgerId)),
				balance: async ({ owner }) => await balance({ ledgerId, owner: owner.toText() })
			};
		}
	});
};

/** A chain adapter that only implements what the watcher calls. */
const scriptedAdapter = ({
	chain,
	watchScope,
	watchDeposits
}: {
	chain: Chain;
	watchScope: ChainAdapter['watchScope'];
	watchDeposits: ChainAdapter['watchDeposits'];
}): ChainAdapter => ({
	chain,
	enabled: true,
	watchScope,
	deriveAddress: () => '',
	getBalance: () => Promise.reject(new Error('unused')),
	transfer: () => Promise.reject(new Error('unused')),
	watchDeposits
});

const txEvent = ({
	address,
	asset,
	amount
}: {
	address: string;
	asset: Asset;
	amount: bigint;
}): DepositEvent => ({
	kind: 'tx',
	txRef: `tx-${randomBytes(8).toString('hex')}`,
	address,
	amount,
	asset,
	confirmations: 12
});

const rpcResponse = (result: unknown): Response =>
	new Response(JSON.stringify({ result }), { status: 200 });

describe('watch scope', () => {
	test('only the block-cursor chain is handed every address', () => {
		expect(getAdapter('evm').watchScope).toBe('chain');
		expect(getAdapter('ic').watchScope).toBe('address');
		expect(getAdapter('sol').watchScope).toBe('address');
		expect(getAdapter('btc').watchScope).toBe('address');
	});
});

describe('reader ledger reuse', () => {
	afterEach(() => {
		restoreProvider?.();
		restoreProvider = undefined;
	});

	test('one actor per ledger, however many reads', async () => {
		const builds: string[] = [];

		useLedger(
			() => BigInt(0),
			(ledgerId) => builds.push(ledgerId)
		);

		await Promise.all([readerLedger('a'), readerLedger('a'), readerLedger('b')]);
		await readerLedger('a');

		expect(builds.sort()).toEqual(['a', 'b']);
	});

	test('a failed build is not remembered', async () => {
		let attempts = 0;

		useLedger(
			() => BigInt(0),
			() => {
				attempts += 1;

				if (attempts === 1) {
					throw new Error('ledger unavailable');
				}
			}
		);

		await expect(readerLedger('a')).rejects.toThrow('ledger unavailable');

		await sleep(0);
		await readerLedger('a');

		expect(attempts).toBe(2);
	});

	test('swapping the provider drops the actors built by the last one', async () => {
		const builds: string[] = [];

		useLedger(
			() => BigInt(0),
			(ledgerId) => builds.push(ledgerId)
		);
		await readerLedger('a');
		useLedger(
			() => BigInt(0),
			(ledgerId) => builds.push(ledgerId)
		);
		await readerLedger('a');

		expect(builds).toEqual(['a', 'a']);
	});
});

describe.if(dbAvailable)('deposit watcher tick', () => {
	let icp: Asset;
	let ckUsdc: Asset;
	let btc: Asset;
	let eth: Asset;
	let errors: Mock<typeof logger.error>;
	let warnings: Mock<typeof logger.warn>;

	beforeAll(async () => {
		await ensureMigrated();

		icp = await requireAsset({ chain: 'ic', symbol: 'ICP' });
		ckUsdc = await requireAsset({ chain: 'ic', symbol: 'ckUSDC' });
		btc = await requireAsset({ chain: 'btc', symbol: 'BTC' });
		eth = await requireAsset({ chain: 'evm', symbol: 'ETH' });

		await query(
			`insert into assets (chain, symbol, decimals, ledger_ref, enabled)
			 values ('btc', $1, 8, null, false)`,
			[SCRATCH_SYMBOL]
		);
	});

	beforeEach(async () => {
		// Other suites leave accounts whose addresses are not principals, and
		// each of those is a failed read here.
		errors = spyOn(logger, 'error').mockImplementation(() => undefined);
		warnings = spyOn(logger, 'warn').mockImplementation(() => undefined);

		await resetCursors();
		await query(`update assets set enabled = true where id = any($1::uuid[])`, [[btc.id, eth.id]]);
	});

	afterEach(() => {
		errors.mockRestore();
		warnings.mockRestore();
		restoreProvider?.();
		restoreProvider = undefined;
	});

	afterAll(async () => {
		await resetCursors();
		await query(`update assets set enabled = false where id = any($1::uuid[])`, [[btc.id, eth.id]]);
		await query(`delete from assets where symbol = $1`, [SCRATCH_SYMBOL]);
		await query(
			`delete from ledger_entries where event_key in (
				select event_key from ledger_entries where account_id = any($1::uuid[]))`,
			[seededAccountIds]
		);
		await query(`delete from deposits where account_id = any($1::uuid[])`, [seededAccountIds]);
		await query(`delete from withdrawals where user_id = any($1::uuid[])`, [seededUserIds]);
		await query(`delete from custody_accounts where id = any($1::uuid[])`, [seededAccountIds]);
		await query(`delete from users where id = any($1::uuid[])`, [seededUserIds]);
	});

	describe('at 1,000 accounts', () => {
		test('each tick stays inside its limits and a sweep books everything once', async () => {
			const accounts = await seedAccounts({ count: 1000, chain: 'ic' });
			const addresses = new Set(accounts.map(({ address }) => address));
			const icpLedger = icp.ledger_ref;
			const icpReads = new Map<string, number>();
			let reads = 0;
			let inFlight = 0;
			let peakInFlight = 0;

			useLedger(async ({ ledgerId, owner }) => {
				reads += 1;
				inFlight += 1;
				peakInFlight = Math.max(peakInFlight, inFlight);
				await sleep(1);
				inFlight -= 1;

				if (ledgerId !== icpLedger || !addresses.has(owner)) {
					return BigInt(0);
				}

				icpReads.set(owner, (icpReads.get(owner) ?? 0) + 1);

				return BigInt(500);
			});

			const assetCount = (await listEnabledAssets()).filter(({ chain }) => chain === 'ic').length;
			const totals = await query<{ count: string }>(
				`select count(*)::text as count from custody_accounts
				 where chain = 'ic' and kind = 'user'`
			);
			const ticksPerSweep = Math.ceil(Number(totals[0]?.count) / DEFAULT_WATCH_LIMITS.maxAccounts);

			for (let index = 0; index < ticksPerSweep; index++) {
				reads = 0;

				await tickDepositWatchers({ adapters: [icAdapter] });

				expect(reads).toBeLessThanOrEqual(DEFAULT_WATCH_LIMITS.maxAccounts * assetCount);
			}

			expect(peakInFlight).toBeLessThanOrEqual(DEFAULT_WATCH_LIMITS.concurrency);
			expect(icpReads.size).toBe(1000);
			expect([...icpReads.values()].every((count) => count === 1)).toBe(true);

			// A second sweep over the same balances books nothing new.
			for (let index = 0; index < ticksPerSweep; index++) {
				await tickDepositWatchers({ adapters: [icAdapter] });
			}

			const booked = await query<{ deposits: string; credited: string }>(
				`select count(*)::text as deposits, coalesce(sum(amount), 0)::text as credited
				 from deposits where account_id = any($1::uuid[]) and asset_id = $2`,
				[accounts.map(({ id }) => id), icp.id]
			);

			expect(booked[0]?.deposits).toBe('1000');
			expect(booked[0]?.credited).toBe('500000');
		}, 60_000);
	});

	describe('a failed read', () => {
		test('is skipped, the others proceed, and a later sweep books it once', async () => {
			const [broken, healthy, alsoHealthy] = await seedAccounts({ count: 3, chain: 'ic' });

			if (isNullish(broken) || isNullish(healthy) || isNullish(alsoHealthy)) {
				throw new Error('seed returned too few accounts');
			}

			let readable = false;

			useLedger(({ ledgerId, owner }) => {
				if (owner === broken.address && !readable) {
					throw new Error('replica unavailable');
				}

				return ledgerId === icp.ledger_ref ? BigInt(700) : BigInt(0);
			});

			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account: broken, asset: icp })).toBe(BigInt(0));
			expect(await bookedBalance({ account: healthy, asset: icp })).toBe(BigInt(700));
			expect(await bookedBalance({ account: alsoHealthy, asset: icp })).toBe(BigInt(700));
			expect(errors.mock.calls.some(([line]) => String(line).includes('read(s) failed'))).toBe(
				true
			);

			readable = true;
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account: broken, asset: icp })).toBe(BigInt(700));
			expect(await depositCount({ account: broken, asset: icp })).toBe(1);
			expect(await depositCount({ account: healthy, asset: icp })).toBe(1);
		});

		test('an unavailable ledger costs its own asset only, in one log line', async () => {
			const account = await seedAccount('ic');
			let down = true;

			useLedger(
				({ ledgerId, owner }) => {
					if (owner !== account.address) {
						return BigInt(0);
					}

					return ledgerId === ckUsdc.ledger_ref ? BigInt(900) : BigInt(250);
				},
				(ledgerId) => {
					if (down && ledgerId === icp.ledger_ref) {
						throw new Error('ledger unavailable');
					}
				}
			);

			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: ckUsdc })).toBe(BigInt(900));
			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(0));
			expect(
				errors.mock.calls.filter(([line]) => String(line).includes(' ICP read(s) failed'))
			).toHaveLength(1);

			down = false;
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(250));
		});

		test('a read that never answers times out and costs only itself', async () => {
			const account = await seedAccount('ic');

			useLedger(({ ledgerId, owner }) => {
				if (ledgerId === icp.ledger_ref) {
					return new Promise<bigint>(() => undefined);
				}

				return owner === account.address && ledgerId === ckUsdc.ledger_ref
					? BigInt(300)
					: BigInt(0);
			});

			await tickDepositWatchers({
				adapters: [icAdapter],
				limits: { ...SWEEP_ALL, readTimeout_ms: 20 }
			});

			expect(await bookedBalance({ account, asset: ckUsdc })).toBe(BigInt(300));
			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(0));
		});

		test('a ledger that stops answering gets no more reads this tick', async () => {
			const accounts = await seedAccounts({ count: 20, chain: 'ic' });
			let hungReads = 0;
			let otherReads = 0;

			useLedger(({ ledgerId }) => {
				if (ledgerId === icp.ledger_ref) {
					hungReads += 1;

					return new Promise<bigint>(() => undefined);
				}

				otherReads += 1;

				return BigInt(0);
			});

			await tickDepositWatchers({
				adapters: [icAdapter],
				limits: { ...SWEEP_ALL, concurrency: 2, readTimeout_ms: 20 }
			});

			expect(hungReads).toBeLessThanOrEqual(2);
			expect(otherReads).toBeGreaterThanOrEqual(accounts.length);
		});
	});

	describe('the budget', () => {
		test('slow reads cannot hold the tick past budget plus one read timeout', async () => {
			const accounts = await seedAccounts({ count: 200, chain: 'btc' });
			const seen = new Set<string>();
			const slow = scriptedAdapter({
				chain: 'btc',
				watchScope: 'address',
				watchDeposits: async ({ addresses }) => {
					addresses.forEach((address) => seen.add(address));
					await sleep(10);

					return { events: [] };
				}
			});
			const limits: WatchLimits = {
				maxAccounts: 200,
				concurrency: 4,
				readTimeout_ms: 20,
				budget_ms: 60
			};
			const startedAt_ms = Date.now();

			await tickDepositWatchers({ adapters: [slow], limits });

			// Generous on the slack: this bounds the mechanism, not the runner.
			expect(Date.now() - startedAt_ms).toBeLessThan(
				limits.budget_ms + limits.readTimeout_ms + 1_000
			);
			expect(seen.size).toBeGreaterThan(0);
			expect(seen.size).toBeLessThan(accounts.length);

			const resumed = new Set<string>();
			const healthy = scriptedAdapter({
				chain: 'btc',
				watchScope: 'address',
				watchDeposits: ({ addresses }) => {
					addresses.forEach((address) => resumed.add(address));

					return Promise.resolve({ events: [] });
				}
			});

			await tickDepositWatchers({
				adapters: [healthy],
				limits: { ...limits, budget_ms: 30_000 }
			});

			// The next tick carries on exactly where the budget stopped it.
			expect(resumed.size).toBe(accounts.length - seen.size);
			expect([...resumed].some((address) => seen.has(address))).toBe(false);
		});

		test('an account cut off between assets is read again in full', async () => {
			await seedAccounts({ count: 2, chain: 'btc' });
			await query(`update assets set enabled = true where symbol = $1`, [SCRATCH_SYMBOL]);

			const limits: WatchLimits = { ...DEFAULT_WATCH_LIMITS, maxAccounts: 2, concurrency: 1 };
			const reads: { address: string; symbol: string }[] = [];
			const clock = spyOn(Date, 'now');
			const adapter = scriptedAdapter({
				chain: 'btc',
				watchScope: 'address',
				watchDeposits: ({ addresses, assets }) => {
					reads.push({ address: addresses[0] ?? '', symbol: assets[0]?.symbol ?? '' });

					if (reads.length === 3) {
						clock.mockReturnValue(Number.MAX_SAFE_INTEGER);
					}

					return Promise.resolve({ events: [] });
				}
			});

			try {
				await tickDepositWatchers({ adapters: [adapter], limits });
				clock.mockRestore();

				expect(reads).toHaveLength(3);

				const [first, , cutOff] = reads;

				expect(cutOff?.address).not.toBe(first?.address);

				reads.length = 0;
				await tickDepositWatchers({ adapters: [adapter], limits });

				expect(reads.slice(0, 2).map(({ address }) => address)).toEqual([
					cutOff?.address ?? '',
					cutOff?.address ?? ''
				]);
				expect(new Set(reads.slice(0, 2).map(({ symbol }) => symbol)).size).toBe(2);
			} finally {
				clock.mockRestore();
				await query(`update assets set enabled = false where symbol = $1`, [SCRATCH_SYMBOL]);
			}
		});

		test('reconciliation runs in the same worker tick as a hung scan', async () => {
			const watcherJob = jobs.find(({ name }) => name === 'deposit-watchers');
			const reconcileJob = jobs.find(({ name }) => name === 'vxp-award-reconciliation');

			if (isNullish(watcherJob) || isNullish(reconcileJob)) {
				throw new Error('worker registry lost a job');
			}

			await seedAccounts({ count: 50, chain: 'ic' });
			useLedger(() => new Promise<bigint>(() => undefined));

			const realWatcher = watcherJob.run;
			const realReconcile = reconcileJob.run;
			let reconciled = 0;

			watcherJob.run = () =>
				tickDepositWatchers({
					adapters: [icAdapter],
					limits: { maxAccounts: 50, concurrency: 4, readTimeout_ms: 10, budget_ms: 30 }
				});

			reconcileJob.run = () => {
				reconciled += 1;

				return Promise.resolve();
			};

			try {
				await tick();

				expect(reconciled).toBe(1);
			} finally {
				watcherJob.run = realWatcher;
				reconcileJob.run = realReconcile;
			}
		});
	});

	describe('idempotency', () => {
		test('an unchanged balance books once, an increase books the difference', async () => {
			const account = await seedAccount('ic');
			let balance = BigInt(100);

			useLedger(({ ledgerId, owner }) =>
				ledgerId === icp.ledger_ref && owner === account.address ? balance : BigInt(0)
			);

			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(100));
			expect(await depositCount({ account, asset: icp })).toBe(1);

			balance = BigInt(150);
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(150));
			expect(await depositCount({ account, asset: icp })).toBe(2);
		});

		test('two overlapping ticks book one deposit', async () => {
			const account = await seedAccount('ic');

			useLedger(({ ledgerId, owner }) =>
				ledgerId === icp.ledger_ref && owner === account.address ? BigInt(420) : BigInt(0)
			);

			await Promise.all([
				tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL }),
				tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL })
			]);

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(420));
			expect(await depositCount({ account, asset: icp })).toBe(1);
		});

		test('two overlapping ticks that saw different balances never book the sum', async () => {
			const account = await seedAccount('ic');
			let observed = 0;

			useLedger(({ ledgerId, owner }) => {
				if (ledgerId !== icp.ledger_ref || owner !== account.address) {
					return BigInt(0);
				}

				observed += 1;

				return observed === 1 ? BigInt(100) : BigInt(150);
			});

			await Promise.all([
				tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL }),
				tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL })
			]);
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(150));
		});

		test('a deposit back to a balance already held is credited, once', async () => {
			const account = await seedAccount('ic');
			let balance = BigInt(1000);

			useLedger(({ ledgerId, owner }) =>
				ledgerId === icp.ledger_ref && owner === account.address ? balance : BigInt(0)
			);

			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(1000));

			const withdrawal = await requestWithdrawal({
				userId: account.userId,
				asset: icp,
				amount: BigInt(1000),
				destination: principalText(),
				selfCustody: true,
				userAddress: account.address
			});

			await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'processing' });
			await transitionWithdrawal({ id: withdrawal.id, from: 'processing', to: 'submitted' });
			await transitionWithdrawal({ id: withdrawal.id, from: 'submitted', to: 'confirmed' });

			balance = BigInt(0);
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(0));

			balance = BigInt(1000);
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(1000));
			expect(await depositCount({ account, asset: icp })).toBe(2);

			// Replayed ticks over the same state book nothing further.
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(1000));
			expect(await depositCount({ account, asset: icp })).toBe(2);
		});

		test('a replayed tx event books once, also when two ticks race on it', async () => {
			const account = await seedAccount('evm');
			const event = txEvent({ address: account.address, asset: eth, amount: BigInt(33) });
			const adapter = scriptedAdapter({
				chain: 'evm',
				watchScope: 'chain',
				watchDeposits: () => Promise.resolve({ events: [event] })
			});

			await Promise.all([
				tickDepositWatchers({ adapters: [adapter] }),
				tickDepositWatchers({ adapters: [adapter] })
			]);
			await tickDepositWatchers({ adapters: [adapter] });

			expect(await bookedBalance({ account, asset: eth })).toBe(BigInt(33));
			expect(await depositCount({ account, asset: eth })).toBe(1);
		});

		test('funds held by an in-flight withdrawal are not credited again', async () => {
			const account = await seedAccount('ic');

			useLedger(({ ledgerId, owner }) =>
				ledgerId === icp.ledger_ref && owner === account.address ? BigInt(1000) : BigInt(0)
			);

			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			await requestWithdrawal({
				userId: account.userId,
				asset: icp,
				amount: BigInt(400),
				destination: principalText(),
				selfCustody: true,
				userAddress: account.address
			});

			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });
			await tickDepositWatchers({ adapters: [icAdapter], limits: SWEEP_ALL });

			expect(await bookedBalance({ account, asset: icp })).toBe(BigInt(600));
			expect(await depositCount({ account, asset: icp })).toBe(1);
		});
	});

	describe('a chain scope adapter', () => {
		test('sees every address every tick, whatever the page size', async () => {
			const accounts = await seedAccounts({ count: 5, chain: 'evm' });
			const handed: string[][] = [];
			const adapter = scriptedAdapter({
				chain: 'evm',
				watchScope: 'chain',
				watchDeposits: ({ addresses }) => {
					handed.push(addresses);

					return Promise.resolve({ events: [] });
				}
			});
			const limits: WatchLimits = { ...DEFAULT_WATCH_LIMITS, maxAccounts: 1 };

			await tickDepositWatchers({ adapters: [adapter], limits });
			await tickDepositWatchers({ adapters: [adapter], limits });

			expect(handed).toHaveLength(2);

			for (const addresses of handed) {
				expect(addresses).toEqual(expect.arrayContaining(accounts.map(({ address }) => address)));
			}
		});

		test('a failed credit holds the commit, the retry books only what is missing', async () => {
			const [paid, poisoned] = await seedAccounts({ count: 2, chain: 'evm' });

			if (isNullish(paid) || isNullish(poisoned)) {
				throw new Error('seed returned too few accounts');
			}

			const good = txEvent({ address: paid.address, asset: eth, amount: BigInt(10) });
			// deposits.amount has a positive check, so this credit fails in Postgres.
			const bad = txEvent({ address: poisoned.address, asset: eth, amount: BigInt(0) });
			let events: DepositEvent[] = [bad, good];
			let commits = 0;
			const adapter = scriptedAdapter({
				chain: 'evm',
				watchScope: 'chain',
				watchDeposits: () =>
					Promise.resolve({
						events,
						commit: () => {
							commits += 1;

							return Promise.resolve();
						}
					})
			});

			await tickDepositWatchers({ adapters: [adapter] });

			expect(commits).toBe(0);
			expect(await bookedBalance({ account: paid, asset: eth })).toBe(BigInt(10));

			events = [{ ...bad, amount: BigInt(20) }, good];
			await tickDepositWatchers({ adapters: [adapter] });

			expect(commits).toBe(1);
			expect(await bookedBalance({ account: paid, asset: eth })).toBe(BigInt(10));
			expect(await bookedBalance({ account: poisoned, asset: eth })).toBe(BigInt(20));
			expect(await depositCount({ account: paid, asset: eth })).toBe(1);
		});

		test('a pass past its budget commits nothing', async () => {
			await seedAccount('evm');

			let commits = 0;
			const adapter = scriptedAdapter({
				chain: 'evm',
				watchScope: 'chain',
				watchDeposits: async () => {
					await sleep(100);

					return {
						events: [],
						commit: () => {
							commits += 1;

							return Promise.resolve();
						}
					};
				}
			});

			await tickDepositWatchers({
				adapters: [adapter],
				limits: { ...DEFAULT_WATCH_LIMITS, budget_ms: 10 }
			});
			await sleep(150);

			expect(commits).toBe(0);
		});
	});

	describe('adapter cursors', () => {
		const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';

		test('evm: the block cursor moves on commit, not on observing', async () => {
			await query(`insert into chain_cursors (chain, cursor) values ('evm', '86')`);

			const rpc = spyOn(globalThis, 'fetch').mockImplementation(((
				_url: unknown,
				init?: RequestInit
			) => {
				const { method, params } = JSON.parse(String(init?.body)) as {
					method: string;
					params: string[];
				};

				return Promise.resolve(
					rpcResponse(
						method === 'eth_blockNumber'
							? '0x64'
							: {
									number: params[0],
									transactions: [{ hash: `tx-${params[0]}`, to: address, value: '0x10' }]
								}
					)
				);
			}) as unknown as typeof fetch);

			try {
				const first = await watchEvmDeposits({ addresses: [address], assets: [eth] });

				expect(first.events).toHaveLength(2);
				expect(await cursorOf('evm')).toBe('86');

				// Uncommitted, so a crash before crediting sees the same blocks again.
				const replay = await watchEvmDeposits({ addresses: [address], assets: [eth] });

				expect(replay.events.map(({ txRef }) => txRef)).toEqual(
					first.events.map(({ txRef }) => txRef)
				);

				await first.commit?.();

				expect(await cursorOf('evm')).toBe('88');
				expect((await watchEvmDeposits({ addresses: [address], assets: [eth] })).events).toEqual(
					[]
				);
			} finally {
				rpc.mockRestore();
			}
		});

		test('sol: the address cursor moves on commit, and a failed pass moves nothing', async () => {
			const sol = await requireAsset({ chain: 'sol', symbol: 'SOL' });
			const solAddress = `Sol${randomBytes(8).toString('hex')}`;
			let failTransactions = true;
			const rpc = spyOn(globalThis, 'fetch').mockImplementation(((
				_url: unknown,
				init?: RequestInit
			) => {
				const { method } = JSON.parse(String(init?.body)) as { method: string };

				if (method === 'getSignaturesForAddress') {
					return Promise.resolve(
						rpcResponse([
							{ signature: 'newest', err: null },
							{ signature: 'oldest', err: null }
						])
					);
				}

				if (failTransactions) {
					return Promise.resolve(new Response('', { status: 503 }));
				}

				return Promise.resolve(
					rpcResponse({
						meta: { preBalances: [0], postBalances: [5] },
						transaction: { message: { accountKeys: [{ pubkey: solAddress }] } }
					})
				);
			}) as unknown as typeof fetch);

			try {
				await expect(watchSolDeposits({ addresses: [solAddress], assets: [sol] })).rejects.toThrow(
					'http 503'
				);

				expect(await cursorOf(`sol:${solAddress}`)).toBeUndefined();

				failTransactions = false;

				const pass = await watchSolDeposits({ addresses: [solAddress], assets: [sol] });

				expect(pass.events.map(({ txRef }) => txRef)).toEqual(['oldest', 'newest']);
				expect(await cursorOf(`sol:${solAddress}`)).toBeUndefined();

				await pass.commit?.();

				expect(await cursorOf(`sol:${solAddress}`)).toBe('newest');
			} finally {
				rpc.mockRestore();
			}
		});

		test('sol: a backlog longer than a page is read to the end', async () => {
			const sol = await requireAsset({ chain: 'sol', symbol: 'SOL' });
			const solAddress = `Sol${randomBytes(8).toString('hex')}`;
			const history = Array.from({ length: 60 }, (_, index) => `sig-${index}`);
			const rpc = spyOn(globalThis, 'fetch').mockImplementation(((
				_url: unknown,
				init?: RequestInit
			) => {
				const { method, params } = JSON.parse(String(init?.body)) as {
					method: string;
					params: [string, { before?: string }];
				};

				if (method === 'getSignaturesForAddress') {
					const [, { before }] = params;
					const start = isNullish(before) ? 0 : history.indexOf(before) + 1;

					return Promise.resolve(
						rpcResponse(
							history.slice(start, start + 25).map((signature) => ({ signature, err: null }))
						)
					);
				}

				return Promise.resolve(
					rpcResponse({
						meta: { preBalances: [0], postBalances: [5] },
						transaction: { message: { accountKeys: [{ pubkey: solAddress }] } }
					})
				);
			}) as unknown as typeof fetch);

			try {
				const pass = await watchSolDeposits({ addresses: [solAddress], assets: [sol] });

				expect(pass.events.map(({ txRef }) => txRef)).toEqual([...history].reverse());

				await pass.commit?.();

				expect(await cursorOf(`sol:${solAddress}`)).toBe('sig-0');
			} finally {
				rpc.mockRestore();
			}
		});

		test('btc: an output past the first page of history is still seen', async () => {
			const btc = await requireAsset({ chain: 'btc', symbol: 'BTC' });
			const btcAddress = `bc1${randomBytes(8).toString('hex')}`;
			const history = Array.from({ length: 30 }, (_, index) => `tx-${index}`);
			const rpc = spyOn(globalThis, 'fetch').mockImplementation(((url: unknown) => {
				const path = String(url);

				if (path.endsWith('/blocks/tip/height')) {
					return Promise.resolve(new Response('1000'));
				}

				const [, after] = path.match(/\/txs\/chain\/(.+)$/) ?? [];
				const start = isNullish(after) ? 0 : history.indexOf(after) + 1;

				return Promise.resolve(
					Response.json(
						history.slice(start, start + 25).map((txid) => ({
							txid,
							status: { confirmed: true, block_height: 100 },
							vout: [{ scriptpubkey_address: btcAddress, value: 7 }]
						}))
					)
				);
			}) as unknown as typeof fetch);

			try {
				const { events } = await watchBtcDeposits({ addresses: [btcAddress], assets: [btc] });

				expect(events.map(({ txRef }) => txRef)).toEqual(history);
			} finally {
				rpc.mockRestore();
			}
		});
	});
});
