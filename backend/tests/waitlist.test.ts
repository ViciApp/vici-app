import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { createOtp } from '../src/auth/otp';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { checkNicknameAvailability } from '../src/profiles/nickname';
import { upsertMyProfile } from '../src/profiles/profile-write';
import { createTestUser, uniqueEmail } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';
import {
	CODE_TTL_MS,
	MAX_ATTEMPTS,
	confirm,
	errorOf,
	requestCode,
	reservationOf,
	uniqueHandle,
	uniqueIp,
	useWaitlistHarness
} from './helpers/waitlist';

// Reserving a handle: the code, the hold against other mailboxes, one handle
// per mailbox, and the profile write respecting a reservation.

describe.if(dbAvailable)('handle waitlist: reserving', () => {
	const { sent, clearSent, lastCodeTo, join } = useWaitlistHarness();

	test('joining holds the handle and sends the code, then the receipt', async () => {
		const email = uniqueEmail();
		const handle = uniqueHandle();
		const requested = await requestCode({ handle, email });

		expect(requested.status).toBe(200);
		expect(await requested.json()).toEqual({ ok: true, codeTtlMs: CODE_TTL_MS });
		expect(sent()).toHaveLength(1);
		expect(sent()[0]?.subject).toBe('Your VICI waitlist code');
		expect(sent()[0]?.text).toContain('/waitlist/remove?r=');

		const pending = await reservationOf(email);

		expect(pending).toMatchObject({
			pending_handle: handle,
			handle: null,
			privacy_version: '2026-11-27',
			locale: 'en',
			source: 'nav'
		});
		expect(pending?.consent_at).toBeInstanceOf(Date);

		const confirmed = await confirm({ email, code: lastCodeTo(email) });
		const body = (await confirmed.json()) as { handle: string; statusToken: string };

		expect(confirmed.status).toBe(200);
		expect(body.handle).toBe(handle);
		expect(body.statusToken.length).toBeGreaterThan(20);
		expect(sent()).toHaveLength(2);
		expect(sent()[1]?.subject).toBe(`@${handle} is yours, you're on the waitlist`);
		expect(sent()[1]?.text).toContain('/waitlist/remove?r=');

		const held = await reservationOf(email);

		expect(held).toMatchObject({ handle, pending_handle: null });
		expect(held?.confirmed_at).toBeInstanceOf(Date);
		expect(held?.expires_at?.getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 3600 * 1000);
	});

	test('joining creates no user, session or sign-in identity, and sets no cookie', async () => {
		const email = uniqueEmail();
		const count = async (table: string): Promise<number | undefined> =>
			(await query<{ count: number }>(`select count(*)::int as count from ${table}`))[0]?.count;
		const usersBefore = await count('users');
		const sessionsBefore = await count('sessions');

		await requestCode({ handle: uniqueHandle(), email });

		const confirmed = await confirm({ email, code: lastCodeTo(email) });

		expect(confirmed.status).toBe(200);
		expect(confirmed.headers.get('set-cookie')).toBeNull();
		expect(await count('users')).toBe(usersBefore);
		expect(await count('sessions')).toBe(sessionsBefore);

		const identities = await query<{ count: number }>(
			`select count(*)::int as count from auth_identities where lower(email) = $1`,
			[email]
		);

		expect(identities[0]?.count).toBe(0);
	});

	test('a code works once', async () => {
		const email = uniqueEmail();

		await requestCode({ handle: uniqueHandle(), email });

		const code = lastCodeTo(email);

		expect((await confirm({ email, code })).status).toBe(200);

		const again = await confirm({ email, code });

		expect(again.status).toBe(401);
		expect(await errorOf(again)).toBe('invalid_code');
	});

	test('five wrong codes lock the code, even for the right one', async () => {
		const email = uniqueEmail();

		await requestCode({ handle: uniqueHandle(), email });

		const code = lastCodeTo(email);
		const wrong = code === '000000' ? '111111' : '000000';

		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			expect(await errorOf(await confirm({ email, code: wrong }))).toBe('invalid_code');
		}

		const locked = await confirm({ email, code });

		expect(locked.status).toBe(410);
		expect(await errorOf(locked)).toBe('expired_code');
	});

	test('an expired code answers expired_code, and frees the handle', async () => {
		const email = uniqueEmail();
		const handle = uniqueHandle();

		await requestCode({ handle, email });

		const code = lastCodeTo(email);

		expect(await checkNicknameAvailability({ nickname: handle })).toEqual({
			available: false,
			reason: 'taken'
		});

		await query(
			`update waitlist_reservations set code_expires_at = now() - interval '1 second' where email_key = $1`,
			[email]
		);

		const expired = await confirm({ email, code });

		expect(expired.status).toBe(410);
		expect(await errorOf(expired)).toBe('expired_code');
		expect(await checkNicknameAvailability({ nickname: handle })).toEqual({ available: true });
		expect((await requestCode({ handle, email: uniqueEmail() })).status).toBe(200);
	});

	test('an unknown mailbox answers invalid_code, never expired_code', async () => {
		const response = await confirm({ email: uniqueEmail(), code: '123456' });

		expect(response.status).toBe(401);
		expect(await errorOf(response)).toBe('invalid_code');
	});

	test('a waitlist code cannot sign in, and a sign-in code cannot confirm', async () => {
		const email = uniqueEmail();

		await requestCode({ handle: uniqueHandle(), email });

		const waitlistCode = lastCodeTo(email);
		const signIn = await app.handle(
			new Request('http://localhost/api/v1/auth/otp/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
				body: JSON.stringify({ email, code: waitlistCode })
			})
		);

		expect(signIn.status).toBe(401);

		const signInCode = await createOtp(email);
		const confirmed = await confirm({ email, code: signInCode });

		// The waitlist code is still the only one that confirms, unless the two
		// six-digit draws collide.
		if (signInCode !== waitlistCode) {
			expect(confirmed.status).toBe(401);
		}

		await query(`delete from otp_codes where lower(email) = $1`, [email]);
	});

	test('a handle held by a reservation or a live pending hold is taken', async () => {
		const held = uniqueHandle();

		await join({ handle: held, email: uniqueEmail() });

		const taken = await requestCode({ handle: held, email: uniqueEmail() });

		expect(taken.status).toBe(409);
		expect(await errorOf(taken)).toBe('handle_taken');

		const pending = uniqueHandle();

		await requestCode({ handle: pending, email: uniqueEmail() });

		expect(await errorOf(await requestCode({ handle: pending, email: uniqueEmail() }))).toBe(
			'handle_taken'
		);
	});

	test('profiles are not consulted: a mailbox is only a waitlist entry', async () => {
		const { profile } = await createTestProfile();

		expect((await requestCode({ handle: profile.nickname, email: uniqueEmail() })).status).toBe(
			200
		);

		const email = uniqueEmail();

		await query(
			`insert into auth_identities (user_id, provider, subject, email) values ($1, 'email', $2, $2)`,
			[await createTestUser(), email]
		);

		expect((await requestCode({ handle: uniqueHandle(), email })).status).toBe(200);
		expect(await reservationOf(email)).toBeDefined();
	});

	test('a held handle is refused by both probes and the profile write', async () => {
		const handle = uniqueHandle();

		await join({ handle, email: uniqueEmail() });

		const userId = await createTestUser();

		expect(await checkNicknameAvailability({ nickname: handle, excludeUserId: userId })).toEqual({
			available: false,
			reason: 'taken'
		});
		await expect(upsertMyProfile({ userId, body: { nickname: handle } })).rejects.toThrow(
			'already taken'
		);

		const probe = await app.handle(
			new Request(`http://localhost/api/v1/profiles/nickname-availability?nickname=${handle}`, {
				headers: { cookie: `vici_session=${await createSession(userId)}` }
			})
		);

		expect(await probe.json()).toEqual({ available: false, reason: 'taken' });
	});

	test('two mailboxes asking for one handle at once: exactly one holds it', async () => {
		const handle = uniqueHandle();
		const [a, b] = await Promise.all([
			requestCode({ handle, email: uniqueEmail() }),
			requestCode({ handle, email: uniqueEmail() })
		]);

		expect([a.status, b.status].sort()).toEqual([200, 409]);
	});

	test('two live holds on one handle confirmed at once never make two holders', async () => {
		const handle = uniqueHandle();
		const first = uniqueEmail();
		const second = uniqueEmail();

		await requestCode({ handle, email: first });
		await query(
			`update waitlist_reservations set code_expires_at = now() - interval '1 second' where email_key = $1`,
			[first]
		);
		await requestCode({ handle, email: second });
		// Revive the first code, as if the hold had failed and both were live.
		await query(
			`update waitlist_reservations set code_expires_at = now() + interval '5 minutes' where email_key = $1`,
			[first]
		);

		const answers = await Promise.all([
			confirm({ email: first, code: lastCodeTo(first) }),
			confirm({ email: second, code: lastCodeTo(second) })
		]);

		expect(answers.filter((answer) => answer.status === 200).length).toBeLessThanOrEqual(1);

		const holders = await query<{ count: number }>(
			`select count(*)::int as count from waitlist_reservations where handle = $1`,
			[handle]
		);

		expect(holders[0]?.count).toBeLessThanOrEqual(1);
	});

	test('confirming another handle replaces the first and frees it', async () => {
		const email = uniqueEmail();
		const first = uniqueHandle();
		const second = uniqueHandle();

		await join({ handle: first, email });

		clearSent();

		const requested = await requestCode({ handle: second, email });

		expect(requested.status).toBe(200);

		const confirmed = await confirm({ email, code: lastCodeTo(email) });

		expect(((await confirmed.json()) as { handle: string }).handle).toBe(second);
		expect((await reservationOf(email))?.handle).toBe(second);
		expect(await checkNicknameAvailability({ nickname: first })).toEqual({ available: true });
	});

	test('aliases of one mailbox share one reservation', async () => {
		const local = `w${randomBytes(5).toString('hex')}`;
		const handle = uniqueHandle();

		await join({ handle, email: `${local}@gmail.com` });

		const alias = `${local.slice(0, 2)}.${local.slice(2)}+vici@googlemail.com`;

		await requestCode({ handle: uniqueHandle(), email: alias });

		const rows = await query<{ count: number }>(
			`select count(*)::int as count from waitlist_reservations where email_key = $1`,
			[`${local}@gmail.com`]
		);

		expect(rows[0]?.count).toBe(1);

		await query(`delete from waitlist_reservations where email_key = $1`, [`${local}@gmail.com`]);
	});
});
