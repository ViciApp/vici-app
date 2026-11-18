import {
	pendingSendAfterError,
	sendCustodialToken,
	SendTokenError
} from '#lib/services/send.services.ts';
import type { Token } from '#lib/types/token.ts';
import { pendingSendFor, type PendingSend, type SendIntent } from '#lib/utils/send.utils.ts';
import { Web2ApiError, type Web2WalletAsset } from '#lib/web2/client.ts';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

const token = { symbol: 'ICP', ledgerCanisterId: ICP_LEDGER, decimals: 8 } as Token;

const icpAsset: Web2WalletAsset = {
	id: 'asset-icp',
	chain: 'ic',
	symbol: 'ICP',
	decimals: 8,
	chainEnabled: true,
	withdrawable: true,
	withdrawalFee: '10000'
};

const intent: SendIntent = { ledgerCanisterId: ICP_LEDGER, to: 'aaaaa-aa', amount: BigInt(250) };

const withdrawalRow = (state: string): Record<string, unknown> => ({
	id: 'w1',
	assetId: icpAsset.id,
	amount: '250',
	fee: '10000',
	destination: intent.to,
	selfCustody: true,
	state,
	txRef: null,
	failureReason: state === 'failed' ? 'ledger refused' : null
});

const json = ({ body, status }: { body: unknown; status: number }): Response =>
	new Response(JSON.stringify(body), { status });

describe('send.services', () => {
	const originalFetch = globalThis.fetch;

	/** Idempotency keys of every withdrawal request, in order. */
	let sentKeys: string[];

	/** Serves the asset catalog and answers each withdrawal through `withdraw`. */
	const stubApi = (withdraw: () => Promise<Response>): void => {
		globalThis.fetch = (...[url, init]: Parameters<typeof fetch>): Promise<Response> => {
			if (String(url).endsWith('/api/v1/wallet/assets')) {
				return Promise.resolve(json({ body: { assets: [icpAsset] }, status: 200 }));
			}

			const { idempotencyKey } = JSON.parse(String(init?.body)) as { idempotencyKey: string };

			sentKeys.push(idempotencyKey);

			return withdraw();
		};
	};

	/** One try of `intent` as the Wallet page runs it: the key of the send
	 * still pending, then what is left pending after the outcome. */
	const attempt = async (pending: PendingSend | undefined): Promise<PendingSend | undefined> => {
		const send = pendingSendFor({ pending, intent });

		try {
			await sendCustodialToken({
				token,
				to: send.intent.to,
				amount: send.intent.amount,
				idempotencyKey: send.idempotencyKey
			});
		} catch (err: unknown) {
			return pendingSendAfterError({ pending: send, err });
		}
	};

	beforeEach(() => {
		sentKeys = [];
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('sendCustodialToken', () => {
		it('sends the idempotency key it is given', async () => {
			stubApi(() =>
				Promise.resolve(json({ body: { withdrawal: withdrawalRow('submitted') }, status: 201 }))
			);

			await sendCustodialToken({
				token,
				to: intent.to,
				amount: intent.amount,
				idempotencyKey: 'k1'
			});
			await sendCustodialToken({
				token,
				to: intent.to,
				amount: intent.amount,
				idempotencyKey: 'k1'
			});

			assert.deepEqual(sentKeys, ['k1', 'k1']);
		});

		it('throws a SendTokenError for a failed withdrawal', async () => {
			stubApi(() =>
				Promise.resolve(json({ body: { withdrawal: withdrawalRow('failed') }, status: 201 }))
			);

			await assert.rejects(
				sendCustodialToken({ token, to: intent.to, amount: intent.amount, idempotencyKey: 'k1' }),
				(err: unknown) => err instanceof SendTokenError && err.detail === 'ledger refused'
			);
		});
	});

	describe('retrying a send', () => {
		const unknownOutcomes: [string, () => Promise<Response>][] = [
			['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
			['a 500', () => Promise.resolve(json({ body: { error: 'internal' }, status: 500 }))],
			['a 408', () => Promise.resolve(json({ body: { error: 'timeout' }, status: 408 }))]
		];

		for (const [label, outcome] of unknownOutcomes) {
			it(`resends the same key after ${label}`, async () => {
				stubApi(outcome);

				const pending = await attempt(undefined);

				stubApi(() =>
					Promise.resolve(json({ body: { withdrawal: withdrawalRow('submitted') }, status: 201 }))
				);

				const settled = await attempt(pending);

				assert.equal(sentKeys.length, 2);
				assert.equal(sentKeys[0], sentKeys[1]);
				assert.equal(settled, undefined);
			});
		}

		const definiteOutcomes: [string, () => Promise<Response>][] = [
			[
				'a failed withdrawal',
				() => Promise.resolve(json({ body: { withdrawal: withdrawalRow('failed') }, status: 201 }))
			],
			[
				'a validation error',
				() => Promise.resolve(json({ body: { error: 'insufficient_balance' }, status: 400 }))
			],
			[
				'a reused key',
				() => Promise.resolve(json({ body: { error: 'idempotency_key_reused' }, status: 409 }))
			]
		];

		for (const [label, outcome] of definiteOutcomes) {
			it(`mints a new key after ${label}`, async () => {
				stubApi(outcome);

				const pending = await attempt(undefined);

				await attempt(pending);

				assert.equal(pending, undefined);
				assert.equal(sentKeys.length, 2);
				assert.notEqual(sentKeys[0], sentKeys[1]);
			});
		}

		it('mints a new key after a successful send', async () => {
			stubApi(() =>
				Promise.resolve(json({ body: { withdrawal: withdrawalRow('submitted') }, status: 201 }))
			);

			await attempt(await attempt(undefined));

			assert.notEqual(sentKeys[0], sentKeys[1]);
		});

		it('keeps a send pending only for an unknown outcome', () => {
			const pending = pendingSendFor({ pending: undefined, intent });

			assert.equal(pendingSendAfterError({ pending, err: new Error('offline') }), pending);
			assert.equal(
				pendingSendAfterError({ pending, err: new Web2ApiError({ status: 503, code: 'x' }) }),
				pending
			);
			assert.equal(
				pendingSendAfterError({ pending, err: new Web2ApiError({ status: 401, code: 'x' }) }),
				undefined
			);
		});
	});
});
