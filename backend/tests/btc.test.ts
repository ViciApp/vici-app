// Bitcoin address vectors: the BIP173 P2WPKH example chain, which starts from
// the canonical private key 1 (the secp256k1 generator point pubkey).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'bun:test';
import { btcAddressFromPrivateKey, hash160, p2wpkhAddress } from '../src/chains/btc/address';

const PRIVATE_KEY_ONE = hexToBytes(
	'0000000000000000000000000000000000000000000000000000000000000001'
);

describe('p2wpkh derivation (BIP173 vectors)', () => {
	test('private key 1 compresses to the generator pubkey', () => {
		expect(bytesToHex(secp256k1.getPublicKey(PRIVATE_KEY_ONE, true))).toBe(
			'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
		);
	});

	test('hash160 of the generator pubkey matches the BIP173 witness program', () => {
		const publicKey = secp256k1.getPublicKey(PRIVATE_KEY_ONE, true);

		expect(bytesToHex(hash160(publicKey))).toBe('751e76e8199196d454941c45d1b3a323f1433bd6');
	});

	test('mainnet address matches the BIP173 example', () => {
		expect(btcAddressFromPrivateKey({ privateKey: PRIVATE_KEY_ONE, network: 'mainnet' })).toBe(
			'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
		);
	});

	test('testnet address matches the BIP173 example', () => {
		expect(btcAddressFromPrivateKey({ privateKey: PRIVATE_KEY_ONE, network: 'testnet' })).toBe(
			'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
		);
	});

	test('regtest uses the bcrt prefix', () => {
		const publicKey = secp256k1.getPublicKey(PRIVATE_KEY_ONE, true);

		expect(p2wpkhAddress({ publicKey, network: 'regtest' }).startsWith('bcrt1q')).toBe(true);
	});
});
