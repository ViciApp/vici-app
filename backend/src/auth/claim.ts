// Signed principal handoff ("account claim"). The legacy on-chain app signs a
// short-lived claim payload with the user's delegated session key and hands
// the blob to this stack, which verifies the whole chain of custody off-chain:
//
//   1. the chain's root public key must derive the claimed principal
//      (self-authenticating id = sha224(root DER) + 0x02),
//   2. every delegation link must carry a valid signature by the key above it
//      (ed25519 / secp256k1 raw keys, WebAuthn passkeys, or canister
//      signatures certified by the IC root key),
//   3. no delegation may be expired,
//   4. the session key at the end of the chain must have signed the claim
//      message, whose issuedAtMs must sit inside a small freshness window.
//
// The blob carries no secret: it is a bearer proof of principal control,
// bounded by the freshness window and by the delegation expirations.

import { isNullish, nonNullish } from '@dfinity/utils';
import {
	Cbor,
	Certificate,
	DER_COSE_OID,
	ED25519_OID,
	IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR,
	IC_ROOT_KEY,
	lookup_path,
	LookupPathStatus,
	lookupResultToBuffer,
	reconstruct,
	requestIdOf,
	SECP256K1_OID,
	unwrapDER,
	type HashTree
} from '@icp-sdk/core/agent';
import { DelegationChain, type SignedDelegation } from '@icp-sdk/core/identity';
import { Principal } from '@icp-sdk/core/principal';
import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/p256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { hexToBytes } from '@noble/hashes/utils';

/** Wire audience tag; mirrored by the app's claim handoff util (pinned by the
 * shared-drift suite). */
export const CLAIM_AUDIENCE = 'vici-web2-claim';

/** How old an issuedAtMs may be before the blob is refused. */
export const CLAIM_FRESHNESS_MS = 10 * 60 * 1000;

/** Tolerated forward clock skew between the signing device and this server. */
export const CLAIM_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

/** Hard bound on delegation hops; real chains carry one or two links. */
const MAX_CHAIN_LENGTH = 4;

/** Canonical claim message text; must match the app-side builder exactly. */
export const claimMessageText = ({
	principal,
	issuedAtMs
}: {
	principal: string;
	issuedAtMs: number;
}): string => `${CLAIM_AUDIENCE}\n${principal}\n${issuedAtMs}`;

export const claimMessageBytes = (input: { principal: string; issuedAtMs: number }): Uint8Array =>
	new TextEncoder().encode(claimMessageText(input));

export type ClaimRejectReason =
	| 'malformed'
	| 'bad_audience'
	| 'stale_issued_at'
	| 'principal_mismatch'
	| 'expired_delegation'
	| 'bad_signature'
	| 'unsupported_key';

export type ClaimVerdict =
	{ ok: true; principal: string } | { ok: false; reason: ClaimRejectReason };

interface ClaimBlobPayload {
	v: number;
	aud: string;
	principal: string;
	issuedAtMs: number;
	chain: unknown;
	sig: string;
}

const parseBlob = (blob: string): ClaimBlobPayload | null => {
	try {
		const decoded: unknown = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8'));

		if (isNullish(decoded) || typeof decoded !== 'object') {
			return null;
		}

		const payload = decoded as Record<string, unknown>;

		if (
			payload.v !== 1 ||
			typeof payload.aud !== 'string' ||
			typeof payload.principal !== 'string' ||
			typeof payload.issuedAtMs !== 'number' ||
			!Number.isSafeInteger(payload.issuedAtMs) ||
			isNullish(payload.chain) ||
			typeof payload.chain !== 'object' ||
			typeof payload.sig !== 'string'
		) {
			return null;
		}

		return payload as unknown as ClaimBlobPayload;
	} catch {
		return null;
	}
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
	if (a.length !== b.length) {
		return false;
	}

	let diff = 0;

	for (let i = 0; i < a.length; i += 1) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}

	return diff === 0;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
};

const tryUnwrapDer = (der: Uint8Array, oid: Uint8Array): Uint8Array | null => {
	try {
		return unwrapDER(der, oid);
	} catch {
		return null;
	}
};

// DER `SEQUENCE(OID 1.3.6.1.4.1.56387.1.2)`: the IC canister-signature
// algorithm identifier (not exported by the agent package).
export const CANISTER_SIG_OID = new Uint8Array([
	0x30, 0x0c, 0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x83, 0xb8, 0x43, 0x01, 0x02
]);

export type BlsVerify = (
	pk: Uint8Array,
	sig: Uint8Array,
	msg: Uint8Array
) => Promise<boolean> | boolean;

export interface VerifyClaimOptions {
	blob: string;
	nowMs?: number;
	/** IC root key override (DER); tests certify synthetic canister
	 * signatures against their own key. */
	rootKey?: Uint8Array;
	blsVerify?: BlsVerify;
}

// ---------------------------------------------------------------------------
// Minimal CBOR reader for COSE keys. COSE maps use negative integer keys,
// which the agent's CBOR decoder drops silently, so the handful of major
// types a COSE_Key can contain are read by hand.

interface CborReader {
	bytes: Uint8Array;
	offset: number;
}

const readArgument = (reader: CborReader, info: number): number => {
	if (info < 24) {
		return info;
	}

	const lengths: Record<number, number> = { 24: 1, 25: 2, 26: 4 };
	const len = lengths[info];

	if (isNullish(len)) {
		throw new Error('unsupported cbor argument width');
	}

	let value = 0;

	for (let i = 0; i < len; i += 1) {
		const byte = reader.bytes[reader.offset];

		if (isNullish(byte)) {
			throw new Error('truncated cbor');
		}

		value = value * 256 + byte;
		reader.offset += 1;
	}

	return value;
};

type CoseValue = number | Uint8Array | string | CoseValue[] | Map<number, CoseValue>;

const readCoseValue = (reader: CborReader): CoseValue => {
	const head = reader.bytes[reader.offset];

	if (isNullish(head)) {
		throw new Error('truncated cbor');
	}

	reader.offset += 1;

	const major = head >> 5;
	const arg = readArgument(reader, head & 0x1f);

	switch (major) {
		case 0:
			return arg;
		case 1:
			return -1 - arg;

		case 2: {
			const value = reader.bytes.slice(reader.offset, reader.offset + arg);

			reader.offset += arg;

			return value;
		}

		case 3: {
			const value = new TextDecoder().decode(
				reader.bytes.slice(reader.offset, reader.offset + arg)
			);

			reader.offset += arg;

			return value;
		}

		case 4: {
			const items: CoseValue[] = [];

			for (let i = 0; i < arg; i += 1) {
				items.push(readCoseValue(reader));
			}

			return items;
		}

		case 5: {
			const map = new Map<number, CoseValue>();

			for (let i = 0; i < arg; i += 1) {
				const key = readCoseValue(reader);
				const value = readCoseValue(reader);

				if (typeof key === 'number') {
					map.set(key, value);
				}
			}

			return map;
		}

		default:
			throw new Error('unsupported cbor major type');
	}
};

const parseCoseKey = (coseBytes: Uint8Array): Map<number, CoseValue> => {
	const value = readCoseValue({ bytes: coseBytes, offset: 0 });

	if (!(value instanceof Map)) {
		throw new Error('cose key is not a map');
	}

	return value;
};

// COSE_Key labels and values (RFC 9052 / RFC 9053).
const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
const COSE_RSA_N = -1;
const COSE_RSA_E = -2;
const KTY_OKP = 1;
const KTY_EC2 = 2;
const KTY_RSA = 3;
const ALG_ES256 = -7;
const ALG_EDDSA = -8;
const ALG_RS256 = -257;
const CRV_P256 = 1;
const CRV_ED25519 = 6;

const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

interface WebauthnEnvelope {
	authenticator_data: Uint8Array;
	client_data_json: string;
	signature: Uint8Array;
}

/**
 * Verify a WebAuthn assertion produced as an IC signature: the challenge is
 * embedded in clientDataJSON and the authenticator signed
 * `authenticatorData || sha256(clientDataJSON)`.
 */
const verifyWebauthnSignature = async ({
	coseBytes,
	signature,
	message
}: {
	coseBytes: Uint8Array;
	signature: Uint8Array;
	message: Uint8Array;
}): Promise<boolean> => {
	let envelope: WebauthnEnvelope;

	try {
		envelope = Cbor.decode<WebauthnEnvelope>(signature);
	} catch {
		return false;
	}

	const {
		authenticator_data: authData,
		client_data_json: clientDataJson,
		signature: sig
	} = envelope;

	if (
		!(authData instanceof Uint8Array) ||
		typeof clientDataJson !== 'string' ||
		!(sig instanceof Uint8Array)
	) {
		return false;
	}

	try {
		const clientData = JSON.parse(clientDataJson) as { challenge?: unknown };

		if (clientData.challenge !== toBase64Url(message)) {
			return false;
		}
	} catch {
		return false;
	}

	const clientDataHash = sha256(new TextEncoder().encode(clientDataJson));
	const signedBytes = concatBytes(authData, clientDataHash);
	const cose = parseCoseKey(coseBytes);
	const kty = cose.get(COSE_KTY);
	const alg = cose.get(COSE_ALG);

	if (kty === KTY_EC2 && alg === ALG_ES256 && cose.get(COSE_CRV) === CRV_P256) {
		const x = cose.get(COSE_X);
		const y = cose.get(COSE_Y);

		if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
			return false;
		}

		try {
			const publicKey = concatBytes(new Uint8Array([0x04]), x, y);
			const compact = p256.Signature.fromDER(sig).toCompactRawBytes();

			return p256.verify(compact, sha256(signedBytes), publicKey);
		} catch {
			return false;
		}
	}

	if (kty === KTY_OKP && alg === ALG_EDDSA && cose.get(COSE_CRV) === CRV_ED25519) {
		const x = cose.get(COSE_X);

		if (!(x instanceof Uint8Array)) {
			return false;
		}

		try {
			return ed25519.verify(sig, signedBytes, x);
		} catch {
			return false;
		}
	}

	if (kty === KTY_RSA && alg === ALG_RS256) {
		const n = cose.get(COSE_RSA_N);
		const e = cose.get(COSE_RSA_E);

		if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
			return false;
		}

		try {
			const key = await crypto.subtle.importKey(
				'jwk',
				{ kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e) },
				{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
				false,
				['verify']
			);

			return await crypto.subtle.verify(
				'RSASSA-PKCS1-v1_5',
				key,
				Uint8Array.from(sig),
				Uint8Array.from(signedBytes)
			);
		} catch {
			return false;
		}
	}

	return false;
};

interface CanisterSigEnvelope {
	certificate: Uint8Array;
	tree: HashTree;
}

/**
 * Verify an IC canister signature (e.g. an Internet Identity delegation):
 * the signature is a certified hash-tree witness whose certificate the IC
 * root key vouches for, sealing `sig/sha256(seed)/sha256(message)` in the
 * canister's certified data.
 */
const verifyCanisterSignature = async ({
	derKey,
	signature,
	message,
	rootKey,
	blsVerify
}: {
	derKey: Uint8Array;
	signature: Uint8Array;
	message: Uint8Array;
	rootKey: Uint8Array;
	blsVerify?: BlsVerify;
}): Promise<boolean> => {
	const blob = tryUnwrapDer(derKey, CANISTER_SIG_OID);

	if (isNullish(blob) || blob.length < 1) {
		return false;
	}

	const idLength = blob[0] ?? 0;

	if (blob.length < 1 + idLength) {
		return false;
	}

	const canisterId = Principal.fromUint8Array(blob.slice(1, 1 + idLength));
	const seed = blob.slice(1 + idLength);

	let envelope: CanisterSigEnvelope;

	try {
		envelope = Cbor.decode<CanisterSigEnvelope>(signature);
	} catch {
		return false;
	}

	if (!(envelope.certificate instanceof Uint8Array) || isNullish(envelope.tree)) {
		return false;
	}

	try {
		// The certificate was signed when the user logged in on the legacy app,
		// possibly days before the claim: freshness comes from the delegation
		// expirations checked by the caller, not from certificate time.
		const certificate = await Certificate.create({
			certificate: envelope.certificate,
			rootKey,
			principal: { canisterId },
			disableTimeVerification: true,
			...(nonNullish(blsVerify) ? { blsVerify } : {})
		});

		const certifiedData = lookupResultToBuffer(
			certificate.lookup_path(['canister', canisterId.toUint8Array(), 'certified_data'])
		);

		if (isNullish(certifiedData)) {
			return false;
		}

		const treeRoot = await reconstruct(envelope.tree);

		if (!bytesEqual(certifiedData, treeRoot)) {
			return false;
		}

		const witness = lookup_path(
			[new TextEncoder().encode('sig'), sha256(seed), sha256(message)],
			envelope.tree
		);

		return witness.status === LookupPathStatus.Found && witness.value.length === 0;
	} catch {
		return false;
	}
};

/**
 * Verify `signature` over `message` against a DER-encoded public key,
 * dispatching on the key's algorithm OID.
 */
const verifySignatureWithDerKey = async ({
	derKey,
	signature,
	message,
	rootKey,
	blsVerify
}: {
	derKey: Uint8Array;
	signature: Uint8Array;
	message: Uint8Array;
	rootKey: Uint8Array;
	blsVerify?: BlsVerify;
}): Promise<{ ok: boolean; reason: 'bad_signature' | 'unsupported_key' }> => {
	const ed = tryUnwrapDer(derKey, ED25519_OID);

	if (nonNullish(ed)) {
		try {
			return { ok: ed25519.verify(signature, message, ed), reason: 'bad_signature' };
		} catch {
			return { ok: false, reason: 'bad_signature' };
		}
	}

	const secp = tryUnwrapDer(derKey, SECP256K1_OID);

	if (nonNullish(secp)) {
		try {
			return {
				ok: secp256k1.verify(signature, sha256(message), secp),
				reason: 'bad_signature'
			};
		} catch {
			return { ok: false, reason: 'bad_signature' };
		}
	}

	const cose = tryUnwrapDer(derKey, DER_COSE_OID);

	if (nonNullish(cose)) {
		const ok = await verifyWebauthnSignature({ coseBytes: cose, signature, message });

		return { ok, reason: 'bad_signature' };
	}

	if (nonNullish(tryUnwrapDer(derKey, CANISTER_SIG_OID))) {
		const ok = await verifyCanisterSignature({ derKey, signature, message, rootKey, blsVerify });

		return { ok, reason: 'bad_signature' };
	}

	return { ok: false, reason: 'unsupported_key' };
};

const delegationChallenge = (signed: SignedDelegation): Uint8Array =>
	concatBytes(IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR, requestIdOf({ ...signed.delegation }));

/**
 * Verify a claim blob end to end; the verdict carries the proven principal
 * on success and a stable rejection reason otherwise.
 */
export const verifyClaimBlob = async ({
	blob,
	nowMs = Date.now(),
	rootKey = hexToBytes(IC_ROOT_KEY),
	blsVerify
}: VerifyClaimOptions): Promise<ClaimVerdict> => {
	const payload = parseBlob(blob);

	if (isNullish(payload)) {
		return { ok: false, reason: 'malformed' };
	}

	if (payload.aud !== CLAIM_AUDIENCE) {
		return { ok: false, reason: 'bad_audience' };
	}

	if (
		nowMs - payload.issuedAtMs > CLAIM_FRESHNESS_MS ||
		payload.issuedAtMs - nowMs > CLAIM_MAX_FUTURE_SKEW_MS
	) {
		return { ok: false, reason: 'stale_issued_at' };
	}

	let chain: DelegationChain;

	try {
		chain = DelegationChain.fromJSON(JSON.stringify(payload.chain));
	} catch {
		return { ok: false, reason: 'malformed' };
	}

	if (chain.delegations.length > MAX_CHAIN_LENGTH) {
		return { ok: false, reason: 'malformed' };
	}

	const rootDer = new Uint8Array(chain.publicKey);
	const claimedPrincipal = Principal.selfAuthenticating(rootDer);

	if (claimedPrincipal.toText() !== payload.principal) {
		return { ok: false, reason: 'principal_mismatch' };
	}

	const nowNs = BigInt(nowMs) * 1_000_000n;

	for (const signed of chain.delegations) {
		if (signed.delegation.expiration <= nowNs) {
			return { ok: false, reason: 'expired_delegation' };
		}
	}

	// Walk the chain: each link must be signed by the key above it, starting
	// from the root key that derives the principal.
	let signerDer = rootDer;

	for (const signed of chain.delegations) {
		const result = await verifySignatureWithDerKey({
			derKey: signerDer,
			signature: new Uint8Array(signed.signature),
			message: delegationChallenge(signed),
			rootKey,
			blsVerify
		});

		if (!result.ok) {
			return { ok: false, reason: result.reason };
		}

		signerDer = new Uint8Array(signed.delegation.pubkey);
	}

	// The delegated session key (or the root key itself for a chain with no
	// links) must have signed the claim message.
	let sessionSignature: Uint8Array;

	try {
		sessionSignature = new Uint8Array(Buffer.from(payload.sig, 'base64url'));
	} catch {
		return { ok: false, reason: 'malformed' };
	}

	if (sessionSignature.length === 0) {
		return { ok: false, reason: 'malformed' };
	}

	const message = claimMessageBytes({
		principal: payload.principal,
		issuedAtMs: payload.issuedAtMs
	});
	const result = await verifySignatureWithDerKey({
		derKey: signerDer,
		signature: sessionSignature,
		message,
		rootKey,
		blsVerify
	});

	if (!result.ok) {
		return { ok: false, reason: result.reason };
	}

	return { ok: true, principal: payload.principal };
};
