// Team-only sign-in: with TEAM_SIGNIN_EMAILS set, every point that learns a
// caller's email refuses an address outside the allowlist with the beta
// gate's neutral answer, before any code is mailed or any account exists, and
// a session whose account carries no allowlisted email reads as signed out.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test
} from 'bun:test';
import * as apple from '../src/auth/apple';
import * as google from '../src/auth/google';
import { resolveIdentity } from '../src/auth/identity';
import { encodeOauthState } from '../src/auth/oauth-state';
import { createOtp } from '../src/auth/otp';
import { createSession } from '../src/auth/sessions';
import { isTeamEmail } from '../src/auth/team-gate';
import { query } from '../src/db/client';
import { env } from '../src/env';
import { app } from '../src/index';
import { APPLE_STATE_COOKIE, OAUTH_STATE_COOKIE } from '../src/lib/cookie';
import { signState } from '../src/lib/crypto';
import { resetRateLimits } from '../src/lib/rate-limit';
import { ensureMigrated, uniqueEmail } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

/** `uniqueEmail` addresses all share this domain, so a team domain distinct
 * from it keeps every fixture outside the allowlist unless listed. */
const TEAM_DOMAIN = 'team.vici.invalid';

const teamEmail = (): string => uniqueEmail().replace(/@.*$/, `@${TEAM_DOMAIN}`);

const savedTeamSignin = { ...env.teamSignin };

const enforce = ({
	emails = [],
	domains = []
}: {
	emails?: string[];
	domains?: string[];
}): void => {
	Object.assign(env.teamSignin, { enforced: true, emails, domains });
};

const restore = (): void => {
	Object.assign(env.teamSignin, savedTeamSignin);
};

const userCountFor = async (email: string): Promise<number> => {
	const rows = await query<{ count: string }>(
		`select count(*)::text as count from auth_identities where lower(email) = $1`,
		[email.toLowerCase()]
	);

	return Number(rows[0]?.count ?? '0');
};

const otpCountFor = async (email: string): Promise<number> => {
	const rows = await query<{ count: string }>(
		`select count(*)::text as count from otp_codes where email = $1`,
		[email]
	);

	return Number(rows[0]?.count ?? '0');
};

const post = (path: string, body: unknown): Promise<Response> =>
	app.handle(
		new Request(`http://localhost/api/v1${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);

const withSession = (path: string, token: string): Promise<Response> =>
	app.handle(
		new Request(`http://localhost/api/v1${path}`, { headers: { cookie: `vici_session=${token}` } })
	);

describe('isTeamEmail', () => {
	afterEach(restore);

	test('gate off: every address passes', () => {
		Object.assign(env.teamSignin, { enforced: false, emails: [], domains: [] });

		expect(isTeamEmail('anyone@example.com')).toBe(true);
	});

	test('enforced: listed addresses and domains pass, case-insensitively', () => {
		enforce({ emails: ['anto@vici.app'], domains: ['team.example'] });

		expect(isTeamEmail(' Anto@VICI.app ')).toBe(true);
		expect(isTeamEmail('someone@Team.Example')).toBe(true);
		expect(isTeamEmail('anto+x@vici.app')).toBe(false);
		expect(isTeamEmail('other@vici.app')).toBe(false);
		expect(isTeamEmail('someone@sub.team.example')).toBe(false);
		expect(isTeamEmail('team.example')).toBe(false);
	});

	test('enforced with an empty list admits nobody', () => {
		enforce({});

		expect(isTeamEmail('anto@vici.app')).toBe(false);
	});
});

describe.if(dbAvailable)('team gate on the email code', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
		enforce({ domains: [TEAM_DOMAIN] });
	});

	afterEach(restore);

	test('a non-team address is refused before any code is issued', async () => {
		const email = uniqueEmail();
		const res = await post('/auth/otp/request', { email, turnstileToken: '' });

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'beta_closed' });
		expect(await otpCountFor(email)).toBe(0);
	});

	test('a valid code for a non-team address mints no session and creates no account', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);
		const res = await post('/auth/otp/verify', { email, code });

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'beta_closed' });
		expect(res.headers.get('set-cookie') ?? '').not.toContain('vici_session=');
		expect(await userCountFor(email)).toBe(0);
	});

	test('a team address gets a code and signs in', async () => {
		const email = teamEmail();
		const requested = await post('/auth/otp/request', { email, turnstileToken: '' });

		expect(requested.status).toBe(200);

		const code = await createOtp(email);
		const verified = await post('/auth/otp/verify', { email, code });

		expect(verified.status).toBe(200);
		expect(verified.headers.get('set-cookie')).toContain('vici_session=');
	});
});

describe.if(dbAvailable)('team gate on the OAuth callbacks', () => {
	const savedGoogle = { ...env.google };
	const savedApple = { ...env.apple };

	beforeAll(async () => {
		await ensureMigrated();
		Object.assign(env.google, {
			enabled: true,
			clientId: 'test-client',
			clientSecret: 'test-secret',
			redirectUri: ''
		});
		Object.assign(env.apple, { ...env.apple, enabled: true });
	});

	afterAll(() => {
		Object.assign(env.google, savedGoogle);
		Object.assign(env.apple, savedApple);
	});

	beforeEach(() => {
		resetRateLimits();
		enforce({ domains: [TEAM_DOMAIN] });
	});

	afterEach(restore);

	const googleCallback = async (email: string): Promise<Response> => {
		const exchange = spyOn(google, 'exchangeCode').mockResolvedValue({
			sub: `sub-${crypto.randomUUID()}`,
			email,
			name: 'Team Gate',
			emailVerified: true
		});

		try {
			const cookie = encodeOauthState({ state: 'csrf-ok', returnTo: '/' });

			return await app.handle(
				new Request('http://localhost/api/v1/auth/google/callback?code=c&state=csrf-ok', {
					headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` }
				})
			);
		} finally {
			exchange.mockRestore();
		}
	};

	const appleCallback = async (email: string): Promise<Response> => {
		const exchange = spyOn(apple, 'exchangeCode').mockResolvedValue({
			sub: `apple-sub-${crypto.randomUUID()}`,
			email,
			emailVerified: true
		});

		try {
			return await app.handle(
				new Request('http://localhost/api/v1/auth/apple/callback', {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						cookie: `${APPLE_STATE_COOKIE}=${signState('csrf-ok')}`
					},
					body: new URLSearchParams({ code: 'c', state: 'csrf-ok' })
				})
			);
		} finally {
			exchange.mockRestore();
		}
	};

	for (const [name, callback] of [
		['google', googleCallback],
		['apple', appleCallback]
	] as const) {
		test(`${name}: a non-team profile lands on the team sign-in refusal, no account`, async () => {
			const email = uniqueEmail();
			const res = await callback(email);

			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/team?e=beta`);
			expect(res.headers.get('set-cookie')).not.toContain('vici_session=');
			expect(await userCountFor(email)).toBe(0);
		});

		test(`${name}: a team profile signs in`, async () => {
			const res = await callback(teamEmail());

			expect(res.status).toBe(302);
			expect(res.headers.get('set-cookie')).toContain('vici_session=');
		});
	}
});

describe.if(dbAvailable)('team gate on sessions', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	afterEach(restore);

	const sessionFor = async ({
		email,
		role = 'user'
	}: {
		email: string;
		role?: 'user' | 'admin';
	}): Promise<string> => {
		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		await query(`update users set role = $2 where id = $1`, [userId, role]);

		return createSession(userId);
	};

	test('an existing non-team session reads as signed out', async () => {
		const token = await sessionFor({ email: uniqueEmail() });

		enforce({ domains: [TEAM_DOMAIN] });

		const res = await withSession('/me', token);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'unauthenticated' });
	});

	test('re-listing the address restores the same session', async () => {
		const email = uniqueEmail();
		const token = await sessionFor({ email });

		enforce({ domains: [TEAM_DOMAIN] });

		expect((await withSession('/me', token)).status).toBe(401);

		enforce({ emails: [email], domains: [TEAM_DOMAIN] });

		expect((await withSession('/me', token)).status).toBe(200);
	});

	test('a team admin keeps the app and the admin', async () => {
		const token = await sessionFor({ email: teamEmail(), role: 'admin' });

		enforce({ domains: [TEAM_DOMAIN] });

		expect((await withSession('/me', token)).status).toBe(200);
		expect((await withSession('/admin/settings', token)).status).toBe(200);
	});

	test('gate off: any session resolves as before', async () => {
		const token = await sessionFor({ email: uniqueEmail() });

		expect((await withSession('/me', token)).status).toBe(200);
	});
});
