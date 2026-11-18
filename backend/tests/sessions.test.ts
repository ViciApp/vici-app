import { beforeAll, describe, expect, test } from 'bun:test';
import { requireUser } from '../src/auth/guard';
import { createSession, revokeAllForUser, revokeToken, rotateSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { buildCookie, SESSION_COOKIE, sessionCookie } from '../src/lib/cookie';
import { peppered } from '../src/lib/crypto';
import { createTestUser as createUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

/** The user a request carrying `token` resolves to, through the guard every
 * route uses. */
const sessionUserId = async (token: string): Promise<string | null> => {
	const user = await requireUser(
		new Request('http://localhost/api/v1/me', { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
	);

	return user?.id ?? null;
};

describe.if(dbAvailable)('sessions', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('create stores only the peppered hash and resolves back to the user', async () => {
		const userId = await createUser();
		const token = await createSession(userId);

		expect(await sessionUserId(token)).toBe(userId);

		const rows = await query<{ id: string }>(`select id from sessions where user_id = $1`, [
			userId
		]);

		expect(rows[0]?.id).toBe(peppered(token));
		expect(rows[0]?.id).not.toBe(token);
	});

	test('an expired session is invalid', async () => {
		const userId = await createUser();
		const token = await createSession(userId);

		await query(`update sessions set expires_at = now() - interval '1 second' where id = $1`, [
			peppered(token)
		]);

		expect(await sessionUserId(token)).toBeNull();
	});

	test('revoke invalidates the token and is idempotent', async () => {
		const userId = await createUser();
		const token = await createSession(userId);

		await revokeToken(token);

		expect(await sessionUserId(token)).toBeNull();

		await revokeToken(token);
	});

	test('rotation revokes the previous token and issues a fresh valid one', async () => {
		const userId = await createUser();
		const previousToken = await createSession(userId);
		const token = await rotateSession({ userId, previousToken });

		expect(token).not.toBe(previousToken);
		expect(await sessionUserId(previousToken)).toBeNull();
		expect(await sessionUserId(token)).toBe(userId);
	});

	test('rotation without a previous token still creates a session', async () => {
		const userId = await createUser();
		const token = await rotateSession({ userId, previousToken: null });

		expect(await sessionUserId(token)).toBe(userId);
	});

	test('revokeAllForUser signs out every session of the user', async () => {
		const userId = await createUser();
		const a = await createSession(userId);
		const b = await createSession(userId);

		await revokeAllForUser(userId);

		expect(await sessionUserId(a)).toBeNull();
		expect(await sessionUserId(b)).toBeNull();
	});
});

describe('session cookie serialization', () => {
	test('the dev posture: HttpOnly + Lax, host-only, no Secure', () => {
		const cookie = sessionCookie('tok');

		expect(cookie).toStartWith('vici_session=tok');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).not.toContain('Secure');
		expect(cookie).not.toContain('Domain=');
	});

	test('the prod posture adds Secure and the configured domain', () => {
		const cookie = buildCookie('vici_session', 'tok', 3600, {
			secure: true,
			domain: 'vici.app'
		});

		expect(cookie).toContain('Secure');
		expect(cookie).toContain('Domain=vici.app');
		expect(cookie).toContain('Max-Age=3600');
	});

	test('cross-site cookies carry SameSite=None', () => {
		const cookie = buildCookie('vici_apple_state', 's', 600, { sameSite: 'None', secure: true });

		expect(cookie).toContain('SameSite=None');
		expect(cookie).toContain('Secure');
	});
});
