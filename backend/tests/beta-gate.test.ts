// The beta access gate limits sign-in to an admin-managed email allowlist
// while enabled. These suites pin the valve's semantics: absent or disabled
// means everyone passes, an enabled gate admits exactly the allowlist
// (case-insensitively) and refuses everyone else with the stable
// `beta_closed` wire error, on both the OTP flow and the OAuth callback.
// With `allowNewUsers` it also admits brand-new people and already
// onboarded web2 accounts while holding legacy accounts back with the
// distinct `legacy_account_pending` code (OAuth: `/signin?e=legacy`).

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
import { deleteAppSetting, upsertAppSetting } from '../src/admin/settings';
import * as apple from '../src/auth/apple';
import { BETA_GATE_SETTING_KEY, betaGateVerdict } from '../src/auth/beta-gate';
import * as google from '../src/auth/google';
import { resolveIdentity } from '../src/auth/identity';
import { encodeOauthState } from '../src/auth/oauth-state';
import { createOtp } from '../src/auth/otp';
import { query } from '../src/db/client';
import { env } from '../src/env';
import { app } from '../src/index';
import { APPLE_STATE_COOKIE, OAUTH_STATE_COOKIE } from '../src/lib/cookie';
import { signState } from '../src/lib/crypto';
import { resetRateLimits } from '../src/lib/rate-limit';
import { ensureMigrated, uniqueEmail, uniquePrincipal } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const setGate = (value: unknown): Promise<unknown> =>
	upsertAppSetting({ key: BETA_GATE_SETTING_KEY, value });

const clearGate = (): Promise<unknown> => deleteAppSetting(BETA_GATE_SETTING_KEY);

/** Whether the gate lets this address through (OTP-style: no provider
 * identity rides along). */
const isAllowed = async (email: string): Promise<boolean> =>
	(await betaGateVerdict({ email })) === 'allowed';

/** An open gate as production runs it: allowlist kept, new users admitted. */
const openToNewUsers = (emails: string[] = [uniqueEmail()]): Promise<unknown> =>
	setGate({ enabled: true, emails, allowNewUsers: true });

/** A legacy account row as the auth-identity drain exports it. */
const seedLegacyAccount = async ({
	openidEmail = null,
	profileEmail = null
}: {
	openidEmail?: string | null;
	profileEmail?: string | null;
}): Promise<void> => {
	await query(
		`insert into legacy_auth_identities (principal, provider, openid_email, profile_email)
		 values ($1, 'google', $2, $3)`,
		[uniquePrincipal(), openidEmail, profileEmail]
	);
};

/** How many OTP codes were ever issued to this address: proves a refused
 * request never reached the mailer. */
const otpCountFor = async (email: string): Promise<number> => {
	const rows = await query<{ count: string }>(
		`select count(*)::text as count from otp_codes where email = $1`,
		[email]
	);

	return Number(rows[0]?.count ?? '0');
};

const otpRequest = (email: string): Promise<Response> =>
	app.handle(
		new Request('http://localhost/api/v1/auth/otp/request', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email })
		})
	);

const otpVerify = ({ email, code }: { email: string; code: string }): Promise<Response> =>
	app.handle(
		new Request('http://localhost/api/v1/auth/otp/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, code })
		})
	);

describe.if(dbAvailable)('beta gate policy', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	afterEach(async () => {
		await clearGate();
	});

	test('absent setting: everyone passes', async () => {
		expect(await isAllowed(uniqueEmail())).toBe(true);
	});

	test('enabled=false: everyone passes regardless of the allowlist', async () => {
		await setGate({ enabled: false, emails: [] });

		expect(await isAllowed(uniqueEmail())).toBe(true);
	});

	test('enabled gate admits allowlisted addresses case-insensitively', async () => {
		const email = uniqueEmail();

		await setGate({ enabled: true, emails: [` ${email.toUpperCase()} `] });

		expect(await isAllowed(email)).toBe(true);
		expect(await isAllowed(email.toUpperCase())).toBe(true);
		expect(await isAllowed(uniqueEmail())).toBe(false);
	});

	test('a single non-string allowlist entry fails the whole list closed', async () => {
		const allowed = uniqueEmail();

		// A half-broken allowlist is a config error: honouring only its valid
		// entries would quietly admit people under a list nobody can trust.
		await setGate({ enabled: true, emails: [allowed, 42] as unknown as string[] });

		expect(await isAllowed(allowed)).toBeFalse();
	});

	test('malformed setting fails closed while enabled', async () => {
		await setGate({ enabled: true });

		expect(await isAllowed(uniqueEmail())).toBe(false);

		await setGate({ enabled: true, emails: 'not-a-list' });

		expect(await isAllowed(uniqueEmail())).toBe(false);
	});
});

describe.if(dbAvailable)('beta gate policy with allowNewUsers', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	afterEach(async () => {
		await clearGate();
	});

	test('allowlisted address passes, even when it matches a legacy account', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ openidEmail: email });
		await openToNewUsers([email.toUpperCase()]);

		expect(await betaGateVerdict({ email })).toBe('allowed');
	});

	test('an address nobody knows is a new person and passes', async () => {
		await openToNewUsers();

		expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('allowed');
	});

	test('legacy openid_email match is held back case-insensitively', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ openidEmail: email.toUpperCase() });
		await openToNewUsers();

		expect(await betaGateVerdict({ email })).toBe('legacy_account_pending');
		expect(await betaGateVerdict({ email: ` ${email.toUpperCase()} ` })).toBe(
			'legacy_account_pending'
		);
	});

	test('legacy profile_email match is held back too', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ profileEmail: email });
		await openToNewUsers();

		expect(await betaGateVerdict({ email: email.toUpperCase() })).toBe('legacy_account_pending');
	});

	test('an existing web2 identity passes even when the address is also legacy', async () => {
		const email = uniqueEmail();

		// Already onboarded (the legacy link was adopted at that first login):
		// the gate must never lock such a person out again.
		await seedLegacyAccount({ openidEmail: email });
		await resolveIdentity({ provider: 'email', subject: email, email });
		await openToNewUsers();

		expect(await betaGateVerdict({ email: email.toUpperCase() })).toBe('allowed');
	});

	test('an existing provider identity passes by subject when its email changed', async () => {
		const oldEmail = uniqueEmail();
		const newEmail = uniqueEmail();
		const subject = `sub-${crypto.randomUUID()}`;

		await resolveIdentity({ provider: 'google', subject, email: oldEmail });
		await seedLegacyAccount({ openidEmail: newEmail });
		await openToNewUsers();

		expect(
			await betaGateVerdict({ email: newEmail, identity: { provider: 'google', subject } })
		).toBe('allowed');
		// Without the subject, the new address alone reads as a legacy account.
		expect(await betaGateVerdict({ email: newEmail })).toBe('legacy_account_pending');
	});

	test('allowNewUsers absent or false keeps the strict allowlist', async () => {
		const legacy = uniqueEmail();

		await seedLegacyAccount({ openidEmail: legacy });

		await setGate({ enabled: true, emails: [uniqueEmail()] });

		expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('beta_closed');
		expect(await betaGateVerdict({ email: legacy })).toBe('beta_closed');

		await setGate({ enabled: true, emails: [uniqueEmail()], allowNewUsers: false });

		expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('beta_closed');
		expect(await betaGateVerdict({ email: legacy })).toBe('beta_closed');
	});

	test('an existing web2 identity does not bypass the strict allowlist', async () => {
		const email = uniqueEmail();

		await resolveIdentity({ provider: 'email', subject: email, email });
		await setGate({ enabled: true, emails: [uniqueEmail()] });

		expect(await betaGateVerdict({ email })).toBe('beta_closed');
	});

	test('a non-boolean allowNewUsers fails closed to the strict allowlist', async () => {
		for (const allowNewUsers of ['true', 1, {}, null]) {
			await setGate({ enabled: true, emails: [uniqueEmail()], allowNewUsers });

			expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('beta_closed');
		}
	});

	test('a malformed allowlist fails closed even with allowNewUsers', async () => {
		await setGate({ enabled: true, allowNewUsers: true });

		expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('beta_closed');

		await setGate({ enabled: true, emails: 'not-a-list', allowNewUsers: true });

		expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('beta_closed');

		await setGate({ enabled: true, emails: [uniqueEmail(), 42], allowNewUsers: true });

		expect(await betaGateVerdict({ email: uniqueEmail() })).toBe('beta_closed');
	});

	test('allowNewUsers is inert while the gate is disabled', async () => {
		const legacy = uniqueEmail();

		await seedLegacyAccount({ openidEmail: legacy });
		await setGate({ enabled: false, emails: [], allowNewUsers: true });

		expect(await betaGateVerdict({ email: legacy })).toBe('allowed');
	});
});

describe.if(dbAvailable)('beta gate on the OTP flow', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	afterEach(async () => {
		await clearGate();
	});

	test('gate off (absent): request succeeds for any address', async () => {
		const res = await otpRequest(uniqueEmail());

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test('gate disabled: request succeeds for a non-allowlisted address', async () => {
		await setGate({ enabled: false, emails: [uniqueEmail()] });

		const res = await otpRequest(uniqueEmail());

		expect(res.status).toBe(200);
	});

	test('allowlisted address passes the enabled gate', async () => {
		const email = uniqueEmail();

		await setGate({ enabled: true, emails: [email] });

		const res = await otpRequest(email);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test('allowlist matching ignores case on both sides', async () => {
		const email = uniqueEmail();

		await setGate({ enabled: true, emails: [email.toUpperCase()] });

		const res = await otpRequest(email);

		expect(res.status).toBe(200);
	});

	test('non-allowlisted request is refused with the stable beta_closed error', async () => {
		await setGate({ enabled: true, emails: [uniqueEmail()] });

		const res = await otpRequest(uniqueEmail());

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'beta_closed' });
	});

	test('a code issued before the gate flipped on cannot verify', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		await setGate({ enabled: true, emails: [uniqueEmail()] });

		const res = await otpVerify({ email, code });

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'beta_closed' });
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	test('allowlisted verify still mints a session under the enabled gate', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		await setGate({ enabled: true, emails: [email] });

		const res = await otpVerify({ email, code });

		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a new address requests and verifies a code', async () => {
		const email = uniqueEmail();

		await openToNewUsers();

		const requested = await otpRequest(email);

		expect(requested.status).toBe(200);
		expect(await otpCountFor(email)).toBe(1);

		const res = await otpVerify({ email, code: await createOtp(email) });

		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a legacy address is refused before any code is issued', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ profileEmail: email.toUpperCase() });
		await openToNewUsers();

		const res = await otpRequest(email.toUpperCase());

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'legacy_account_pending' });
		expect(await otpCountFor(email)).toBe(0);
	});

	test('allowNewUsers: a legacy address cannot verify a code issued earlier', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		await seedLegacyAccount({ openidEmail: email });
		await openToNewUsers();

		const res = await otpVerify({ email, code });

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'legacy_account_pending' });
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	test('allowNewUsers: an onboarded legacy address still signs in', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ openidEmail: email });
		await resolveIdentity({ provider: 'email', subject: email, email });
		await openToNewUsers();

		const requested = await otpRequest(email);

		expect(requested.status).toBe(200);

		const res = await otpVerify({ email, code: await createOtp(email) });

		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a non-legacy address still gets beta_closed when the flag is off', async () => {
		await setGate({ enabled: true, emails: [uniqueEmail()], allowNewUsers: false });

		const res = await otpRequest(uniqueEmail());

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'beta_closed' });
	});
});

describe.if(dbAvailable)('beta gate on the Google callback', () => {
	const savedGoogle = { ...env.google };

	beforeAll(async () => {
		await ensureMigrated();

		// The test env ships Google unconfigured; enable it in-memory so the
		// callback path runs (exchangeCode is mocked per test).
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

	afterEach(async () => {
		await clearGate();
	});

	const callback = async (
		profileEmail: string,
		sub = `sub-${crypto.randomUUID()}`
	): Promise<Response> => {
		const exchange = spyOn(google, 'exchangeCode').mockResolvedValue({
			sub,
			email: profileEmail,
			name: 'Gate Test',
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

	test('non-allowlisted profile is bounced to the beta landing without a session', async () => {
		await setGate({ enabled: true, emails: [uniqueEmail()] });

		const res = await callback(uniqueEmail());

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/signin?e=beta`);
		expect(res.headers.get('set-cookie')).not.toContain('vici_session=');
	});

	test('allowlisted profile logs in under the enabled gate', async () => {
		const email = uniqueEmail();

		await setGate({ enabled: true, emails: [email.toUpperCase()] });

		const res = await callback(email);

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/`);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('gate off: callback logs in as before', async () => {
		const res = await callback(uniqueEmail());

		expect(res.status).toBe(302);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a new profile logs in', async () => {
		await openToNewUsers();

		const res = await callback(uniqueEmail());

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/`);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a legacy profile is bounced to the legacy landing', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ openidEmail: email });
		await openToNewUsers();

		const res = await callback(email.toUpperCase());

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/signin?e=legacy`);
		expect(res.headers.get('set-cookie')).not.toContain('vici_session=');
	});

	test('allowNewUsers: a returning Google identity logs in by subject', async () => {
		const sub = `sub-${crypto.randomUUID()}`;
		const changedEmail = uniqueEmail();

		await resolveIdentity({ provider: 'google', subject: sub, email: uniqueEmail() });
		await seedLegacyAccount({ profileEmail: changedEmail });
		await openToNewUsers();

		const res = await callback(changedEmail, sub);

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/`);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers off: a non-allowlisted profile still gets the beta landing', async () => {
		await setGate({ enabled: true, emails: [uniqueEmail()] });

		const email = uniqueEmail();

		await seedLegacyAccount({ openidEmail: email });

		const res = await callback(email);

		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/signin?e=beta`);
	});
});

describe('beta gate: apple callback', () => {
	const savedApple = { ...env.apple };

	beforeAll(async () => {
		await ensureMigrated();

		Object.assign(env.apple, { ...env.apple, enabled: true });
	});

	afterAll(() => {
		Object.assign(env.apple, savedApple);
	});

	beforeEach(() => {
		resetRateLimits();
	});

	afterEach(async () => {
		await clearGate();
	});

	const callback = async (profileEmail: string): Promise<Response> => {
		const exchange = spyOn(apple, 'exchangeCode').mockResolvedValue({
			sub: `apple-sub-${crypto.randomUUID()}`,
			email: profileEmail,
			emailVerified: true
		});

		try {
			const body = new URLSearchParams({ code: 'c', state: 'csrf-ok' });

			return await app.handle(
				new Request('http://localhost/api/v1/auth/apple/callback', {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						cookie: `${APPLE_STATE_COOKIE}=${signState('csrf-ok')}`
					},
					body
				})
			);
		} finally {
			exchange.mockRestore();
		}
	};

	test('non-allowlisted apple profile is bounced without a session', async () => {
		await setGate({ enabled: true, emails: [uniqueEmail()] });

		const res = await callback(uniqueEmail());

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/signin?e=beta`);
		expect(res.headers.get('set-cookie')).not.toContain('vici_session=');
	});

	test('allowlisted apple profile logs in under the enabled gate', async () => {
		const email = uniqueEmail();

		await setGate({ enabled: true, emails: [email.toUpperCase()] });

		const res = await callback(email);

		expect(res.status).toBe(302);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a new apple profile logs in', async () => {
		await openToNewUsers();

		const res = await callback(uniqueEmail());

		expect(res.status).toBe(302);
		expect(res.headers.get('set-cookie')).toContain('vici_session=');
	});

	test('allowNewUsers: a legacy apple profile is bounced to the legacy landing', async () => {
		const email = uniqueEmail();

		await seedLegacyAccount({ profileEmail: email });
		await openToNewUsers();

		const res = await callback(email);

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe(`${env.publicAppUrl}/signin?e=legacy`);
		expect(res.headers.get('set-cookie')).not.toContain('vici_session=');
	});
});
