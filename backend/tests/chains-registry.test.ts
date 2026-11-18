// Adapter registry gating: ic is enabled with zero configuration, the other
// chains register as disabled until their env lands, and disabled adapters
// fail closed (still deriving addresses, since derivation is pure).

import { describe, expect, test } from 'bun:test';
import { btcAddressFromPrivateKey } from '../src/chains/btc/address';
import { enabledAdapters, getAdapter, isChain, listAdapters } from '../src/chains/registry';
import { ChainDisabledError } from '../src/chains/types';
import type { Asset } from '../src/custody/assets';
import { loadEnv } from '../src/env';

const USER = '33333333-3333-3333-3333-333333333333';

const fakeAsset: Asset = {
	id: 'asset-id',
	chain: 'evm',
	symbol: 'ETH',
	decimals: 18,
	ledger_ref: null,
	enabled: true
};

describe('adapter registry (test env has no chain config)', () => {
	test('registers all four chains', () => {
		expect(
			listAdapters()
				.map((adapter) => adapter.chain)
				.sort()
		).toEqual(['btc', 'evm', 'ic', 'sol']);
	});

	test('ic is enabled by default, the rest are disabled', () => {
		expect(getAdapter('ic').enabled).toBe(true);
		expect(getAdapter('evm').enabled).toBe(false);
		expect(getAdapter('sol').enabled).toBe(false);
		expect(getAdapter('btc').enabled).toBe(false);
		expect(enabledAdapters().map((adapter) => adapter.chain)).toEqual(['ic']);
	});

	test('disabled adapters reject I/O with ChainDisabledError', () => {
		for (const chain of ['evm', 'sol', 'btc'] as const) {
			const adapter = getAdapter(chain);

			expect(adapter.getBalance({ address: 'x', asset: fakeAsset })).rejects.toThrow(
				ChainDisabledError
			);
			expect(adapter.transfer({ to: 'x', amount: BigInt(1), asset: fakeAsset })).rejects.toThrow(
				ChainDisabledError
			);
		}
	});

	test('disabled adapters still derive addresses (pure, no I/O)', () => {
		expect(getAdapter('evm').deriveAddress(USER).startsWith('0x')).toBe(true);
		expect(getAdapter('btc').deriveAddress(USER).startsWith('bc1q')).toBe(true);
		expect(getAdapter('sol').deriveAddress(USER).length).toBeGreaterThan(30);
		expect(getAdapter('ic').deriveAddress(USER)).toContain('-');
	});

	test('every adapter accepts its own derived address and refuses junk', () => {
		for (const chain of ['ic', 'evm', 'sol', 'btc'] as const) {
			const adapter = getAdapter(chain);

			expect(adapter.isValidAddress(adapter.deriveAddress(USER))).toBe(true);
			expect(adapter.isValidAddress('not an address')).toBe(false);
			expect(adapter.isValidAddress('')).toBe(false);
		}
	});

	test('ic refuses the anonymous principal and non-canonical text', () => {
		const ic = getAdapter('ic');

		expect(ic.isValidAddress('2vxsx-fae')).toBe(false);
		expect(ic.isValidAddress(ic.deriveAddress(USER).toUpperCase())).toBe(false);
	});

	test('evm accepts single-case hex and refuses a broken checksum', () => {
		const evm = getAdapter('evm');
		const address = evm.deriveAddress(USER);
		const body = address.slice(2);
		const flipped = body.replace(/[a-f]/, (c) => c.toUpperCase());

		expect(evm.isValidAddress(`0x${body.toLowerCase()}`)).toBe(true);
		expect(evm.isValidAddress(`0x${flipped}`)).toBe(flipped === body);
		expect(evm.isValidAddress(`0x${body.slice(1)}`)).toBe(false);
	});

	test('btc refuses an address of another network', () => {
		const privateKey = new Uint8Array(32).fill(7);
		const btc = getAdapter('btc');

		expect(btc.isValidAddress(btcAddressFromPrivateKey({ privateKey, network: 'mainnet' }))).toBe(
			true
		);
		expect(btc.isValidAddress(btcAddressFromPrivateKey({ privateKey, network: 'testnet' }))).toBe(
			false
		);
	});

	test('sol refuses base58 that is not a 32-byte key', () => {
		const sol = getAdapter('sol');
		const address = sol.deriveAddress(USER);

		expect(sol.isValidAddress(address.slice(0, -4))).toBe(false);
		expect(sol.isValidAddress(`${address}22`)).toBe(false);
	});

	test('isChain narrows correctly', () => {
		expect(isChain('ic')).toBe(true);
		expect(isChain('evm')).toBe(true);
		expect(isChain('dogecoin')).toBe(false);
	});
});

describe('chain env gating', () => {
	test('evm/sol/btc flip enabled with their env vars', () => {
		const env = loadEnv({
			EVM_RPC_URL: 'https://rpc.example',
			SOL_RPC_URL: 'https://sol.example',
			BTC_ESPLORA_URL: 'https://esplora.example'
		});

		expect(env.evm.enabled).toBe(true);
		expect(env.sol.enabled).toBe(true);
		expect(env.btc.enabled).toBe(true);
	});

	test('defaults keep them off and pin ic to mainnet', () => {
		const env = loadEnv({});

		expect(env.evm.enabled).toBe(false);
		expect(env.sol.enabled).toBe(false);
		expect(env.btc.enabled).toBe(false);
		expect(env.ic.host).toBe('https://icp-api.io');
	});

	test('rejects an unknown BTC_NETWORK', () => {
		expect(() => loadEnv({ BTC_NETWORK: 'mainnet2' })).toThrow('BTC_NETWORK');
	});

	test('parses the custody asset allowlist', () => {
		expect(loadEnv({}).custodyEnabledAssets).toBeNull();
		expect(loadEnv({ CUSTODY_ENABLED_ASSETS: 'VXP, ICP,evm:USDC' }).custodyEnabledAssets).toEqual([
			'VXP',
			'ICP',
			'evm:USDC'
		]);
	});
});
