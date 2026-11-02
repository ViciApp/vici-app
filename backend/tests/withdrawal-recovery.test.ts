// Withdrawal execution and recovery: a withdrawal a crash left `requested` is
// executed, one left `processing` is resent with its fixed dedup fields until
// the ledger answers, and the hold is refunded only on a definite rejection.
// The ic tests run the real adapter over a stubbed ICRC ledger, so the dedup
// fields on the wire and the rejection rules are the production ones.

import { isNullish, nonNullish } from '@dfinity/utils';
import { IcrcLedgerCanister, IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { Principal } from '@icp-sdk/core/principal';
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { encodeTransferMemo } from '../src/chains/ic/icrc';
import { getAdapter } from '../src/chains/registry';
import type { ChainAdapter } from '../src/chains/types';
import * as execution from '../src/chains/withdrawal-execution';
import { executeWithdrawal, tickWithdrawalRecovery } from '../src/chains/withdrawal-execution';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import {
	claimWithdrawal,
	getWithdrawal,
	requestWithdrawal,
	userChainBalance,
	type Withdrawal
} from '../src/custody/withdrawals';
import { query, tx } from '../src/db/client';
import { app } from '../src/index';
import { userIcPrincipalText, type Chain } from '../src/lib/keys';
import { logger } from '../src/lib/logger';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

interface SentTransfer {
	to: string;
	amount: bigint;
	memo?: Uint8Array;
	created_at_time?: bigint;
}

type LedgerAnswer = (sent: SentTransfer) => Promise<bigint>;

const rejection = (errorType: Record<string, unknown>): IcrcTransferError<unknown> =>
	new IcrcTransferError({ msg: 'rejected', errorType });

describe.if(dbAvailable)('withdrawal recovery', () => {
	let icp: Asset;
	let eth: Asset;
	let ledgerCreate: Mock<typeof IcrcLedgerCanister.create>;
	let errors: Mock<typeof logger.error>;
	const createdIds: string[] = [];
	/** Ledger answers keyed by recipient; rows left by other suites get an
	 * error that says nothing, which leaves them where they are. */
	const answers = new Map<string, LedgerAnswer>();
	const sent: SentTransfer[] = [];

	beforeAll(async () => {
		await ensureMigrated();

		const [icpAsset, ethAsset] = await Promise.all([
			getAssetBySymbol({ chain: 'ic', symbol: 'ICP' }),
			getAssetBySymbol({ chain: 'evm', symbol: 'ETH' })
		]);

		if (isNullish(icpAsset) || isNullish(ethAsset)) {
			throw new Error('ICP or ETH asset missing from seed');
		}

		icp = icpAsset;
		eth = ethAsset;

		ledgerCreate = spyOn(IcrcLedgerCanister, 'create').mockImplementation(
			() =>
				({
					transfer: (params: {
						to: { owner: Principal };
						amount: bigint;
						memo?: Uint8Array;
						created_at_time?: bigint;
					}) => {
						const transfer: SentTransfer = {
							to: params.to.owner.toText(),
							amount: params.amount,
							memo: params.memo,
							created_at_time: params.created_at_time
						};

						sent.push(transfer);

						const answer = answers.get(transfer.to);

						return isNullish(answer)
							? Promise.reject(new Error('unscripted recipient'))
							: answer(transfer);
					}
				}) as unknown as IcrcLedgerCanister
		);
	});

	afterEach(() => {
		errors?.mockRestore();
	});

	afterAll(async () => {
		ledgerCreate.mockRestore();
		// Rows this suite leaves in flight would be resent by any later worker
		// tick against the real ledger.
		await query(
			`update withdrawals set state = 'failed' where id = any($1::uuid[]) and state in ('requested', 'processing')`,
			[createdIds]
		);
	});

	const silenceErrors = (): Mock<typeof logger.error> => {
		errors = spyOn(logger, 'error').mockImplementation(() => undefined);

		return errors;
	};

	const recipient = (): string => Principal.fromUint8Array(randomBytes(29)).toText();

	const balanceOf = ({ userId, asset }: { userId: string; asset: Asset }): Promise<bigint> =>
		tx((q) => userChainBalance({ q, userId, asset }));

	const rowOf = async (id: string): Promise<Withdrawal> => {
		const row = await getWithdrawal(id);

		if (isNullish(row)) {
			throw new Error(`withdrawal ${id} vanished`);
		}

		return row;
	};

	/** A funded user with one fresh withdrawal of `amount` to a recipient only
	 * this test scripts, its hold already posted. */
	const requested = async ({
		amount,
		asset = icp
	}: {
		amount: bigint;
		asset?: Asset;
	}): Promise<{ withdrawal: Withdrawal; userId: string; to: string }> => {
		const userId = await createTestUser();
		const account = await ensureUserAccount({
			userId,
			chain: asset.chain,
			address: `p-${userId}`
		});
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: asset.chain,
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

		const to = recipient();
		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount,
			destination: to,
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		createdIds.push(withdrawal.id);

		return { withdrawal, userId, to };
	};

	/** Ages a row past every recovery grace, ahead of rows other tests left. */
	const abandon = async (id: string): Promise<void> => {
		await query(`update withdrawals set updated_at = '1990-01-01' where id = $1`, [id]);
	};

	const sentTo = (to: string): SentTransfer[] => sent.filter((transfer) => transfer.to === to);

	test('a withdrawal a crash left requested is executed with its dedup fields', async () => {
		const { withdrawal, userId, to } = await requested({ amount: BigInt(500) });

		answers.set(to, () => Promise.resolve(BigInt(11)));
		await abandon(withdrawal.id);

		await tickWithdrawalRecovery();

		const row = await rowOf(withdrawal.id);
		const [transfer] = sentTo(to);

		expect(row.state).toBe('submitted');
		expect(row.tx_ref).toBe('11');
		expect(sentTo(to)).toHaveLength(1);
		expect(transfer?.amount).toBe(BigInt(500));
		expect(transfer?.memo).toEqual(encodeTransferMemo(`withdrawal:${withdrawal.id}`));
		expect(transfer?.created_at_time?.toString()).toBe(row.transfer_created_at_ns ?? '');
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(0));
	});

	test('a fresh requested row is left to the request that made it', async () => {
		const { withdrawal, to } = await requested({ amount: BigInt(10) });

		answers.set(to, () => Promise.resolve(BigInt(12)));

		await tickWithdrawalRecovery();

		expect((await rowOf(withdrawal.id)).state).toBe('requested');
		expect(sentTo(to)).toHaveLength(0);
	});

	test('an unanswered first send stays processing without a refund, then the resend settles it as the original block', async () => {
		silenceErrors();

		const { withdrawal, userId, to } = await requested({ amount: BigInt(300) });

		answers.set(to, () => Promise.reject(new Error('connection reset')));

		const executed = await executeWithdrawal({ withdrawal, asset: icp });

		expect(executed.state).toBe('processing');
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(0));

		await tickWithdrawalRecovery();

		expect(sentTo(to)).toHaveLength(1);

		answers.set(to, () => Promise.reject(rejection({ Duplicate: { duplicate_of: BigInt(77) } })));
		await abandon(withdrawal.id);

		await tickWithdrawalRecovery();

		const row = await rowOf(withdrawal.id);
		const [first, resend] = sentTo(to);

		expect(row.state).toBe('submitted');
		expect(row.tx_ref).toBe('77');
		expect(resend?.memo).toEqual(first?.memo);
		expect(resend?.created_at_time).toBe(first?.created_at_time);
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(0));
	});

	test('a send that times out stays processing and stalls the chain for the pass', async () => {
		silenceErrors();

		const hung = await requested({ amount: BigInt(20) });
		const next = await requested({ amount: BigInt(20) });

		answers.set(hung.to, () => new Promise<bigint>(() => undefined));
		answers.set(next.to, () => Promise.resolve(BigInt(13)));
		await claimWithdrawal(hung.withdrawal.id);
		await claimWithdrawal(next.withdrawal.id);
		await query(`update withdrawals set updated_at = '1989-01-01' where id = $1`, [
			hung.withdrawal.id
		]);
		await abandon(next.withdrawal.id);

		await tickWithdrawalRecovery({ timeout_ms: 10 });

		expect((await rowOf(hung.withdrawal.id)).state).toBe('processing');
		expect((await rowOf(next.withdrawal.id)).state).toBe('processing');
		expect(sentTo(next.to)).toHaveLength(0);
		expect(await balanceOf({ userId: hung.userId, asset: icp })).toBe(BigInt(0));
	});

	test('a resend answered with an error that proves nothing stays processing without a refund', async () => {
		silenceErrors();

		const { withdrawal, userId, to } = await requested({ amount: BigInt(40) });

		await claimWithdrawal(withdrawal.id);
		await abandon(withdrawal.id);
		answers.set(to, () => Promise.reject(rejection({ TemporarilyUnavailable: null })));

		await tickWithdrawalRecovery();

		const rows = await query<{ state: string; recent: boolean }>(
			`select state, updated_at > now() - interval '1 minute' as recent
			 from withdrawals where id = $1`,
			[withdrawal.id]
		);

		expect(sentTo(to)).toHaveLength(1);
		expect(rows[0]).toEqual({ state: 'processing', recent: true });
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(0));
	});

	test('a definite rejection of the first send refunds the hold once', async () => {
		silenceErrors();

		const { withdrawal, userId, to } = await requested({ amount: BigInt(250) });

		answers.set(to, () => Promise.reject(rejection({ InsufficientFunds: { balance: BigInt(0) } })));

		const executed = await executeWithdrawal({ withdrawal, asset: icp });

		expect(executed.state).toBe('failed');
		expect(executed.failure_reason).toContain('InsufficientFunds');

		await abandon(withdrawal.id);
		await tickWithdrawalRecovery();
		await tickWithdrawalRecovery();

		expect(sentTo(to)).toHaveLength(1);
		expect((await rowOf(withdrawal.id)).state).toBe('failed');
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(250));
	});

	test('a resend answered InsufficientFunds proves nothing landed and refunds once', async () => {
		silenceErrors();

		const { withdrawal, userId, to } = await requested({ amount: BigInt(90) });

		await claimWithdrawal(withdrawal.id);
		await abandon(withdrawal.id);
		answers.set(to, () => Promise.reject(rejection({ InsufficientFunds: { balance: BigInt(0) } })));

		await tickWithdrawalRecovery();
		await abandon(withdrawal.id);
		await tickWithdrawalRecovery();

		expect(sentTo(to)).toHaveLength(1);
		expect((await rowOf(withdrawal.id)).state).toBe('failed');
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(90));
	});

	test('a resend answered TooOld is left for a human and never refunded', async () => {
		const logged = silenceErrors();
		const { withdrawal, userId, to } = await requested({ amount: BigInt(60) });

		await claimWithdrawal(withdrawal.id);
		await abandon(withdrawal.id);
		answers.set(to, () => Promise.reject(rejection({ TooOld: null })));

		await tickWithdrawalRecovery();

		expect(sentTo(to)).toHaveLength(1);
		expect((await rowOf(withdrawal.id)).state).toBe('processing');
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(0));
		expect(
			logged.mock.calls.some(([message]) =>
				String(message).includes(`${withdrawal.id} needs a manual look`)
			)
		).toBe(true);
	});

	test('a processing row past the dedup window is reported, never resent', async () => {
		const logged = silenceErrors();
		const { withdrawal, userId, to } = await requested({ amount: BigInt(70) });

		await claimWithdrawal(withdrawal.id);
		await query(
			`update withdrawals set updated_at = '1990-01-01', transfer_created_at_ns = 1 where id = $1`,
			[withdrawal.id]
		);
		answers.set(to, () => Promise.resolve(BigInt(14)));

		await tickWithdrawalRecovery();

		expect(sentTo(to)).toHaveLength(0);
		expect((await rowOf(withdrawal.id)).state).toBe('processing');
		expect(await balanceOf({ userId, asset: icp })).toBe(BigInt(0));
		expect(
			logged.mock.calls.some(([message]) =>
				String(message).includes(`${withdrawal.id} (past the ledger dedup window)`)
			)
		).toBe(true);
	});

	test('a processing row on a chain that cannot deduplicate is reported and left untouched', async () => {
		const logged = silenceErrors();
		const { withdrawal, userId } = await requested({ amount: BigInt(80), asset: eth });
		const evmSends: unknown[] = [];
		const evm: ChainAdapter = {
			...getAdapter('evm'),
			enabled: true,
			replaySafe: false,
			transfer: (params) => {
				evmSends.push(params);

				return Promise.resolve('0xfeed');
			}
		};

		await claimWithdrawal(withdrawal.id);
		await abandon(withdrawal.id);

		await tickWithdrawalRecovery({
			adapterFor: (chain: Chain) => (chain === 'evm' ? evm : getAdapter(chain))
		});

		const rows = await query<{ state: string; untouched: boolean }>(
			`select state, updated_at = '1990-01-01' as untouched from withdrawals where id = $1`,
			[withdrawal.id]
		);

		expect(evmSends).toEqual([]);
		expect(rows[0]).toEqual({ state: 'processing', untouched: true });
		expect(await balanceOf({ userId, asset: eth })).toBe(BigInt(0));
		expect(
			logged.mock.calls.some(([message]) =>
				String(message).includes(`${withdrawal.id} (no enabled replay-safe evm adapter)`)
			)
		).toBe(true);
	});

	test('two recovery passes racing on one row submit it once, the loser deduplicated', async () => {
		silenceErrors();

		const { withdrawal, to } = await requested({ amount: BigInt(30) });
		let landed: bigint | undefined;

		await claimWithdrawal(withdrawal.id);
		await abandon(withdrawal.id);
		answers.set(to, () => {
			if (isNullish(landed)) {
				landed = BigInt(15);

				return Promise.resolve(landed);
			}

			return Promise.reject(rejection({ Duplicate: { duplicate_of: landed } }));
		});

		await Promise.all([tickWithdrawalRecovery(), tickWithdrawalRecovery()]);

		const row = await rowOf(withdrawal.id);

		expect(row.state).toBe('submitted');
		expect(row.tx_ref).toBe('15');
	});

	test('only one runner wins the claim of a requested row', async () => {
		const { withdrawal } = await requested({ amount: BigInt(5) });

		const claims = await Promise.all([
			claimWithdrawal(withdrawal.id),
			claimWithdrawal(withdrawal.id)
		]);

		expect(claims.filter(nonNullish)).toHaveLength(1);
	});

	test('a first attempt that throws still answers with the stored withdrawal', async () => {
		silenceErrors();

		const userId = await createTestUser();
		const address = userIcPrincipalText(userId);
		const account = await ensureUserAccount({ userId, chain: 'ic', address });
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: 'ic',
			address: 'external'
		});

		await postLedgerEvent({
			eventKey: `test:fund:${userId}`,
			kind: 'deposit',
			legs: [
				{ accountId: account.id, assetId: icp.id, delta: '300' },
				{ accountId: external.id, assetId: icp.id, delta: '-300' }
			]
		});

		const execute = spyOn(execution, 'executeWithdrawal').mockRejectedValue(
			new Error('connection terminated')
		);

		try {
			const res = await app.handle(
				new Request('http://localhost/api/v1/wallet/withdrawals', {
					method: 'POST',
					headers: {
						cookie: `vici_session=${await createSession(userId)}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({ assetId: icp.id, amount: '200', destination: recipient() })
				})
			);
			const body = (await res.json()) as { withdrawal: { id: string; state: string } };

			createdIds.push(body.withdrawal.id);

			expect(res.status).toBe(201);
			expect(body.withdrawal.state).toBe('requested');
			expect(await query(`select 1 from withdrawals where user_id = $1`, [userId])).toHaveLength(1);
		} finally {
			execute.mockRestore();
		}
	});
});
