// Withdrawal state machine: the transition matrix, the balance hold at
// request time, insufficient-balance rejection, the VXP refusal, the
// compensating refund on failure, and the concurrent-transition race guard.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, isWithdrawable, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import {
	AssetNotWithdrawableError,
	canTransition,
	InsufficientBalanceError,
	requestWithdrawal,
	transitionWithdrawal,
	userChainBalance,
	WITHDRAWAL_TRANSITIONS,
	type WithdrawalState
} from '../src/custody/withdrawals';
import { query, tx } from '../src/db/client';
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

	beforeAll(async () => {
		await ensureMigrated();

		const icp = await getAssetBySymbol({ chain: 'ic', symbol: 'ICP' });

		if (isNullish(icp)) {
			throw new Error('ICP asset missing from seed');
		}

		asset = icp;
	});

	test('request holds the amount on the internal ledger', async () => {
		const userId = await fundedUser(BigInt(1000));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(400),
			destination: 'aaaaa-aa',
			selfCustody: true,
			userAddress: `p-${userId}`
		});

		expect(withdrawal.state).toBe('requested');
		expect(withdrawal.self_custody).toBe(true);
		expect(await balanceOf(userId)).toBe(BigInt(600));
	});

	test('rejects a withdrawal above the balance without holding anything', async () => {
		const userId = await fundedUser(BigInt(100));

		expect(
			requestWithdrawal({
				userId,
				asset,
				amount: BigInt(101),
				destination: 'aaaaa-aa',
				selfCustody: false,
				userAddress: `p-${userId}`
			})
		).rejects.toThrow(InsufficientBalanceError);

		expect(await balanceOf(userId)).toBe(BigInt(100));
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

	test('failure refunds the hold exactly once', async () => {
		const userId = await fundedUser(BigInt(300));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(300),
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		expect(await balanceOf(userId)).toBe(BigInt(0));

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'processing' });
		await transitionWithdrawal({
			id: withdrawal.id,
			from: 'processing',
			to: 'failed',
			failureReason: 'rpc down'
		});

		expect(await balanceOf(userId)).toBe(BigInt(300));
	});

	test('rejection refunds too', async () => {
		const userId = await fundedUser(BigInt(50));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(50),
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'rejected' });

		expect(await balanceOf(userId)).toBe(BigInt(50));
	});

	test('an invalid transition throws and a stale one returns null', async () => {
		const userId = await fundedUser(BigInt(10));
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount: BigInt(10),
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
});
