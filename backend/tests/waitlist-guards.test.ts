import { assertNonNullish } from '@dfinity/utils';
import { describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { checkNicknameAvailability } from '../src/profiles/nickname';
import { pruneWaitlist, waitlistRemoveToken } from '../src/waitlist/reservations';
import { createTestUser, uniqueEmail } from './helpers/auth';
import { dbAvailable } from './helpers/setup';
import {
	CODE_LIMIT_PER_TEN_MINUTES,
	DISPOSABLE_DOMAIN,
	ENABLED,
	GLOBAL_WINDOW_KEY,
	SENDS_PER_DAY,
	TURNSTILE_ACTION,
	UNCONFIGURED_PROD,
	answering,
	errorOf,
	post,
	requestCode,
	reservationOf,
	uniqueHandle,
	uniqueIp,
	useWaitlistHarness
} from './helpers/waitlist';

// The waitlist's guards and its other routes: input checks, Turnstile, the
// limits, the stored invite, the status token, removal and the prune.

describe.if(dbAvailable)('handle waitlist: guards and upkeep', () => {
	const { sent, clearSent, useTurnstile, join } = useWaitlistHarness();

	test('the handle rule, a reserved name and a bad or disposable address', async () => {
		for (const handle of ['ab', 'Abc123', 'a.bcd', 'admin']) {
			const response = await requestCode({ handle, email: uniqueEmail() });

			expect(response.status).toBe(400);
			expect(await errorOf(response)).toBe('handle_invalid');
		}

		for (const email of ['', 'no-at-sign', '@example.com', `${'a'.repeat(250)}@example.com`]) {
			expect(await errorOf(await requestCode({ handle: uniqueHandle(), email }))).toBe(
				'email_invalid'
			);
		}

		for (const domain of [DISPOSABLE_DOMAIN, `mx.${DISPOSABLE_DOMAIN}`]) {
			const response = await requestCode({ handle: uniqueHandle(), email: `x@${domain}` });

			expect(response.status).toBe(400);
			expect(await errorOf(response)).toBe('email_not_accepted');
		}

		expect(sent()).toHaveLength(0);
	});

	test('each Turnstile verdict', async () => {
		useTurnstile({ config: ENABLED, call: answering({ success: false }) });

		expect(await errorOf(await requestCode({ handle: uniqueHandle(), email: uniqueEmail() }))).toBe(
			'turnstile_failed'
		);

		useTurnstile({ config: ENABLED, call: answering({ success: true, action: 'email_code' }) });

		expect(await errorOf(await requestCode({ handle: uniqueHandle(), email: uniqueEmail() }))).toBe(
			'turnstile_failed'
		);

		useTurnstile({ config: ENABLED, call: () => Promise.reject(new Error('down')) });

		const unavailable = await requestCode({ handle: uniqueHandle(), email: uniqueEmail() });

		expect(unavailable.status).toBe(503);
		expect(await errorOf(unavailable)).toBe('turnstile_unavailable');

		useTurnstile({ config: UNCONFIGURED_PROD });

		expect(await errorOf(await requestCode({ handle: uniqueHandle(), email: uniqueEmail() }))).toBe(
			'turnstile_unconfigured'
		);

		useTurnstile({ config: ENABLED, call: answering({ success: true, action: TURNSTILE_ACTION }) });

		expect((await requestCode({ handle: uniqueHandle(), email: uniqueEmail() })).status).toBe(200);
		expect(sent()).toHaveLength(1);
	});

	test('the IP limit answers 429 with Retry-After', async () => {
		const ip = uniqueIp();

		for (let i = 0; i < CODE_LIMIT_PER_TEN_MINUTES; i++) {
			await requestCode({ handle: uniqueHandle(), email: uniqueEmail(), ip });
		}

		const limited = await requestCode({ handle: uniqueHandle(), email: uniqueEmail(), ip });

		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	test('the send cap counts every mail to one mailbox', async () => {
		const email = uniqueEmail();

		for (let i = 0; i < SENDS_PER_DAY; i++) {
			expect((await requestCode({ handle: uniqueHandle(), email })).status).toBe(200);
		}

		const capped = await requestCode({ handle: uniqueHandle(), email });

		expect(capped.status).toBe(429);
		expect(Number(capped.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(sent()).toHaveLength(SENDS_PER_DAY);
	});

	test('the global breaker answers 429', async () => {
		await query(
			`insert into rate_limit_windows (key, count, reset_at) values ($1, 100000, now() + interval '1 hour')
			 on conflict (key) do update set count = 100000, reset_at = now() + interval '1 hour'`,
			[GLOBAL_WINDOW_KEY]
		);

		const response = await requestCode({ handle: uniqueHandle(), email: uniqueEmail() });

		expect(response.status).toBe(429);
		expect(sent()).toHaveLength(0);
	});

	test('the stored invite: the latest link wins, a plain or malformed one keeps it', async () => {
		const email = uniqueEmail();

		await requestCode({ handle: uniqueHandle(), email, extra: { referralCode: 'abcd2345' } });

		expect((await reservationOf(email))?.invited_referral_code).toBe('ABCD2345');

		await requestCode({ handle: uniqueHandle(), email });

		expect((await reservationOf(email))?.invited_referral_code).toBe('ABCD2345');

		await requestCode({
			handle: uniqueHandle(),
			email,
			extra: { challengeId: 'ABCDEFGH23456789' }
		});

		const row = await reservationOf(email);

		expect(row?.invited_referral_code).toBeNull();
		expect(row?.invited_challenge_id).toBe('ABCDEFGH23456789');

		const malformed = await requestCode({
			handle: uniqueHandle(),
			email,
			extra: { referralCode: 'not a code', challengeId: 'x'.repeat(40) }
		});

		expect(malformed.status).toBe(200);
		expect((await reservationOf(email))?.invited_challenge_id).toBe('ABCDEFGH23456789');
	});

	test('the status token reads the reservation back, and nothing once it is gone', async () => {
		const email = uniqueEmail();
		const handle = uniqueHandle();
		const { statusToken } = await join({ handle, email });

		const status = await post({ path: '/status', body: { statusToken } });

		expect(await status.json()).toEqual({ handle, state: 'waiting' });

		const unknown = await post({ path: '/status', body: { statusToken: 'nope' } });

		expect(unknown.status).toBe(404);
		expect(await errorOf(unknown)).toBe('not_found');

		await query(`delete from waitlist_reservations where email_key = $1`, [email]);

		expect((await post({ path: '/status', body: { statusToken } })).status).toBe(404);
	});

	test('the remove link: a wrong token removes nothing, the right one deletes and frees the handle', async () => {
		const email = uniqueEmail();
		const handle = uniqueHandle();

		await join({ handle, email });

		const row = await reservationOf(email);

		assertNonNullish(row);

		const link = sent().at(-1)?.text ?? '';

		expect(link).toContain(`r=${row.id}`);
		expect(link).toContain(`t=${encodeURIComponent(waitlistRemoveToken(row.id))}`);

		clearSent();

		const wrong = await post({ path: '/remove', body: { id: row.id, token: 'forged' } });

		expect(await wrong.json()).toEqual({ removed: true });
		expect(await reservationOf(email)).toBeDefined();
		expect(sent()).toHaveLength(0);

		const notAnId = await post({ path: '/remove', body: { id: 'not-a-uuid', token: 'x' } });

		expect(await notAnId.json()).toEqual({ removed: true });

		const right = await post({
			path: '/remove',
			body: { id: row.id, token: waitlistRemoveToken(row.id) }
		});

		expect(await right.json()).toEqual({ removed: true });
		expect(await reservationOf(email)).toBeUndefined();
		expect(await checkNicknameAvailability({ nickname: handle })).toEqual({ available: true });
		expect(sent()).toHaveLength(1);
		expect(sent()[0]?.to).toBe(email);
		expect(sent()[0]?.subject).toBe("You're off the VICI waitlist");
	});

	test('the admin delete: 401, 403, deleted, absent', async () => {
		const email = uniqueEmail();

		await join({ handle: uniqueHandle(), email });

		const remove = async (cookie?: string): Promise<Response> =>
			await post({ path: '/admin/reservations', method: 'DELETE', body: { email }, cookie });

		expect((await remove()).status).toBe(401);

		const user = await createSession(await createTestUser());

		expect((await remove(`vici_session=${user}`)).status).toBe(403);

		const admin = `vici_session=${await createSession(await createTestUser('admin'))}`;

		expect(await (await remove(admin)).json()).toEqual({ removed: true });
		expect(await reservationOf(email)).toBeUndefined();
		expect(await (await remove(admin)).json()).toEqual({ removed: false });
	});

	test('the prune deletes an unconfirmed row a day after its request, once', async () => {
		const stale = uniqueEmail();
		const fresh = uniqueEmail();
		const confirmed = uniqueEmail();

		await requestCode({ handle: uniqueHandle(), email: stale });
		await requestCode({ handle: uniqueHandle(), email: fresh });
		await join({ handle: uniqueHandle(), email: confirmed });
		await query(
			`update waitlist_reservations set code_expires_at = now() - interval '1 day'
			 where email_key = any($1::text[])`,
			[[stale, confirmed]]
		);

		expect(await pruneWaitlist()).toBeGreaterThanOrEqual(1);
		expect(await reservationOf(stale)).toBeUndefined();
		expect(await reservationOf(fresh)).toBeDefined();
		expect(await reservationOf(confirmed)).toBeDefined();
		expect(await pruneWaitlist()).toBe(0);
	});
});
