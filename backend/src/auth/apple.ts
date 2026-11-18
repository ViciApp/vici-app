// Sign in with Apple: OAuth 2.0 authorization-code flow with two Apple
// twists. The client secret is a short-lived ES256 JWT signed with the
// developer .p8 key, and requesting the name/email scope forces
// response_mode=form_post, so the callback is a cross-site POST. The code
// exchange happens directly with Apple over TLS, so the id_token payload can
// be decoded without a separate signature check (same trust model as
// google.ts's userinfo call).
//
// The whole module is env-gated: with APPLE_CLIENT_ID (or the signing trio)
// unset, the routes answer 503 provider_unavailable and the providers
// endpoint reports apple as coming_soon.

import { isNullish } from '@dfinity/utils';
import { env, type AppleEnv } from '../env';

const AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';

const redirectUri = (config: AppleEnv): string =>
	config.redirectUri !== '' ? config.redirectUri : `${env.apiBaseUrl}/api/v1/auth/apple/callback`;

export interface AppleProfile {
	sub: string;
	email: string;
	emailVerified: boolean;
}

const base64UrlEncode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

const base64UrlDecodeToString = (value: string): string =>
	Buffer.from(value, 'base64url').toString('utf8');

/** Import the .p8 PKCS#8 key for ES256 signing. */
const importPrivateKey = (config: AppleEnv): Promise<CryptoKey> => {
	const pem = config.privateKey
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\s/g, '');

	return crypto.subtle.importKey(
		'pkcs8',
		Buffer.from(pem, 'base64'),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
};

/** Normalize an ECDSA P-256 signature to the raw 64-byte r||s JWS form.
 * Spec-compliant WebCrypto already returns that; a DER-encoded SEQUENCE
 * (0x30 ...) from a non-compliant runtime is converted. */
const toJoseSignature = (sig: Uint8Array): Uint8Array => {
	if (sig.length === 64) {
		return sig;
	}

	if (sig[0] !== 0x30) {
		throw new Error(`Unexpected ECDSA signature format (len=${sig.length})`);
	}

	// DER: 0x30 len 0x02 rLen r 0x02 sLen s. Strip padding, left-pad to 32.
	const readInt = (offset: number): { bytes: Uint8Array; next: number } => {
		const len = sig[offset + 1];

		if (sig[offset] !== 0x02 || isNullish(len)) {
			throw new Error('Malformed DER signature');
		}

		let start = offset + 2;
		const end = start + len;

		while (start < end - 1 && sig[start] === 0x00) {
			start += 1;
		}

		return { bytes: sig.slice(start, end), next: end };
	};

	const r = readInt(2);
	const s = readInt(r.next);
	const out = new Uint8Array(64);

	out.set(r.bytes, 32 - r.bytes.length);
	out.set(s.bytes, 64 - s.bytes.length);

	return out;
};

/** The client secret Apple expects: an ES256 JWT signed with the .p8 key.
 * `config` is injectable for tests; production callers use the env default. */
export const clientSecret = async (config: AppleEnv = env.apple): Promise<string> => {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'ES256', kid: config.keyId };
	const payload = {
		iss: config.teamId,
		iat: now,
		exp: now + 3600,
		aud: 'https://appleid.apple.com',
		sub: config.clientId
	};
	const signingInput = `${base64UrlEncode(
		new TextEncoder().encode(JSON.stringify(header))
	)}.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;

	const key = await importPrivateKey(config);
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key,
		new TextEncoder().encode(signingInput)
	);

	return `${signingInput}.${base64UrlEncode(toJoseSignature(new Uint8Array(signature)))}`;
};

/** Build the Apple consent URL. `state` is echoed back and checked against
 * the signed state cookie in the callback (CSRF protection). */
export const buildAuthUrl = (state: string): string => {
	const params = new URLSearchParams({
		client_id: env.apple.clientId,
		redirect_uri: redirectUri(env.apple),
		response_type: 'code',
		scope: 'name email',
		response_mode: 'form_post',
		state
	});

	return `${AUTH_URL}?${params.toString()}`;
};

/** Exchange an authorization code for the user's profile, or null on any
 * provider-side failure. */
export const exchangeCode = async (code: string): Promise<AppleProfile | null> => {
	const tokenRes = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: env.apple.clientId,
			client_secret: await clientSecret(),
			redirect_uri: redirectUri(env.apple),
			grant_type: 'authorization_code'
		})
	});

	if (!tokenRes.ok) {
		return null;
	}

	const token = (await tokenRes.json()) as { id_token?: string };

	if (isNullish(token.id_token)) {
		return null;
	}

	const parts = token.id_token.split('.');
	const [, payloadPart] = parts;

	if (parts.length !== 3 || isNullish(payloadPart)) {
		return null;
	}

	let claims: { sub?: string; email?: string; email_verified?: boolean | string };

	try {
		claims = JSON.parse(base64UrlDecodeToString(payloadPart)) as typeof claims;
	} catch {
		return null;
	}

	if (isNullish(claims.sub) || isNullish(claims.email)) {
		return null;
	}

	return {
		sub: claims.sub,
		email: claims.email,
		// Apple sends the claim as boolean or the string "true".
		emailVerified: claims.email_verified === true || claims.email_verified === 'true'
	};
};
