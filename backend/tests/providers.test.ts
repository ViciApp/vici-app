import { beforeEach, describe, expect, test } from 'bun:test';
import { clientSecret } from '../src/auth/apple';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';

// The test env configures no OAuth credentials, so both OAuth providers must
// report coming_soon and their endpoints must degrade to a stable 503 body.
describe('GET /api/v1/auth/providers', () => {
	test('reports email available and unconfigured OAuth providers as coming_soon', async () => {
		const res = await app.handle(new Request('http://localhost/api/v1/auth/providers'));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			providers: { email: 'available', google: 'coming_soon', apple: 'coming_soon' }
		});
	});
});

describe('provider endpoint gating', () => {
	beforeEach(() => {
		resetRateLimits();
	});

	test('GET /auth/apple answers 503 provider_unavailable when unconfigured', async () => {
		const res = await app.handle(new Request('http://localhost/api/v1/auth/apple'));

		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: 'provider_unavailable' });
	});

	test('POST /auth/apple/callback answers 503 provider_unavailable when unconfigured', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/v1/auth/apple/callback', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ code: 'x', state: 'y' })
			})
		);

		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: 'provider_unavailable' });
	});

	test('GET /auth/google answers 503 provider_unavailable when unconfigured', async () => {
		const res = await app.handle(new Request('http://localhost/api/v1/auth/google'));

		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: 'provider_unavailable' });
	});
});

describe('apple client secret', () => {
	test('produces a valid ES256 JWT over the configured claims', async () => {
		const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
			'sign',
			'verify'
		]);
		const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)).toString(
			'base64'
		);
		const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`;

		const jwt = await clientSecret({
			enabled: true,
			clientId: 'app.vici.signin',
			teamId: 'TEAM123456',
			keyId: 'KEY1234567',
			privateKey: pem,
			redirectUri: ''
		});

		const [headerB64, payloadB64, signatureB64] = jwt.split('.') as [string, string, string];
		const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
			alg: string;
			kid: string;
		};
		const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
			iss: string;
			aud: string;
			sub: string;
			iat: number;
			exp: number;
		};

		expect(header).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
		expect(payload.iss).toBe('TEAM123456');
		expect(payload.aud).toBe('https://appleid.apple.com');
		expect(payload.sub).toBe('app.vici.signin');
		expect(payload.exp - payload.iat).toBe(3600);

		const verified = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			keyPair.publicKey,
			Buffer.from(signatureB64, 'base64url'),
			new TextEncoder().encode(`${headerB64}.${payloadB64}`)
		);

		expect(verified).toBe(true);
	});
});
