import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
	createOtp,
	OTP_MAX_ATTEMPTS,
	OTP_MAX_LIVE_CODES,
	requestOtp,
	verifyOtp
} from '../src/auth/otp';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';
import { ensureMigrated, uniqueEmail } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe.if(dbAvailable)('email OTP', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	test('happy path: verify provisions a user and an email identity', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);
		const result = await verifyOtp({ email, code });

		expect(result.ok).toBe(true);

		if (!result.ok) {
			throw new Error('unreachable');
		}

		const identities = await query<{ provider: string; subject: string; email: string }>(
			`select provider, subject, email from auth_identities where user_id = $1`,
			[result.userId]
		);

		expect(identities).toHaveLength(1);
		expect(identities[0]).toEqual({ provider: 'email', subject: email, email });

		const users = await query<{ role: string }>(`select role from users where id = $1`, [
			result.userId
		]);

		expect(users[0]?.role).toBe('user');
	});

	test('verify is case-insensitive on the address', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);
		const result = await verifyOtp({ email: email.toUpperCase(), code });

		expect(result.ok).toBe(true);
	});

	test('a second verify resolves to the same user, not a duplicate', async () => {
		const email = uniqueEmail();
		const first = await verifyOtp({ email, code: await createOtp(email) });
		const second = await verifyOtp({ email, code: await createOtp(email) });

		expect(first.ok && second.ok && first.userId === second.userId).toBe(true);
	});

	test('codes are single-use: a burned code cannot be replayed', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		expect((await verifyOtp({ email, code })).ok).toBe(true);
		expect(await verifyOtp({ email, code })).toEqual({ ok: false, reason: 'invalid' });
	});

	test('a wrong code is rejected and increments the attempt counter', async () => {
		const email = uniqueEmail();

		await createOtp(email);

		expect(await verifyOtp({ email, code: '000000' })).toEqual({ ok: false, reason: 'invalid' });

		const rows = await query<{ attempts: number }>(
			`select attempts from otp_codes where lower(email) = $1`,
			[email]
		);

		expect(rows[0]?.attempts).toBe(1);
	});

	test(`lockout: after ${OTP_MAX_ATTEMPTS} wrong attempts even the right code is refused`, async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
			expect(await verifyOtp({ email, code: '000000' })).toEqual({ ok: false, reason: 'invalid' });
		}

		expect(await verifyOtp({ email, code })).toEqual({ ok: false, reason: 'locked' });
	});

	test('concurrent wrong guesses cannot exceed the attempt budget', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		const results = await Promise.all(
			Array.from({ length: OTP_MAX_ATTEMPTS * 4 }, () => verifyOtp({ email, code: '000000' }))
		);

		expect(results.filter((result) => !result.ok && result.reason === 'invalid').length).toBe(
			OTP_MAX_ATTEMPTS
		);
		expect(await verifyOtp({ email, code })).toEqual({ ok: false, reason: 'locked' });
	});

	test(`an address holds at most ${OTP_MAX_LIVE_CODES} live codes`, async () => {
		const email = uniqueEmail();

		for (let i = 0; i < OTP_MAX_LIVE_CODES + 2; i++) {
			await requestOtp(email);
		}

		const rows = await query<{ count: number }>(
			`select count(*)::int as count from otp_codes where lower(email) = $1`,
			[email]
		);

		expect(rows[0]?.count).toBe(OTP_MAX_LIVE_CODES);
	});

	test('an expired code never verifies', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);

		await query(`update otp_codes set expires_at = now() - interval '1 minute' where email = $1`, [
			email
		]);

		expect(await verifyOtp({ email, code })).toEqual({ ok: false, reason: 'invalid' });
	});

	test('the request route answers identically for unknown and known addresses', async () => {
		const known = uniqueEmail();

		await verifyOtp({ email: known, code: await createOtp(known) });

		const bodies = [];

		for (const email of [uniqueEmail(), known]) {
			const res = await app.handle(
				new Request('http://localhost/api/v1/auth/otp/request', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email })
				})
			);

			expect(res.status).toBe(200);

			bodies.push(await res.json());
		}

		expect(bodies[0]).toEqual(bodies[1]);
	});

	test('the request route rejects a malformed address', async () => {
		const res = await app.handle(
			new Request('http://localhost/api/v1/auth/otp/request', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'not-an-email' })
			})
		);

		expect(res.status).toBe(400);
	});

	test('the verify route sets the rotated session cookie with the hardened flags', async () => {
		const email = uniqueEmail();
		const code = await createOtp(email);
		const res = await app.handle(
			new Request('http://localhost/api/v1/auth/otp/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, code })
			})
		);

		expect(res.status).toBe(200);

		const cookie = res.headers.get('set-cookie') ?? '';

		expect(cookie).toStartWith('vici_session=');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('SameSite=Lax');
		// Dev posture in tests: Secure only rides in production.
		expect(cookie).not.toContain('Secure');

		const body = (await res.json()) as { user: { id: string } };

		expect(body.user.id).toBeString();
	});

	test('the verify route answers 401 for a wrong code and 429 when locked', async () => {
		const email = uniqueEmail();

		await createOtp(email);

		const verify = (code: string) =>
			app.handle(
				new Request('http://localhost/api/v1/auth/otp/verify', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email, code })
				})
			);

		for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
			expect((await verify('000000')).status).toBe(401);
		}

		expect((await verify('000000')).status).toBe(429);
	});

	test('the request route rate-limits per client', async () => {
		const request = () =>
			app.handle(
				new Request('http://localhost/api/v1/auth/otp/request', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email: uniqueEmail() })
				})
			);

		for (let i = 0; i < 5; i++) {
			expect((await request()).status).toBe(200);
		}

		const limited = await request();

		expect(limited.status).toBe(429);
		expect(limited.headers.get('retry-after')).not.toBeNull();
	});
});
