// Account-claim verification and linking. The verifier suites are pure (no
// DB): test vectors are minted with the same identity primitives the legacy
// app uses. The route suites exercise the linking semantics against Postgres.

import {
	blsVerify,
	Cbor,
	DER_COSE_OID,
	domain_sep,
	IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR,
	IC_ROOT_KEY,
	NodeType,
	reconstruct,
	requestIdOf,
	wrapDER,
	type DerEncodedPublicKey,
	type HashTree,
	type Signature
} from '@icp-sdk/core/agent';
import {
	Delegation,
	DelegationChain,
	Ed25519KeyIdentity,
	type SignedDelegation
} from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import { Principal } from '@icp-sdk/core/principal';
import { bls12_381 } from '@noble/curves/bls12-381';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { hexToBytes } from '@noble/hashes/utils';
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
	CANISTER_SIG_OID,
	CLAIM_AUDIENCE,
	CLAIM_FRESHNESS_MS,
	claimMessageBytes,
	verifyClaimBlob
} from '../src/auth/claim';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { ZERO } from '../src/lib/constants';
import { resetRateLimits } from '../src/lib/rate-limit';
import { createTestUser, ensureMigrated, uniquePrincipal } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const HOUR_MS = 60 * 60 * 1000;

const encodeBlob = (payload: Record<string, unknown>): string =>
	Buffer.from(JSON.stringify(payload)).toString('base64url');

interface HandoffOptions {
	expiresAt?: Date;
	issuedAtMs?: number;
	principalOverride?: string;
	signWith?: Ed25519KeyIdentity;
	aud?: string;
}

/** Mint a claim blob exactly like the legacy app does: an ed25519 root key
 * delegates to an ed25519 session key, which signs the claim message. */
const mintHandoff = async ({
	expiresAt = new Date(Date.now() + HOUR_MS),
	issuedAtMs = Date.now(),
	principalOverride,
	signWith,
	aud = CLAIM_AUDIENCE
}: HandoffOptions = {}): Promise<{ blob: string; principal: string }> => {
	const root = Ed25519KeyIdentity.generate();
	const session = Ed25519KeyIdentity.generate();
	const chain = await DelegationChain.create(root, session.getPublicKey(), expiresAt);
	const principal = Principal.selfAuthenticating(
		new Uint8Array(root.getPublicKey().toDer())
	).toText();
	const claimed = principalOverride ?? principal;
	const signer = signWith ?? session;
	const signature = await signer.sign(claimMessageBytes({ principal: claimed, issuedAtMs }));

	return {
		blob: encodeBlob({
			v: 1,
			aud,
			principal: claimed,
			issuedAtMs,
			chain: chain.toJSON(),
			sig: Buffer.from(signature).toString('base64url')
		}),
		principal
	};
};

describe('verifyClaimBlob', () => {
	test('accepts a fresh ed25519 handoff and proves the root principal', async () => {
		const { blob, principal } = await mintHandoff();
		const verdict = await verifyClaimBlob({ blob });

		expect(verdict).toEqual({ ok: true, principal });
	});

	test('accepts a secp256k1 root delegating to an ed25519 session key', async () => {
		const root = Secp256k1KeyIdentity.generate();
		const session = Ed25519KeyIdentity.generate();
		const chain = await DelegationChain.create(
			root,
			session.getPublicKey(),
			new Date(Date.now() + HOUR_MS)
		);
		const principal = Principal.selfAuthenticating(
			new Uint8Array(root.getPublicKey().toDer())
		).toText();
		const issuedAtMs = Date.now();
		const signature = await session.sign(claimMessageBytes({ principal, issuedAtMs }));
		const blob = encodeBlob({
			v: 1,
			aud: CLAIM_AUDIENCE,
			principal,
			issuedAtMs,
			chain: chain.toJSON(),
			sig: Buffer.from(signature).toString('base64url')
		});

		expect(await verifyClaimBlob({ blob })).toEqual({ ok: true, principal });
	});

	test('rejects a claim signed by a key outside the delegation chain', async () => {
		const { blob } = await mintHandoff({ signWith: Ed25519KeyIdentity.generate() });

		expect(await verifyClaimBlob({ blob })).toEqual({ ok: false, reason: 'bad_signature' });
	});

	test('rejects a payload claiming a different principal', async () => {
		const { blob } = await mintHandoff({ principalOverride: uniquePrincipalText() });

		expect(await verifyClaimBlob({ blob })).toEqual({
			ok: false,
			reason: 'principal_mismatch'
		});
	});

	test('rejects an expired delegation', async () => {
		const { blob } = await mintHandoff({ expiresAt: new Date(Date.now() - 1000) });

		expect(await verifyClaimBlob({ blob })).toEqual({
			ok: false,
			reason: 'expired_delegation'
		});
	});

	test('rejects a stale issuedAtMs', async () => {
		const { blob } = await mintHandoff({
			issuedAtMs: Date.now() - CLAIM_FRESHNESS_MS - 1000
		});

		expect(await verifyClaimBlob({ blob })).toEqual({ ok: false, reason: 'stale_issued_at' });
	});

	test('rejects an issuedAtMs from the future beyond skew', async () => {
		const { blob } = await mintHandoff({ issuedAtMs: Date.now() + HOUR_MS });

		expect(await verifyClaimBlob({ blob })).toEqual({ ok: false, reason: 'stale_issued_at' });
	});

	test('rejects a wrong audience', async () => {
		const { blob } = await mintHandoff({ aud: 'some-other-aud' });

		expect(await verifyClaimBlob({ blob })).toEqual({ ok: false, reason: 'bad_audience' });
	});

	test('rejects garbage blobs', async () => {
		expect(await verifyClaimBlob({ blob: 'not-a-blob' })).toEqual({
			ok: false,
			reason: 'malformed'
		});
		expect(await verifyClaimBlob({ blob: encodeBlob({ v: 2 }) })).toEqual({
			ok: false,
			reason: 'malformed'
		});
	});

	test('rejects a tampered message (issuedAtMs rewritten after signing)', async () => {
		const issuedAtMs = Date.now() - 1000;
		const { blob } = await mintHandoff({ issuedAtMs });
		const payload = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8')) as Record<
			string,
			unknown
		>;

		payload.issuedAtMs = issuedAtMs + 1;

		expect(await verifyClaimBlob({ blob: encodeBlob(payload) })).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});
});

const uniquePrincipalText = (): string =>
	Principal.selfAuthenticating(
		new Uint8Array(Ed25519KeyIdentity.generate().getPublicKey().toDer())
	).toText();

// ---------------------------------------------------------------------------
// WebAuthn-rooted chain (passkey shape): the root key is a DER-wrapped COSE
// key and the delegation link signature is the authenticator envelope.

const coseP256Key = (publicKey: Uint8Array): Uint8Array => {
	// Uncompressed SEC1 point: 0x04 || x || y.
	const x = publicKey.slice(1, 33);
	const y = publicKey.slice(33, 65);

	return new Uint8Array([
		0xa5,
		0x01,
		0x02, // kty: EC2
		0x03,
		0x26, // alg: ES256
		0x20,
		0x01, // crv: P-256
		0x21,
		0x58,
		0x20,
		...x, // x
		0x22,
		0x58,
		0x20,
		...y // y
	]);
};

describe('verifyClaimBlob (webauthn root)', () => {
	test('accepts an ES256 passkey delegating to an ed25519 session key', async () => {
		const priv = p256.utils.randomPrivateKey();
		const pub = p256.getPublicKey(priv, false);
		const cose = coseP256Key(pub);
		const rootDer = wrapDER(cose, DER_COSE_OID) as DerEncodedPublicKey;

		const webauthnSign = (challenge: Uint8Array): Uint8Array => {
			const clientDataJson = JSON.stringify({
				type: 'webauthn.get',
				challenge: Buffer.from(challenge).toString('base64url'),
				origin: 'https://vici.market'
			});
			const authData = new Uint8Array(37).fill(7);
			const signedBytes = new Uint8Array([
				...authData,
				...sha256(new TextEncoder().encode(clientDataJson))
			]);
			const signature = p256.sign(sha256(signedBytes), priv).toDERRawBytes();

			return Cbor.encode({
				authenticator_data: authData,
				client_data_json: clientDataJson,
				signature
			});
		};

		const session = Ed25519KeyIdentity.generate();
		const expiration = BigInt(Date.now() + HOUR_MS) * 1_000_000n;
		const delegation = new Delegation(new Uint8Array(session.getPublicKey().toDer()), expiration);
		const challenge = new Uint8Array([
			...IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR,
			...requestIdOf({ ...delegation })
		]);
		const signed: SignedDelegation = {
			delegation,
			signature: webauthnSign(challenge) as Signature
		};
		const chain = DelegationChain.fromDelegations([signed], rootDer);
		const principal = Principal.selfAuthenticating(new Uint8Array(rootDer)).toText();
		const issuedAtMs = Date.now();
		const sig = await session.sign(claimMessageBytes({ principal, issuedAtMs }));
		const blob = encodeBlob({
			v: 1,
			aud: CLAIM_AUDIENCE,
			principal,
			issuedAtMs,
			chain: chain.toJSON(),
			sig: Buffer.from(sig).toString('base64url')
		});

		expect(await verifyClaimBlob({ blob })).toEqual({ ok: true, principal });
	});
});

// ---------------------------------------------------------------------------
// Canister-signature-rooted chain (Internet Identity shape): a synthetic
// certificate signed with a test BLS key stands in for the IC, injected
// through the verifier's rootKey override.

const lebEncode = (value: bigint): Uint8Array => {
	const bytes: number[] = [];
	let rest = value;

	do {
		let byte = Number(rest & BigInt(0x7f));

		rest >>= BigInt(7);

		if (rest > ZERO) {
			byte |= 0x80;
		}

		bytes.push(byte);
	} while (rest > ZERO);

	return new Uint8Array(bytes);
};

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('verifyClaimBlob (canister-signature root)', () => {
	test('accepts an II-style chain certified by the (test) root key', async () => {
		const canisterId = Principal.fromText('rdmx6-jaaaa-aaaaa-aaadq-cai');
		const seed = new Uint8Array(32).fill(9);
		const idBytes = canisterId.toUint8Array();
		const rootDer = wrapDER(
			new Uint8Array([idBytes.length, ...idBytes, ...seed]),
			CANISTER_SIG_OID
		) as DerEncodedPublicKey;

		const session = Ed25519KeyIdentity.generate();
		const expiration = BigInt(Date.now() + HOUR_MS) * 1_000_000n;
		const delegation = new Delegation(new Uint8Array(session.getPublicKey().toDer()), expiration);
		const challenge = new Uint8Array([
			...IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR,
			...requestIdOf({ ...delegation })
		]);

		// The canister's sig tree seals sha256(seed)/sha256(challenge); its root
		// hash is the canister's certified data inside the state tree.
		const labeled = (label: Uint8Array, sub: HashTree): HashTree => [
			NodeType.Labeled,
			label as never,
			sub
		];
		const leaf = (value: Uint8Array): HashTree => [NodeType.Leaf, value as never];
		const sigTree: HashTree = labeled(
			utf8('sig'),
			labeled(sha256(seed), labeled(sha256(challenge), leaf(new Uint8Array(0))))
		);
		const certifiedData = await reconstruct(sigTree);
		const stateTree: HashTree = [
			NodeType.Fork,
			labeled(
				utf8('canister'),
				labeled(idBytes, labeled(utf8('certified_data'), leaf(certifiedData)))
			),
			labeled(utf8('time'), leaf(lebEncode(BigInt(Date.now()) * 1_000_000n)))
		];
		const rootHash = await reconstruct(stateTree);
		const blsPriv = bls12_381.utils.randomPrivateKey();
		const blsPub = bls12_381.getPublicKeyForShortSignatures(blsPriv);
		const message = new Uint8Array([...domain_sep('ic-state-root'), ...rootHash]);
		const blsSig = bls12_381.signShortSignature(message, blsPriv);

		// Sanity: the synthetic signature verifies under the agent's BLS suite.
		expect(blsVerify(blsPub, blsSig, message)).toBe(true);

		const certificate = Cbor.encode({ tree: stateTree, signature: blsSig });
		const canisterSignature = Cbor.encode({ certificate, tree: sigTree });
		const signed: SignedDelegation = {
			delegation,
			signature: canisterSignature as Signature
		};
		const chain = DelegationChain.fromDelegations([signed], rootDer);
		const principal = Principal.selfAuthenticating(new Uint8Array(rootDer)).toText();
		const issuedAtMs = Date.now();
		const sig = await session.sign(claimMessageBytes({ principal, issuedAtMs }));
		const blob = encodeBlob({
			v: 1,
			aud: CLAIM_AUDIENCE,
			principal,
			issuedAtMs,
			chain: chain.toJSON(),
			sig: Buffer.from(sig).toString('base64url')
		});

		// The DER prefix of the production root key, spliced onto the test BLS
		// public key so extraction inside certificate verification matches.
		const testRootKey = new Uint8Array([...hexToBytes(IC_ROOT_KEY).slice(0, 37), ...blsPub]);

		expect(await verifyClaimBlob({ blob, rootKey: testRootKey })).toEqual({
			ok: true,
			principal
		});

		// The same blob against the REAL root key must fail: the certificate is
		// not vouched for by the IC.
		expect(await verifyClaimBlob({ blob })).toEqual({ ok: false, reason: 'bad_signature' });
	});
});

// ---------------------------------------------------------------------------
// Route semantics against Postgres.

describe.if(dbAvailable)('POST /api/v1/claim', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	const post = async (blob: string, token?: string): Promise<Response> =>
		await app.handle(
			new Request('http://localhost/api/v1/claim', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(token ? { cookie: `vici_session=${token}` } : {})
				},
				body: JSON.stringify({ blob })
			})
		);

	test('links a verified principal to the calling account', async () => {
		const userId = await createTestUser();
		const token = await createSession(userId);
		const { blob, principal } = await mintHandoff();
		const res = await post(blob, token);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, principal, alreadyLinked: false });

		const rows = await query<{ user_id: string; matched_via: string }>(
			`select user_id, matched_via from legacy_principals where principal = $1`,
			[principal]
		);

		expect(rows).toEqual([{ user_id: userId, matched_via: 'claim' }]);
	});

	test('is idempotent for the same account', async () => {
		const userId = await createTestUser();
		const token = await createSession(userId);
		const { blob, principal } = await mintHandoff();

		expect((await post(blob, token)).status).toBe(200);

		const res = await post(blob, token);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, principal, alreadyLinked: true });
	});

	test('answers a stable 409 when the principal belongs to another account', async () => {
		const first = await createTestUser();
		const second = await createTestUser();
		const { blob } = await mintHandoff();

		expect((await post(blob, await createSession(first))).status).toBe(200);

		const res = await post(blob, await createSession(second));

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'principal_already_linked' });
	});

	test('rejects unauthenticated calls', async () => {
		const { blob } = await mintHandoff();
		const res = await post(blob);

		expect(res.status).toBe(401);
	});

	test('rejects an invalid blob with a stable code', async () => {
		const token = await createSession(await createTestUser());
		const res = await post('garbage', token);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid_claim' });
	});

	test('rejects an expired delegation with a stable code', async () => {
		const token = await createSession(await createTestUser());
		const { blob } = await mintHandoff({ expiresAt: new Date(Date.now() - 1000) });
		const res = await post(blob, token);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'expired_delegation' });
	});

	test('rejects a stale issuedAtMs with a stable code', async () => {
		const token = await createSession(await createTestUser());
		const { blob } = await mintHandoff({
			issuedAtMs: Date.now() - CLAIM_FRESHNESS_MS - 1000
		});
		const res = await post(blob, token);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'stale_claim' });
	});
});

describe.if(dbAvailable)('legacy_principals matched_via constraint', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test("accepts 'claim' after the migration", async () => {
		const userId = await createTestUser();
		const principal = uniquePrincipal();

		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'claim')`,
			[principal, userId]
		);

		const rows = await query<{ matched_via: string }>(
			`select matched_via from legacy_principals where principal = $1`,
			[principal]
		);

		expect(rows).toEqual([{ matched_via: 'claim' }]);
	});

	test('still rejects unknown matched_via values', async () => {
		const userId = await createTestUser();

		await expect(
			query(
				`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'bogus')`,
				[uniquePrincipal(), userId]
			)
		).rejects.toThrow();
	});
});
