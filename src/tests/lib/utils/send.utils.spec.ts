import type { Token } from '$lib/types/token';
import { filterSendableTokens, findSendableAsset } from '$lib/utils/send.utils';
import type { Web2WalletAsset } from '$lib/web2/client';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const asset = (overrides: Partial<Web2WalletAsset>): Web2WalletAsset => ({
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
const catalog: Web2WalletAsset[] = [
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

		it('keeps every token when no custody gate applies (default backend)', () => {
			const tokens = [token('VXP'), token('ICP')];

			assert.equal(filterSendableTokens({ tokens, assets: undefined }), tokens);
		});
	});
});
