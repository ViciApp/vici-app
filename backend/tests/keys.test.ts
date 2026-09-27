// Derivation invariants for the custodial key scheme: determinism under a
// fixed ROOT_SECRET (pinned in tests/helpers/setup.ts), distinctness across
// users / chains / service scopes, and curve validity of every output.

import { secp256k1 } from '@noble/curves/secp256k1';
import { describe, expect, test } from 'bun:test';
import {
	adminIcIdentity,
	CHAINS,
	deriveServiceKey,
	deriveUserKey,
	engineReaderIcIdentity,
	publicKeyForChain,
	treasuryIcIdentity,
	userIcIdentity,
	userIcPrincipalText
} from '../src/lib/keys';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('deriveUserKey', () => {
	test('is deterministic for a fixed root secret', () => {
		for (const chain of CHAINS) {
			expect(hex(deriveUserKey({ userId: USER_A, chain }))).toBe(
				hex(deriveUserKey({ userId: USER_A, chain }))
			);
		}
	});

	test('differs across users on every chain', () => {
		for (const chain of CHAINS) {
			expect(hex(deriveUserKey({ userId: USER_A, chain }))).not.toBe(
				hex(deriveUserKey({ userId: USER_B, chain }))
			);
		}
	});

	test('differs across chains for the same user', () => {
		const keys = CHAINS.map((chain) => hex(deriveUserKey({ userId: USER_A, chain })));

		expect(new Set(keys).size).toBe(CHAINS.length);
	});

	test('secp256k1 outputs are valid scalars', () => {
		for (const chain of ['evm', 'btc'] as const) {
			expect(secp256k1.utils.isValidPrivateKey(deriveUserKey({ userId: USER_A, chain }))).toBe(
				true
			);
		}
	});

	test('public keys derive on the right curve (32B ed25519, 33B secp)', () => {
		expect(
			publicKeyForChain({ privateKey: deriveUserKey({ userId: USER_A, chain: 'ic' }), chain: 'ic' })
				.length
		).toBe(32);
		expect(
			publicKeyForChain({
				privateKey: deriveUserKey({ userId: USER_A, chain: 'evm' }),
				chain: 'evm'
			}).length
		).toBe(33);
	});
});

describe('service keys', () => {
	test('svc scope never collides with a user scope of the same id', () => {
		// Even an attacker-chosen user id cannot reach the svc derivation space:
		// the info prefixes differ.
		expect(hex(deriveServiceKey({ name: 'treasury', chain: 'ic' }))).not.toBe(
			hex(deriveUserKey({ userId: 'treasury', chain: 'ic' }))
		);
	});

	test('treasury and admin identities are distinct from each other and users', () => {
		const treasury = treasuryIcIdentity().getPrincipal().toText();
		const user = userIcPrincipalText(USER_A);

		expect(treasury).not.toBe(user);
		expect(hex(deriveServiceKey({ name: 'treasury', chain: 'ic' }))).not.toBe(
			hex(deriveServiceKey({ name: 'admin', chain: 'ic' }))
		);
	});

	test('the engine reader is a stable, non-anonymous principal of its own', () => {
		const reader = engineReaderIcIdentity().getPrincipal();

		expect(reader.isAnonymous()).toBe(false);
		expect(reader.toText()).toBe(engineReaderIcIdentity().getPrincipal().toText());
		expect(reader.toText()).not.toBe(adminIcIdentity().getPrincipal().toText());
		expect(reader.toText()).not.toBe(treasuryIcIdentity().getPrincipal().toText());
		expect(reader.toText()).not.toBe(userIcPrincipalText(USER_A));
		expect(hex(deriveServiceKey({ name: 'engine-reader', chain: 'ic' }))).not.toBe(
			hex(deriveUserKey({ userId: 'engine-reader', chain: 'ic' }))
		);
	});
});

describe('userIcIdentity', () => {
	test('yields a stable principal per user', () => {
		expect(userIcIdentity(USER_A).getPrincipal().toText()).toBe(userIcPrincipalText(USER_A));
		expect(userIcPrincipalText(USER_A)).not.toBe(userIcPrincipalText(USER_B));
	});
});
