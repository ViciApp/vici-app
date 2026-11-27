import type { Token } from '#lib/types/token.ts';
import {
	filterSendableTokens,
	findSendableAsset,
	pendingSendFor,
	type SendIntent
} from '#lib/utils/send.utils.ts';
import type { ApiWalletAsset } from '#lib/api-client/client.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const asset = (overrides: Partial<ApiWalletAsset>): ApiWalletAsset => ({
	id: `asset-${overrides.symbol ?? 'ICP'}`,
	chain: 'ic',
	symbol: 'ICP',
	decimals: 8,
	chainEnabled: true,
	withdrawable: true,
	withdrawalFee: null,
	...overrides
});

const token = (symbol: string): Token => ({ symbol }) as Token;

// The custody catalog as the API serves it: VXP is listed but never withdrawable.
const catalog: ApiWalletAsset[] = [
	asset({ symbol: 'VXP', decimals: 4, withdrawable: false }),
	asset({ symbol: 'ckUSDC', decimals: 6 })
];

describe('send.utils', () => {
	describe('findSendableAsset', () => {
		it('returns the withdrawable IC asset matching the token symbol', () => {
			assert.equal(findSendableAsset({ assets: catalog, token: token('ckUSDC') }), catalog[1]);
		});

		it('refuses a non-withdrawable asset', () => {
			assert.equal(findSendableAsset({ assets: catalog, token: token('VXP') }), undefined);
		});

		it('refuses an asset whose chain is disabled', () => {
			assert.equal(
				findSendableAsset({
					assets: [asset({ symbol: 'ICP', chainEnabled: false })],
					token: token('ICP')
				}),
				undefined
			);
		});

		it('refuses a same-symbol asset on another chain', () => {
			assert.equal(
				findSendableAsset({
					assets: [asset({ symbol: 'USDC', chain: 'eth' })],
					token: token('USDC')
				}),
				undefined
			);
		});

		it('refuses a token absent from the catalog', () => {
			assert.equal(findSendableAsset({ assets: catalog, token: token('ICP') }), undefined);
		});
	});

	describe('filterSendableTokens', () => {
		it('hides VXP when the custody catalog marks it non-withdrawable', () => {
			const sendable = filterSendableTokens({
				tokens: [token('VXP'), token('ckUSDC')],
				assets: catalog
			});

			assert.deepEqual(
				sendable.map(({ symbol }) => symbol),
				['ckUSDC']
			);
		});

		it('offers nothing when no token is withdrawable', () => {
			assert.deepEqual(filterSendableTokens({ tokens: [token('VXP')], assets: catalog }), []);
		});
	});

	describe('pendingSendFor', () => {
		const intent: SendIntent = {
			ledgerCanisterId: 'xevnm-gaaaa-aaaar-qafnq-cai',
			to: 'aaaaa-aa',
			amount: BigInt(250)
		};

		it('mints a key for a first send', () => {
			const send = pendingSendFor({ pending: undefined, intent });

			assert.deepEqual(send.intent, intent);
			assert.match(send.idempotencyKey, /^[0-9a-f-]{36}$/);
		});

		it('keeps the key on a retry of the same send', () => {
			const pending = pendingSendFor({ pending: undefined, intent });

			const retry = pendingSendFor({ pending, intent: { ...intent } });

			assert.equal(retry.idempotencyKey, pending.idempotencyKey);
		});

		for (const [field, changed] of [
			['amount', { amount: BigInt(251) }],
			['destination', { to: 'rrkah-fqaaa-aaaaa-aaaaq-cai' }],
			['token', { ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai' }]
		] as const) {
			it(`mints a new key when the ${field} changes`, () => {
				const pending = pendingSendFor({ pending: undefined, intent });

				const next = pendingSendFor({ pending, intent: { ...intent, ...changed } });

				assert.notEqual(next.idempotencyKey, pending.idempotencyKey);
				assert.deepEqual(next.intent, { ...intent, ...changed });
			});
		}
	});
});
