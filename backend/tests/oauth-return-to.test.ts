// The Google flow carries a client-supplied returnTo through the signed
// OAuth state cookie. These suites pin the two security properties: the
// value is clamped to a same-app absolute path (no open redirect), and the
// state signature stays enforced end to end.

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as google from '../src/auth/google';
import { decodeOauthState, encodeOauthState, sanitizeReturnTo } from '../src/auth/oauth-state';
import { env } from '../src/env';
import { app } from '../src/index';
import { OAUTH_STATE_COOKIE, readCookie } from '../src/lib/cookie';
import { resetRateLimits } from '../src/lib/rate-limit';
import { ensureMigrated, uniqueEmail } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe('sanitizeReturnTo', () => {
	test('honors a same-app absolute path, query and hash included', () => {
		expect(sanitizeReturnTo('/flow')).toBe('/flow');
		expect(sanitizeReturnTo('/flow?tab=stats#top')).toBe('/flow?tab=stats#top');
	});

	test('rejects absolute URLs and anything carrying a scheme', () => {
		expect(sanitizeReturnTo('https://evil.example/phish')).toBe('/');
		expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
		expect(sanitizeReturnTo('http:/evil.example')).toBe('/');
	});

	test('rejects protocol-relative and backslash spellings', () => {
		expect(sanitizeReturnTo('//evil.example')).toBe('/');
		expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
		expect(sanitizeReturnTo('/a\\b')).toBe('/');
	});

	test('rejects non-strings, empties, control chars and oversized values', () => {
		expect(sanitizeReturnTo(undefined)).toBe('/');
		expect(sanitizeReturnTo('')).toBe('/');
		expect(sanitizeReturnTo('/a\nb')).toBe('/');
		expect(sanitizeReturnTo(`/${'a'.repeat(600)}`)).toBe('/');
	});
});

describe('oauth state payload codec', () => {
	test('round-trips state and returnTo through the signed value', () => {
		const encoded = encodeOauthState({ state: 'csrf-token', returnTo: '/flow?tab=stats' });

		expect(decodeOauthState(encoded)).toEqual({ state: 'csrf-token', returnTo: '/flow?tab=stats' });
	});

	test('rejects a tampered signature and unsigned values', () => {
		const encoded = encodeOauthState({ state: 'csrf-token', returnTo: '/flow' });

		expect(decodeOauthState(`${encoded.slice(0, -2)}xx`)).toBeNull();
		expect(decodeOauthState('not-a-signed-value')).toBeNull();
		expect(decodeOauthState(null)).toBeNull();
	});

	test('re-clamps a hostile returnTo even under a valid signature', () => {
		const encoded = encodeOauthState({ state: 'csrf-token', returnTo: 'https://evil.example' });

		expect(decodeOauthState(encoded)).toEqual({ state: 'csrf-token', returnTo: '/' });
	});
});

/** The state cookie the redirect set, parsed out of the Set-Cookie header. */
const stateCookieOf = (res: Response): string | null =>
	readCookie(res.headers.get('set-cookie'), OAUTH_STATE_COOKIE);

describe('google returnTo end to end', () => {
	const savedGoogle = { ...env.google };

	beforeAll(() => {
		// The test env ships Google unconfigured; enable it in-memory so the
		// redirect and callback paths run (exchangeCode is mocked where needed).
		Object.assign(env.google, {
			enabled: true,
			clientId: 'test-client',
			clientSecret: 'test-secret',
			redirectUri: ''
		});
	});

	afterAll(() => {
		Object.assign(env.google, savedGoogle);
	});

	beforeEach(() => {
		resetRateLimits();
	});

	test('GET /auth/google embeds a valid returnTo in the signed state cookie', async () => {
		const res = await app.handle(
			new Request(
				`http://localhost/api/v1/auth/google?returnTo=${encodeURIComponent('/flow?tab=stats')}`
			)
		);

		expect(res.status).toBe(302);

		const location = new URL(res.headers.get('location') ?? '');

		expect(location.origin).toBe('https://accounts.google.com');

		const payload = decodeOauthState(stateCookieOf(res));

		expect(payload?.returnTo).toBe('/flow?tab=stats');
		// The provider echoes the bare CSRF token; the cookie payload pins the same one.
		expect(payload?.state).toBe(location.searchParams.get('state') ?? '');
	});

	test('GET /auth/google clamps absolute and protocol-relative returnTo to /', async () => {
		for (const hostile of ['https://evil.example/phish', '//evil.example', '/\\evil.example']) {
			const res = await app.handle(
				new Request(`http://localhost/api/v1/auth/google?returnTo=${encodeURIComponent(hostile)}`)
			);

			expect(res.status).toBe(302);
			expect(decodeOauthState(stateCookieOf(res))?.returnTo).toBe('/');
		}
	});

	test('callback rejects an unsigned or tampered state cookie', async () => {
		const tampered = `${encodeOauthState({ state: 'abc', returnTo: '/flow' }).slice(0, -2)}xx`;

		for (const cookie of ['garbage-without-signature', tampered]) {
			const res = await app.handle(
				new Request('http://localhost/api/v1/auth/google/callback?code=c&state=abc', {
					headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` }
				})
			);

			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/?e=state`);
		}
	});

	test('callback rejects a signed cookie whose state does not match the echo', async () => {
		const cookie = encodeOauthState({ state: 'expected', returnTo: '/flow' });

		const res = await app.handle(
			new Request('http://localhost/api/v1/auth/google/callback?code=c&state=different', {
				headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` }
			})
		);

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/?e=state`);
	});

	describe.if(dbAvailable)('callback landing', () => {
		beforeAll(async () => {
			await ensureMigrated();
		});

		test('a valid returnTo is honored after login', async () => {
			const exchange = spyOn(google, 'exchangeCode').mockResolvedValue({
				sub: `sub-${crypto.randomUUID()}`,
				email: uniqueEmail(),
				name: 'Return To',
				emailVerified: true
			});

			try {
				const cookie = encodeOauthState({ state: 'csrf-ok', returnTo: '/flow?tab=stats' });

				const res = await app.handle(
					new Request('http://localhost/api/v1/auth/google/callback?code=c&state=csrf-ok', {
						headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` }
					})
				);

				expect(res.status).toBe(302);
				expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/flow?tab=stats`);
				expect(res.headers.get('set-cookie')).toContain('vici_session=');
			} finally {
				exchange.mockRestore();
			}
		});
	});
});
