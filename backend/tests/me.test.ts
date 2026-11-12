import { beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { loadMe } from '../src/auth/me';
import { query } from '../src/db/client';
import { createTestUser, ensureMigrated, uniqueEmail, uniquePrincipal } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe.if(dbAvailable)('loadMe', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('answers null for a user row that does not exist', async () => {
		expect(await loadMe(randomUUID())).toBeNull();
	});

	test('returns the user with its identities and legacy principals in link order', async () => {
		const userId = await createTestUser();
		const email = uniqueEmail();
		const [first, second] = [uniquePrincipal(), uniquePrincipal()];

		await query(
			`insert into auth_identities (user_id, provider, subject, email) values ($1, 'email', $2, $2)`,
			[userId, email]
		);
		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'openid_email')`,
			[first, userId]
		);
		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'profile_email')`,
			[second, userId]
		);

		const me = await loadMe(userId);

		expect(me).toMatchObject({
			id: userId,
			role: 'user',
			displayName: null,
			avatarUrl: null,
			identities: [{ provider: 'email', email }],
			legacyPrincipals: [
				{ principal: first, matchedVia: 'openid_email' },
				{ principal: second, matchedVia: 'profile_email' }
			]
		});
		expect(typeof me?.createdAt).toBe('string');
	});
});
