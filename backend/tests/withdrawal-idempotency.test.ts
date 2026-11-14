// `POST /wallet/withdrawals` retried with its idempotency key: the retry gets
// the first response back, a concurrent pair files and sends one withdrawal,
// a key reused for another withdrawal is refused, and a request without a key
// still files a new one. The ic adapter runs for real over a stubbed ICRC
// ledger, so "sends once" counts the transfers that reach the ledger.

import { isNullish, nonNullish } from '@dfinity/utils';
import { IcrcLedgerCanister } from '@icp-sdk/canisters/ledger/icrc';
import { Principal } from '@icp-sdk/core/principal';
import { afterAll, beforeAll, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { fakeEngineActorProvider } from '../e2e/fake-engine';
import { createSession } from '../src/auth/sessions';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import { userChainBalance } from '../src/custody/withdrawals';
import { query, tx } from '../src/db/client';
import { setEngineActorProvider, type IcrcLedgerActor } from '../src/engine/actors';
import { app } from '../src/index';
import { userIcPrincipalText } from '../src/lib/keys';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const FEE = BigInt(10);

/** Every transfer this suite's recipients land as this block. */
const BLOCK = BigInt(7);

interface RouteAnswer {
	status: number;
	body: { withdrawal?: { id: string }; error?: string };
}

describe.if(dbAvailable)('withdrawal request idempotency', () => {
	let icp: Asset;
	let ledgerCreate: Mock<typeof IcrcLedgerCanister.create>;
	let restoreLedger: () => void;
	const createdIds: string[] = [];
	/** Recipients of every transfer sent, one entry per send. */
	const sentTo: string[] = [];

	beforeAll(async () => {
		await ensureMigrated();

		const asset = await getAssetBySymbol({ chain: 'ic', symbol: 'ICP' });

		if (isNullish(asset)) {
			throw new Error('ICP asset missing from seed');
		}

		icp = asset;

		ledgerCreate = spyOn(IcrcLedgerCanister, 'create').mockImplementation(
			() =>
				({
					transfer: ({ to }: { to: { owner: Principal } }) => {
						sentTo.push(to.owner.toText());

						return Promise.resolve(BLOCK);
					}
				}) as unknown as IcrcLedgerCanister
		);
		restoreLedger = setEngineActorProvider({
			...fakeEngineActorProvider,
			ledger: () =>
				Promise.resolve({
					transactionFee: () => Promise.resolve(FEE)
				} as unknown as IcrcLedgerActor)
		});
	});

	afterAll(async () => {
		ledgerCreate.mockRestore();
		restoreLedger();
		// Rows left in flight would be resent by a later worker tick against the
		// real ledger.
		await query(
			`update withdrawals set state = 'failed' where id = any($1::uuid[]) and state in ('requested', 'processing')`,
			[createdIds]
		);
	});

	/** A user funded with `amount` at the address the route derives, with a
	 * recipient no other test sends to. */
	const funded = async (
		amount: bigint
	): Promise<{ userId: string; cookie: string; to: string }> => {
		const userId = await createTestUser();
		const account = await ensureUserAccount({
			userId,
			chain: 'ic',
			address: userIcPrincipalText(userId)
		});
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: 'ic',
			address: 'external'
		});

		await postLedgerEvent({
			eventKey: `test:fund:${userId}`,
			kind: 'deposit',
			legs: [
				{ accountId: account.id, assetId: icp.id, delta: amount.toString() },
				{ accountId: external.id, assetId: icp.id, delta: (-amount).toString() }
			]
		});

		return {
			userId,
			cookie: `vici_session=${await createSession(userId)}`,
			to: Principal.fromUint8Array(randomBytes(29)).toText()
		};
	};

	const post = async ({
		cookie,
		body
	}: {
		cookie: string;
		body: Record<string, unknown>;
	}): Promise<RouteAnswer> => {
		const res = await app.handle(
			new Request('http://localhost/api/v1/wallet/withdrawals', {
				method: 'POST',
				headers: { cookie, 'content-type': 'application/json' },
				body: JSON.stringify({ assetId: icp.id, ...body })
			})
		);
		const json = (await res.json()) as RouteAnswer['body'];

		if (nonNullish(json.withdrawal)) {
			createdIds.push(json.withdrawal.id);
		}

		return { status: res.status, body: json };
	};

	const withdrawalCount = async (userId: string): Promise<number> =>
		(await query(`select 1 from withdrawals where user_id = $1`, [userId])).length;

	const sendsTo = (to: string): number => sentTo.filter((recipient) => recipient === to).length;

	const balanceOf = (userId: string): Promise<bigint> =>
		tx((q) => userChainBalance({ q, userId, asset: icp }));

	test('answers the retry with the first response and sends once', async () => {
		const { userId, cookie, to } = await funded(BigInt(1000));
		const body = { amount: '200', destination: to, idempotencyKey: randomUUID() };

		const first = await post({ cookie, body });
		const retry = await post({ cookie, body });

		expect(first.status).toBe(201);
		expect(first.body.withdrawal).toMatchObject({ state: 'submitted', txRef: BLOCK.toString() });
		expect(retry).toEqual(first);
		expect(await withdrawalCount(userId)).toBe(1);
		expect(sendsTo(to)).toBe(1);
		expect(await balanceOf(userId)).toBe(BigInt(790));
	});

	test('two concurrent requests with one key file and send one withdrawal', async () => {
		const { userId, cookie, to } = await funded(BigInt(1000));
		const body = { amount: '200', destination: to, idempotencyKey: randomUUID() };

		const [a, b] = await Promise.all([post({ cookie, body }), post({ cookie, body })]);

		expect([a.status, b.status]).toEqual([201, 201]);
		expect(a.body.withdrawal?.id).toBe(b.body.withdrawal?.id ?? '');
		expect(await withdrawalCount(userId)).toBe(1);
		expect(sendsTo(to)).toBe(1);
		expect(await balanceOf(userId)).toBe(BigInt(790));
	});

	test('refuses the key for a different amount with a stable code', async () => {
		const { userId, cookie, to } = await funded(BigInt(1000));
		const idempotencyKey = randomUUID();

		await post({ cookie, body: { amount: '200', destination: to, idempotencyKey } });

		const reused = await post({ cookie, body: { amount: '300', destination: to, idempotencyKey } });

		expect(reused).toEqual({ status: 409, body: { error: 'idempotency_key_reused' } });
		expect(await withdrawalCount(userId)).toBe(1);
		expect(sendsTo(to)).toBe(1);
		expect(await balanceOf(userId)).toBe(BigInt(790));
	});

	test('requests without a key still file one withdrawal each', async () => {
		const { userId, cookie, to } = await funded(BigInt(1000));
		const body = { amount: '200', destination: to };

		const first = await post({ cookie, body });
		const second = await post({ cookie, body });

		expect([first.status, second.status]).toEqual([201, 201]);
		expect(first.body.withdrawal?.id).not.toBe(second.body.withdrawal?.id ?? '');
		expect(sendsTo(to)).toBe(2);
		expect(await balanceOf(userId)).toBe(BigInt(580));
	});
});
