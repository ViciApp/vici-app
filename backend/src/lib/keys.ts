// Custodial key derivation. Every user key is HKDF-SHA256 derived from the
// single ROOT_SECRET with a per-user per-chain info string, so the database
// stores NO key material: addresses are re-derivable from (userId, chain) and
// a leak of the database alone cannot spend anything.
//
// Curve per chain: ic and sol sign with ed25519 (the 32-byte HKDF output is
// the seed), evm and btc sign with secp256k1 (the output is the scalar,
// re-derived with a counter suffix in the astronomically unlikely case it
// falls outside the valid range).
//
// Service (treasury / admin) keys use a distinct `svc:` info prefix so they
// can never collide with a user key even if a user id were attacker-chosen.
// PEM env vars (TREASURY_PEM / ADMIN_PEM) override the derived service keys
// for deployments that keep those keys off-box; the overrides are loaded via
// Secp256k1KeyIdentity, so supply secp256k1 PEMs there even though derived
// ic keys are ed25519.

import type { SignIdentity } from '@icp-sdk/core/agent';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { env } from '../env';

export type Chain = 'ic' | 'evm' | 'sol' | 'btc';

export const CHAINS: readonly Chain[] = ['ic', 'evm', 'sol', 'btc'] as const;

const ED25519_CHAINS: ReadonlySet<Chain> = new Set(['ic', 'sol']);

const HKDF_SALT = new TextEncoder().encode('vici-custody-hkdf');

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const deriveBytes = (info: string): Uint8Array =>
	hkdf(sha256, utf8(env.rootSecret), HKDF_SALT, utf8(info), 32);

const deriveForCurve = (info: string, chain: Chain): Uint8Array => {
	if (ED25519_CHAINS.has(chain)) {
		// Any 32 bytes are a valid ed25519 seed.
		return deriveBytes(info);
	}

	// secp256k1 scalars must be in [1, n): re-derive with a counter suffix on
	// the ~2^-128 chance the output is out of range, keeping determinism.
	for (let counter = 0; counter < 8; counter++) {
		const candidate = deriveBytes(counter === 0 ? info : `${info}:${counter}`);

		if (secp256k1.utils.isValidPrivateKey(candidate)) {
			return candidate;
		}
	}

	throw new Error('key derivation failed to produce a valid secp256k1 scalar');
};

/** The 32-byte private key (ed25519 seed or secp256k1 scalar) for a user on a
 * chain. Deterministic for a fixed ROOT_SECRET. */
export const deriveUserKey = ({ userId, chain }: { userId: string; chain: Chain }): Uint8Array =>
	deriveForCurve(`user:${userId}:${chain}`, chain);

/** A service-scoped key (treasury, admin, ...). The `svc:` prefix keeps the
 * derivation space disjoint from user keys. */
export const deriveServiceKey = ({ name, chain }: { name: string; chain: Chain }): Uint8Array =>
	deriveForCurve(`svc:${name}:${chain}`, chain);

/** The public key bytes for a derived key on its chain's curve. */
export const publicKeyForChain = ({
	privateKey,
	chain
}: {
	privateKey: Uint8Array;
	chain: Chain;
}): Uint8Array =>
	ED25519_CHAINS.has(chain)
		? ed25519.getPublicKey(privateKey)
		: secp256k1.getPublicKey(privateKey, true);

/** The user's custodial IC identity: signs engine calls and ICRC transfers on
 * the user's behalf. */
export const userIcIdentity = (userId: string): Ed25519KeyIdentity =>
	Ed25519KeyIdentity.fromSecretKey(deriveUserKey({ userId, chain: 'ic' }));

/** The user's custodial IC principal (their on-chain deposit address). */
export const userIcPrincipalText = (userId: string): string =>
	userIcIdentity(userId).getPrincipal().toText();

const serviceIcIdentity = ({ name, pem }: { name: string; pem: string }): SignIdentity =>
	pem !== ''
		? Secp256k1KeyIdentity.fromPem(pem)
		: Ed25519KeyIdentity.fromSecretKey(deriveServiceKey({ name, chain: 'ic' }));

/** The treasury identity: holds pooled funds and signs payout transfers. */
export const treasuryIcIdentity = (): SignIdentity =>
	serviceIcIdentity({ name: 'treasury', pem: env.treasuryPem });

/** The treasury's IC principal: public, and the account the VXP minter must
 * register as a reserve before award payouts can draw on it. */
export const treasuryIcPrincipalText = (): string => treasuryIcIdentity().getPrincipal().toText();

/** The admin identity: signs privileged engine calls (settlement, registry
 * role management). Separate from the treasury so payout and governance keys
 * can rotate independently. */
export const adminIcIdentity = (): SignIdentity =>
	serviceIcIdentity({ name: 'admin', pem: env.adminPem });
