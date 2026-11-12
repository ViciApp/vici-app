import { assertNonNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { requireAdmin, requireUser } from '../src/auth/guard';
import { createSession, revokeToken } from '../src/auth/sessions';
import { app } from '../src/index';
import { createTestUser as createUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const withSession = (token: string): Request =>
	new Request('http://localhost/api/v1/me', {
		headers: { cookie: `vici_session=${token}` }
	});

describe.if(dbAvailable)('auth guards', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('requireUser: null without a cookie and for a forged token', async () => {
		expect(await requireUser(new Request('http://localhost/api/v1/me'))).toBeNull();
		expect(await requireUser(withSession('forged-token'))).toBeNull();
	});

	test('requireUser resolves id and role for a valid session', async () => {
		const userId = await createUser();
		const token = await createSession(userId);

		expect(await requireUser(withSession(token))).toEqual({ id: userId, role: 'user' });
	});

	test('requireUser: null again after revocation', async () => {
		const userId = await createUser();
		const token = await createSession(userId);

		await revokeToken(token);

		expect(await requireUser(withSession(token))).toBeNull();
	});

	test('requireAdmin rejects a plain user and passes an admin', async () => {
		const userToken = await createSession(await createUser('user'));
		const adminId = await createUser('admin');
		const adminToken = await createSession(adminId);

		const user = await requireUser(withSession(userToken));
		const admin = await requireUser(withSession(adminToken));

		assertNonNullish(user);
		assertNonNullish(admin);

		expect(requireAdmin(user)).toBeNull();
		expect(requireAdmin(admin)).toEqual({ id: adminId, role: 'admin' });
	});

	test('GET /api/v1/me answers 401 without a session', async () => {
		const res = await app.handle(new Request('http://localhost/api/v1/me'));

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'unauthenticated' });
	});

	test('GET /api/v1/me shapes the signed-in user', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		const res = await app.handle(withSession(token));

		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			user: { id: string; role: string; identities: unknown[]; legacyPrincipals: unknown[] };
		};

		expect(body.user.id).toBe(userId);
		expect(body.user.role).toBe('user');
		expect(body.user.identities).toBeArray();
		expect(body.user.legacyPrincipals).toBeArray();
	});

	test('POST /auth/logout revokes the session and clears the cookie', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		const res = await app.handle(
			new Request('http://localhost/api/v1/auth/logout', {
				method: 'POST',
				headers: { cookie: `vici_session=${token}` }
			})
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie')).toContain('vici_session=;');
		expect(await requireUser(withSession(token))).toBeNull();
	});
});
