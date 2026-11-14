// Withdrawal state machine: the transition matrix, the balance hold of the
// amount plus the network fee at request time, insufficient-balance rejection,
// the VXP refusal, the compensating refund on failure, the
// concurrent-transition race guard, and the idempotency key that turns a
// retried request into the withdrawal it already filed.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, isWithdrawable, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import {
	AssetNotWithdrawableError,
	canTransition,
	IdempotencyKeyReusedError,
	InsufficientBalanceError,
	requestWithdrawal,
	transitionWithdrawal,
	userChainBalance,
	WITHDRAWAL_TRANSITIONS,
	type Withdrawal,
	type WithdrawalState
} from '../src/custody/withdrawals';
import { query, tx } from '../src/db/client';
import { ZERO } from '../src/lib/constants';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe('withdrawable assets', () => {
	test('VXP is rejected whatever the symbol casing', () => {
		expect(isWithdrawable({ chain: 'ic', symbol: 'VXP' })).toBeFalse();
		expect(isWithdrawable({ chain: 'ic', symbol: 'vxp' })).toBeFalse();
		expect(isWithdrawable({ chain: 'ic', symbol: 'ICP' })).toBeTrue();
	});
});

describe('withdrawal transition matrix', () => {
	const cases: [WithdrawalState, WithdrawalState, boolean][] = [
		['requested', 'processing', true],
		['requested', 'rejected', true],
		['requested', 'submitted', false],
		['requested', 'confirmed', false],
		['processing', 'submitted', true],
		['processing', 'failed', true],
		['processing', 'confirmed', false],
		['submitted', 'confirmed', true],
		['submitted', 'failed', true],
		['submitted', 'requested', false],
		['confirmed', 'failed', false],
		['failed', 'requested', false],
		['rejected', 'processing', false]
	];

	test.each(cases)('%s -> %s allowed=%p', (from, to, allowed) => {
		expect(canTransition({ from, to })).toBe(allowed);
	});

	test('terminal states allow no exits', () => {
		expect(WITHDRAWAL_TRANSITIONS.confirmed).toHaveLength(0);
		expect(WITHDRAWAL_TRANSITIONS.failed).toHaveLength(0);
		expect(WITHDRAWAL_TRANSITIONS.rejected).toHaveLength(0);
	});
});

describe.if(dbAvailable)('withdrawal lifecycle', () => {
	let asset: Asset;

	const fundedUser = async (amount: bigint, fundedAsset: Asset = asset): Promise<string> => {
		const userId = await createTestUser();
		const account = await ensureUserAccount({ userId, chain: 'ic', address: `p-${userId}` });
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: 'ic',
			address: 'external'
		});

		await postLedgerEvent({
			eventKey: `test:fund:${userId}`,
			kind: 'deposit',
			legs: [
				{ accountId: account.id, assetId: fundedAsset.id, delta: amount.toString() },
				{ accountId: external.id, assetId: fundedAsset.id, delta: (-amount).toString() }
			]
		});

		return userId;
	};

	const balanceOf = (userId: string): Promise<bigint> =>
		tx((q) => userChainBalance({ q, userId, asset }));

	/** The legs one ledger event posted, by the kind of account they hit. */
	const legsOf = (eventKey: string): Promise<{ kind: string; delta: string }[]> =>
		query(
			`select c.kind, l.delta::text as delta
			 from ledger_entries l
			 join custody_accounts c on c.id = l.account_id
			 where l.event_key = $1
			 order by l.idempotency_key`,
			[eventKey]
		);

	beforeAll(async () => {
		await ensureMigrated();

		const icp = await getAssetBySymbol({ chain: 'ic', symbol: 'ICP' });

		if (isNullish(icp)) {
			throw new Error('ICP asset missing from seed');
		}

		asset = icp;
	});

	test('request holds the amount plus the fee, the fee booked to the network fee account', async () => {
		const userId = await fundedUser(BigInt(1000));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(400),
			fee: BigInt(10),
			destination: 'aaaaa-aa',
			selfCustody: true,
			userAddress: `p-${userId}`
		});

		expect(withdrawal.state).toBe('requested');
		expect(withdrawal.self_custody).toBe(true);
		expect(withdrawal.fee).toBe('10');
		expect(await balanceOf(userId)).toBe(BigInt(590));
		expect(await legsOf(`withdrawal:${withdrawal.id}:hold`)).toEqual([
			{ kind: 'user', delta: '-410' },
			{ kind: 'external', delta: '400' },
			{ kind: 'network_fee', delta: '10' }
		]);
	});

	test('rejects a withdrawal the balance covers only without the fee', async () => {
		const userId = await fundedUser(BigInt(100));

		await expect(
			requestWithdrawal({
				userId,
				asset,
				amount: BigInt(100),
				fee: BigInt(1),
				destination: 'aaaaa-aa',
				selfCustody: false,
				userAddress: `p-${userId}`
			})
		).rejects.toThrow(InsufficientBalanceError);

		expect(await balanceOf(userId)).toBe(BigInt(100));
		expect(await query(`select 1 from withdrawals where user_id = $1`, [userId])).toEqual([]);
	});

	test('a withdrawal of the balance less the fee empties it', async () => {
		const userId = await fundedUser(BigInt(100));

		await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(99),
			fee: BigInt(1),
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		expect(await balanceOf(userId)).toBe(BigInt(0));
	});

	test('rejects a withdrawal above the balance without holding anything', async () => {
		const userId = await fundedUser(BigInt(100));

		expect(
			requestWithdrawal({
				userId,
				asset,
				amount: BigInt(101),
				fee: ZERO,
				destination: 'aaaaa-aa',
				selfCustody: false,
				userAddress: `p-${userId}`
			})
		).rejects.toThrow(InsufficientBalanceError);

		expect(await balanceOf(userId)).toBe(BigInt(100));
	});

	test('a request waits for a concurrent debit and reads the balance after it', async () => {
		const userId = await fundedUser(BigInt(1000));
		const account = await ensureUserAccount({ userId, chain: 'ic', address: `p-${userId}` });
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: 'ic',
			address: 'external'
		});
		let request: Promise<unknown> | undefined;

		// A first hold still uncommitted while the second request runs: without
		// the account lock the second reads the pre-debit balance and overdraws.
		await tx(async (q) => {
			await q(`select id from custody_accounts where id = $1 for update`, [account.id]);
			await postLedgerEvent(
				{
					eventKey: `test:debit:${userId}`,
					kind: 'withdrawal_hold',
					legs: [
						{ accountId: account.id, assetId: asset.id, delta: '-600' },
						{ accountId: external.id, assetId: asset.id, delta: '600' }
					]
				},
				q
			);

			request = requestWithdrawal({
				userId,
				asset,
				amount: BigInt(500),
				fee: BigInt(100),
				destination: 'aaaaa-aa',
				selfCustody: false,
				userAddress: `p-${userId}`
			}).catch((err: unknown) => err);

			await new Promise((resolve) => setTimeout(resolve, 200));
		});

		expect(await request).toBeInstanceOf(InsufficientBalanceError);
		expect(await balanceOf(userId)).toBe(BigInt(400));
	});

	test('refuses VXP even when a balance is booked, without holding or recording anything', async () => {
		const vxp = await getAssetBySymbol({ chain: 'ic', symbol: 'VXP' });

		if (isNullish(vxp)) {
			throw new Error('VXP asset missing from seed');
		}

		const userId = await fundedUser(BigInt(1000), vxp);

		await expect(
			requestWithdrawal({
				userId,
				asset: vxp,
				amount: BigInt(100),
				fee: ZERO,
				destination: 'aaaaa-aa',
				selfCustody: true,
				userAddress: `p-${userId}`
			})
		).rejects.toThrow(AssetNotWithdrawableError);

		expect(await tx((q) => userChainBalance({ q, userId, asset: vxp }))).toBe(BigInt(1000));
		expect(await query(`select 1 from withdrawals where user_id = $1`, [userId])).toEqual([]);
	});

	test('walks the happy path to confirmed', async () => {
		const userId = await fundedUser(BigInt(500));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(500),
			fee: ZERO,
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		const processing = await transitionWithdrawal({
			id: withdrawal.id,
			from: 'requested',
			to: 'processing'
		});

		expect(processing?.state).toBe('processing');

		const submitted = await transitionWithdrawal({
			id: withdrawal.id,
			from: 'processing',
			to: 'submitted',
			txRef: 'block-42'
		});

		expect(submitted?.state).toBe('submitted');
		expect(submitted?.tx_ref).toBe('block-42');

		const confirmed = await transitionWithdrawal({
			id: withdrawal.id,
			from: 'submitted',
			to: 'confirmed'
		});

		expect(confirmed?.state).toBe('confirmed');
		// Confirmed spend: the hold stays spent.
		expect(await balanceOf(userId)).toBe(BigInt(0));
	});

	test('failure refunds the amount and the fee exactly once', async () => {
		const userId = await fundedUser(BigInt(300));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(290),
			fee: BigInt(10),
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		expect(await balanceOf(userId)).toBe(BigInt(0));

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'processing' });

		const failed = await Promise.all(
			[1, 2].map(() =>
				transitionWithdrawal({
					id: withdrawal.id,
					from: 'processing',
					to: 'failed',
					failureReason: 'rpc down'
				})
			)
		);

		expect(failed.filter((row) => row?.state === 'failed')).toHaveLength(1);
		expect(await balanceOf(userId)).toBe(BigInt(300));
		expect(await legsOf(`withdrawal:${withdrawal.id}:refund`)).toEqual([
			{ kind: 'user', delta: '300' },
			{ kind: 'external', delta: '-290' },
			{ kind: 'network_fee', delta: '-10' }
		]);
	});

	test('rejection refunds the amount and the fee too', async () => {
		const userId = await fundedUser(BigInt(50));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(45),
			fee: BigInt(5),
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'rejected' });

		expect(await balanceOf(userId)).toBe(BigInt(50));
	});

	test('a row held without a fee refunds exactly its two-leg hold', async () => {
		const userId = await fundedUser(BigInt(50));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(50),
			fee: ZERO,
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'rejected' });

		expect(await balanceOf(userId)).toBe(BigInt(50));
		expect(await legsOf(`withdrawal:${withdrawal.id}:hold`)).toEqual([
			{ kind: 'user', delta: '-50' },
			{ kind: 'external', delta: '50' }
		]);
		expect(await legsOf(`withdrawal:${withdrawal.id}:refund`)).toEqual([
			{ kind: 'user', delta: '50' },
			{ kind: 'external', delta: '-50' }
		]);
	});

	test('an invalid transition throws and a stale one returns null', async () => {
		const userId = await fundedUser(BigInt(10));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(10),
			fee: ZERO,
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		expect(
			transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'confirmed' })
		).rejects.toThrow('invalid withdrawal transition');

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'processing' });

		// The row is no longer 'requested': the losing side of a race gets null.
		expect(
			await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'processing' })
		).toBeNull();
	});

	/** Holds posted for the user, one per withdrawal that really moved funds. */
	const holdCount = async (userId: string): Promise<number> => {
		const [row] = await query<{ holds: number }>(
			`select count(distinct l.event_key)::int as holds
			 from ledger_entries l
			 join custody_accounts c on c.id = l.account_id
			 where c.user_id = $1 and l.kind = 'withdrawal_hold'`,
			[userId]
		);

		return row?.holds ?? 0;
	};

	const withdrawalCount = async (userId: string): Promise<number> =>
		(await query(`select 1 from withdrawals where user_id = $1`, [userId])).length;

	const keyedRequest = ({
		userId,
		idempotencyKey,
		amount = BigInt(400)
	}: {
		userId: string;
		idempotencyKey?: string;
		amount?: bigint;
	}): Promise<Withdrawal> =>
		requestWithdrawal({
			userId,
			asset,
			amount,
			fee: BigInt(10),
			destination: 'aaaaa-aa',
			selfCustody: true,
			userAddress: `p-${userId}`,
			idempotencyKey
		});

	test('a retry with the same key returns the first withdrawal and holds nothing more', async () => {
		const userId = await fundedUser(BigInt(1000));
		const idempotencyKey = randomUUID();

		const first = await keyedRequest({ userId, idempotencyKey });
		const retry = await keyedRequest({ userId, idempotencyKey });

		expect(retry).toEqual(first);
		expect(await withdrawalCount(userId)).toBe(1);
		expect(await holdCount(userId)).toBe(1);
		expect(await balanceOf(userId)).toBe(BigInt(590));
	});

	test('a retry after the hold spent the balance still finds the first withdrawal', async () => {
		const userId = await fundedUser(BigInt(410));
		const idempotencyKey = randomUUID();

		const first = await keyedRequest({ userId, idempotencyKey });

		expect(await keyedRequest({ userId, idempotencyKey })).toEqual(first);
		expect(await balanceOf(userId)).toBe(ZERO);
	});

	test('two concurrent requests with one key file one withdrawal and one hold', async () => {
		const userId = await fundedUser(BigInt(1000));
		const idempotencyKey = randomUUID();

		const [a, b] = await Promise.all([
			keyedRequest({ userId, idempotencyKey }),
			keyedRequest({ userId, idempotencyKey })
		]);

		expect(a.id).toBe(b.id);
		expect(await withdrawalCount(userId)).toBe(1);
		expect(await holdCount(userId)).toBe(1);
		expect(await balanceOf(userId)).toBe(BigInt(590));
	});

	test('a request whose insert meets a keyed row committed after its lookup returns that row', async () => {
		const userId = await fundedUser(BigInt(1000));
		const idempotencyKey = randomUUID();
		let request: Promise<Withdrawal> | undefined;
		let winnerId: string | undefined;

		// The winner commits while the request waits on the unique index, past
		// the point where its lookup could have seen it: only the conflict
		// clause keeps it from inserting a second row and hold.
		await tx(async (q) => {
			const [winner] = await q<{ id: string }>(
				`insert into withdrawals
					 (user_id, asset_id, amount, fee, destination, self_custody, idempotency_key)
				 values ($1, $2, 400, 10, 'aaaaa-aa', true, $3)
				 returning id`,
				[userId, asset.id, idempotencyKey]
			);

			winnerId = winner?.id;
			request = keyedRequest({ userId, idempotencyKey });

			await new Promise((resolve) => setTimeout(resolve, 200));
		});

		expect((await request)?.id).toBe(winnerId);
		expect(await withdrawalCount(userId)).toBe(1);
		expect(await holdCount(userId)).toBe(0);
		expect(await balanceOf(userId)).toBe(BigInt(1000));
	});

	test('a key reused for another amount is refused without a second hold', async () => {
		const userId = await fundedUser(BigInt(1000));
		const idempotencyKey = randomUUID();

		await keyedRequest({ userId, idempotencyKey });

		await expect(keyedRequest({ userId, idempotencyKey, amount: BigInt(300) })).rejects.toThrow(
			IdempotencyKeyReusedError
		);

		expect(await withdrawalCount(userId)).toBe(1);
		expect(await holdCount(userId)).toBe(1);
		expect(await balanceOf(userId)).toBe(BigInt(590));
	});

	test('the same key from two users files a withdrawal for each', async () => {
		const [alice, bob] = await Promise.all([fundedUser(BigInt(1000)), fundedUser(BigInt(1000))]);
		const idempotencyKey = randomUUID();

		const [a, b] = await Promise.all([
			keyedRequest({ userId: alice, idempotencyKey }),
			keyedRequest({ userId: bob, idempotencyKey })
		]);

		expect(a.id).not.toBe(b.id);
		expect(await balanceOf(alice)).toBe(BigInt(590));
		expect(await balanceOf(bob)).toBe(BigInt(590));
	});

	test('requests without a key each file their own withdrawal', async () => {
		const userId = await fundedUser(BigInt(1000));

		const first = await keyedRequest({ userId });
		const second = await keyedRequest({ userId });

		expect(first.id).not.toBe(second.id);
		expect(await withdrawalCount(userId)).toBe(2);
		expect(await holdCount(userId)).toBe(2);
		expect(await balanceOf(userId)).toBe(BigInt(180));
	});
});
