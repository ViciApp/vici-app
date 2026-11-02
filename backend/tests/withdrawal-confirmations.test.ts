// Withdrawal confirmations: a submitted withdrawal reaches confirmed, or failed
// with its hold refunded once, from what its chain reports; a pending one waits;
// a chain that stops answering is not read again in the same tick. The per-chain
// status readers are checked over a stubbed RPC.

import { isNullish } from '@dfinity/utils';
import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { btcTransferStatus } from '../src/chains/btc/adapter';
import { tickWithdrawalConfirmations } from '../src/chains/confirmations';
import { evmTransferStatus } from '../src/chains/evm/adapter';
import { icAdapter } from '../src/chains/ic/adapter';
import { solTransferStatus } from '../src/chains/sol/adapter';
import type { ChainAdapter, TransferStatus } from '../src/chains/types';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import {
	getWithdrawal,
	requestWithdrawal,
	transitionWithdrawal,
	userChainBalance
} from '../src/custody/withdrawals';
import { query, tx } from '../src/db/client';
import { env } from '../src/env';
import { logger } from '../src/lib/logger';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

/** Bun's `typeof fetch` also carries `preconnect`, so a bare function is not one. */
const stubFetch = (respond: (url: unknown, init?: RequestInit) => Promise<Response>) =>
	spyOn(globalThis, 'fetch').mockImplementation(
		Object.assign(respond, { preconnect: () => undefined })
	);

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

const rpcMethod = (init?: RequestInit): string =>
	(JSON.parse(String(init?.body)) as { method: string }).method;

describe('transfer status readers', () => {
	afterEach(() => {
		(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
	});

	test('evm: unmined or shallow is pending, a deep revert failed, a deep success confirmed', async () => {
		let receipt: unknown = null;
		const head = 1_000;

		stubFetch((_url, init) =>
			Promise.resolve(
				json({ result: rpcMethod(init) === 'eth_blockNumber' ? `0x${head.toString(16)}` : receipt })
			)
		);

		expect(await evmTransferStatus({ txRef: '0xabc' })).toBe('pending');

		receipt = { status: '0x0', blockNumber: `0x${head.toString(16)}` };

		expect(await evmTransferStatus({ txRef: '0xabc' })).toBe('pending');

		receipt = { status: '0x0', blockNumber: '0x1' };

		expect(await evmTransferStatus({ txRef: '0xabc' })).toBe('failed');

		receipt = {
			status: '0x1',
			blockNumber: `0x${(head - env.evm.confirmations + 2).toString(16)}`
		};

		expect(await evmTransferStatus({ txRef: '0xabc' })).toBe('pending');

		receipt = {
			status: '0x1',
			blockNumber: `0x${(head - env.evm.confirmations + 1).toString(16)}`
		};

		expect(await evmTransferStatus({ txRef: '0xabc' })).toBe('confirmed');
	});

	test('sol: unknown or below the commitment is pending, then failed or confirmed', async () => {
		let status: unknown = null;

		stubFetch(() => Promise.resolve(json({ result: { value: [status] } })));

		expect(await solTransferStatus({ txRef: 'sig' })).toBe('pending');

		status = { err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'processed' };

		expect(await solTransferStatus({ txRef: 'sig' })).toBe('pending');

		status = { err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' };

		expect(await solTransferStatus({ txRef: 'sig' })).toBe('failed');

		status = { err: null, confirmationStatus: 'processed' };

		expect(await solTransferStatus({ txRef: 'sig' })).toBe('pending');

		status = { err: null, confirmationStatus: 'finalized' };

		expect(await solTransferStatus({ txRef: 'sig' })).toBe('confirmed');
	});

	test('btc: unconfirmed and shallow are pending, deep enough is confirmed', async () => {
		let status: unknown = { confirmed: false };
		const tip = 800_000;

		stubFetch((url) =>
			Promise.resolve(
				String(url).endsWith('/blocks/tip/height')
					? new Response(String(tip), { status: 200 })
					: json(status)
			)
		);

		expect(await btcTransferStatus({ txRef: 'txid' })).toBe('pending');

		status = { confirmed: true, block_height: tip - env.btc.confirmations + 2 };

		expect(await btcTransferStatus({ txRef: 'txid' })).toBe('pending');

		status = { confirmed: true, block_height: tip - env.btc.confirmations + 1 };

		expect(await btcTransferStatus({ txRef: 'txid' })).toBe('confirmed');
	});

	test('ic: a returned block index is already final', async () => {
		expect(await icAdapter.transferStatus({ txRef: '42', asset: {} as Asset })).toBe('confirmed');
	});
});

describe.if(dbAvailable)('withdrawal confirmation tick', () => {
	let asset: Asset;

	beforeAll(async () => {
		await ensureMigrated();

		const vxp = await getAssetBySymbol({ chain: 'ic', symbol: 'VXP' });

		if (isNullish(vxp)) {
			throw new Error('VXP asset missing from seed');
		}

		asset = vxp;
	});

	afterEach(() => {
		(logger.error as unknown as { mockRestore?: () => void }).mockRestore?.();
	});

	/** A funded user with one withdrawal of `amount` already broadcast as
	 * `txRef`, checked longer ago than any other row so this tick reads it. */
	const submitted = async ({
		amount,
		txRef
	}: {
		amount: bigint;
		txRef: string;
	}): Promise<{ id: string; userId: string }> => {
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
				{ accountId: account.id, assetId: asset.id, delta: amount.toString() },
				{ accountId: external.id, assetId: asset.id, delta: (-amount).toString() }
			]
		});

		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount,
			destination: 'aaaaa-aa',
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		await transitionWithdrawal({ id: withdrawal.id, from: 'requested', to: 'processing' });
		await transitionWithdrawal({ id: withdrawal.id, from: 'processing', to: 'submitted', txRef });
		await query(`update withdrawals set updated_at = '2000-01-01' where id = $1`, [withdrawal.id]);

		return { id: withdrawal.id, userId };
	};

	const balanceOf = (userId: string): Promise<bigint> =>
		tx((q) => userChainBalance({ q, userId, asset }));

	const stateOf = async (id: string): Promise<string | undefined> =>
		(await getWithdrawal(id))?.state;

	/** An ic adapter whose status answers are scripted per txRef; any other
	 * row (left by other suites) reads as pending. */
	const scripted = (
		answer: (txRef: string) => Promise<TransferStatus> | undefined,
		reads: string[] = []
	): ChainAdapter => ({
		...icAdapter,
		transferStatus: ({ txRef }) => {
			reads.push(txRef);

			return answer(txRef) ?? Promise.resolve('pending');
		}
	});

	test('the real ic adapter confirms a submitted withdrawal and the hold stays spent', async () => {
		const { id, userId } = await submitted({ amount: BigInt(400), txRef: 'block-7' });

		await tickWithdrawalConfirmations();

		expect(await stateOf(id)).toBe('confirmed');
		expect(await balanceOf(userId)).toBe(BigInt(0));
	});

	test('a failed transfer refunds the hold once, however often the tick runs', async () => {
		const txRef = `fail-${crypto.randomUUID()}`;
		const { id, userId } = await submitted({ amount: BigInt(300), txRef });
		const adapter = scripted((ref) => (ref === txRef ? Promise.resolve('failed') : undefined));

		await tickWithdrawalConfirmations({ adapterFor: () => adapter });
		await tickWithdrawalConfirmations({ adapterFor: () => adapter });

		const withdrawal = await getWithdrawal(id);

		expect(withdrawal?.state).toBe('failed');
		expect(withdrawal?.failure_reason).toContain(txRef);
		expect(await balanceOf(userId)).toBe(BigInt(300));
	});

	test('a pending transfer stays submitted and goes to the back of the queue', async () => {
		const txRef = `wait-${crypto.randomUUID()}`;
		const { id, userId } = await submitted({ amount: BigInt(50), txRef });

		await tickWithdrawalConfirmations({ adapterFor: () => scripted(() => undefined) });

		const rows = await query<{ state: string; recent: boolean }>(
			`select state, updated_at > now() - interval '1 minute' as recent
			 from withdrawals where id = $1`,
			[id]
		);

		expect(rows[0]).toEqual({ state: 'submitted', recent: true });
		expect(await balanceOf(userId)).toBe(BigInt(0));
	});

	test('a chain that stops answering is not read again this tick', async () => {
		const errors = spyOn(logger, 'error').mockImplementation(() => undefined);
		const hung = `hang-${crypto.randomUUID()}`;
		const next = `next-${crypto.randomUUID()}`;
		const first = await submitted({ amount: BigInt(10), txRef: hung });
		const second = await submitted({ amount: BigInt(10), txRef: next });

		await query(`update withdrawals set updated_at = '1999-01-01' where id = $1`, [first.id]);

		const reads: string[] = [];
		const adapter = scripted(
			(ref) =>
				ref === hung ? new Promise<TransferStatus>(() => undefined) : Promise.resolve('confirmed'),
			reads
		);

		await tickWithdrawalConfirmations({ adapterFor: () => adapter, timeout_ms: 10 });

		expect(reads).toEqual([hung]);
		expect(errors).toHaveBeenCalled();
		expect(await stateOf(first.id)).toBe('submitted');
		expect(await stateOf(second.id)).toBe('submitted');
	});

	test('a disabled chain is skipped', async () => {
		const txRef = `off-${crypto.randomUUID()}`;
		const { id } = await submitted({ amount: BigInt(10), txRef });
		const reads: string[] = [];

		await tickWithdrawalConfirmations({
			adapterFor: () => ({ ...scripted(() => Promise.resolve('confirmed'), reads), enabled: false })
		});

		expect(reads).toEqual([]);
		expect(await stateOf(id)).toBe('submitted');
	});
});
