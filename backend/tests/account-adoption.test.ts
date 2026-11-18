// Login adoption of importer-provisioned accounts: a first verified sign-in
// whose email matches an exported legacy identity takes over the provisional
// account (no empty twin), races serialize, several matching provisional
// accounts adopt one deterministically and record the rest for an admin, and
// the emptiness verdict the claim path relies on.

import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { isAccountEmpty } from '../src/auth/adoption';
import { resolveIdentity } from '../src/auth/identity';
import { createOtp } from '../src/auth/otp';
import { createSession } from '../src/auth/sessions';
import { query, tx } from '../src/db/client';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';
import { claimPendingOf, linkOf, seedImportedAccount, userCount } from './helpers/adoption';
import { createTestUser, ensureMigrated, uniqueEmail, uniquePrincipal } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const profileNicknameFor = async (cookie: string): Promise<string | undefined> => {
	const res = await app.handle(
		new Request('http://localhost/api/v1/profiles/me', { headers: { cookie } })
	);
	const body = (await res.json()) as { profile: { nickname: string } | null };

	return body.profile?.nickname;
};

const activityCount = async (userId: string): Promise<number> => {
	const rows = await query<{ count: string }>(
		`select count(*) from activities where user_id = $1`,
		[userId]
	);

	return Number(rows[0]?.count ?? 0);
};

const identitiesOf = (userId: string): Promise<{ provider: string }[]> =>
	query<{ provider: string }>(
		`select provider from auth_identities where user_id = $1 order by provider`,
		[userId]
	);

describe.if(dbAvailable)('login adoption of provisional accounts', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	test('a first Google login adopts the imported account instead of creating one', async () => {
		const email = uniqueEmail();
		const imported = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: email
		});
		const before = await userCount();

		const userId = await resolveIdentity({
			provider: 'google',
			subject: `google-${email}`,
			email,
			displayName: 'Imported Person'
		});

		expect(userId).toBe(imported.userId);
		expect(await userCount()).toBe(before);
		expect(await claimPendingOf(userId)).toBe(false);
		expect(await linkOf(imported.principal)).toEqual({
			user_id: userId,
			matched_via: 'openid_email'
		});
		expect(await identitiesOf(userId)).toEqual([{ provider: 'google' }]);

		const token = await createSession(userId);

		expect(await profileNicknameFor(`vici_session=${token}`)).toBe(imported.nickname);
		expect(await activityCount(userId)).toBe(1);
	});

	test('an email OTP sign-in adopts through profile_email', async () => {
		const email = uniqueEmail();
		const imported = await seedImportedAccount({
			principal: uniquePrincipal(),
			profileEmail: email
		});
		const code = await createOtp(email);
		const res = await app.handle(
			new Request('http://localhost/api/v1/auth/otp/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, code })
			})
		);

		expect(res.status).toBe(200);

		const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
		const me = await app.handle(new Request('http://localhost/api/v1/me', { headers: { cookie } }));
		const meBody = (await me.json()) as { user: { id: string } };

		expect(meBody.user.id).toBe(imported.userId);
		expect(await profileNicknameFor(cookie)).toBe(imported.nickname);
		expect(await linkOf(imported.principal)).toEqual({
			user_id: imported.userId,
			matched_via: 'profile_email'
		});
	});

	test('concurrent first logins adopt exactly once', async () => {
		const email = uniqueEmail();
		const imported = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: email
		});
		const before = await userCount();

		const results = await Promise.all([
			resolveIdentity({ provider: 'google', subject: `google-${email}`, email }),
			resolveIdentity({ provider: 'google', subject: `google-${email}`, email }),
			resolveIdentity({ provider: 'email', subject: email, email })
		]);

		expect(new Set(results)).toEqual(new Set([imported.userId]));
		expect(await userCount()).toBe(before);
		expect(await identitiesOf(imported.userId)).toEqual([
			{ provider: 'email' },
			{ provider: 'google' }
		]);
	});

	test('a brand-new address with no legacy match still provisions a fresh account', async () => {
		const email = uniqueEmail();
		const before = await userCount();
		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(await userCount()).toBe(before + 1);
		expect(await claimPendingOf(userId)).toBe(false);

		const links = await query(`select 1 from legacy_principals where user_id = $1`, [userId]);

		expect(links).toEqual([]);
	});

	test('adoption also links unheld principals carrying the same email', async () => {
		const email = uniqueEmail();
		const imported = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: email
		});
		const unheld = uniquePrincipal();

		await query(
			`insert into legacy_auth_identities (principal, provider, profile_email) values ($1, 'passkey', $2)`,
			[unheld, email]
		);

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(userId).toBe(imported.userId);
		expect(await linkOf(unheld)).toEqual({ user_id: userId, matched_via: 'profile_email' });
	});

	test('a returning user never adopts a provisional account that appears later', async () => {
		const email = uniqueEmail();
		const first = await resolveIdentity({ provider: 'email', subject: email, email });
		const late = await seedImportedAccount({ principal: uniquePrincipal(), openidEmail: email });
		const again = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(again).toBe(first);
		expect(await claimPendingOf(late.userId)).toBe(true);
		expect((await linkOf(late.principal))?.matched_via).toBe('etl');
	});

	test('a principal linked to a real account is never adopted from under it', async () => {
		const email = uniqueEmail();
		const owner = await createTestUser();
		const principal = uniquePrincipal();

		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'claim')`,
			[principal, owner]
		);
		await query(
			`insert into legacy_auth_identities (principal, provider, openid_email) values ($1, 'google', $2)`,
			[principal, email]
		);

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(userId).not.toBe(owner);
		expect(await linkOf(principal)).toEqual({ user_id: owner, matched_via: 'claim' });
	});
});

describe.if(dbAvailable)('several provisional accounts for one person', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('the openid match wins; the others stay provisional and are recorded', async () => {
		const email = uniqueEmail();
		const busyProfile = await seedImportedAccount({
			principal: uniquePrincipal(),
			profileEmail: email,
			activities: 5
		});
		const openid = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: email,
			activities: 1
		});

		const userId = await resolveIdentity({
			provider: 'google',
			subject: `google-${email}`,
			email
		});

		expect(userId).toBe(openid.userId);
		expect(await claimPendingOf(busyProfile.userId)).toBe(true);
		expect(await linkOf(busyProfile.principal)).toEqual({
			user_id: busyProfile.userId,
			matched_via: 'etl'
		});

		const conflicts = await query<{
			provisional_user_id: string;
			matched_user_id: string;
			reason: string;
		}>(
			`select provisional_user_id, matched_user_id, reason
			 from legacy_adoption_conflicts where principal = $1`,
			[busyProfile.principal]
		);

		expect(conflicts).toEqual([
			{
				provisional_user_id: busyProfile.userId,
				matched_user_id: userId,
				reason: 'multiple_matches'
			}
		]);
	});

	test('among same-kind matches the account with more imported activity wins', async () => {
		const email = uniqueEmail();
		const quiet = await seedImportedAccount({
			principal: uniquePrincipal(),
			profileEmail: email,
			activities: 1
		});
		const busy = await seedImportedAccount({
			principal: uniquePrincipal(),
			profileEmail: email,
			activities: 3
		});

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(userId).toBe(busy.userId);
		expect(await claimPendingOf(quiet.userId)).toBe(true);
	});

	test('the admin queue lists leftovers until they are adopted', async () => {
		const email = uniqueEmail();
		const leftover = await seedImportedAccount({
			principal: uniquePrincipal(),
			profileEmail: email
		});

		await seedImportedAccount({ principal: uniquePrincipal(), openidEmail: email });

		const matchedUserId = await resolveIdentity({ provider: 'email', subject: email, email });
		const adminToken = await createSession(await createTestUser('admin'));
		type Item = { principal: string } & Record<string, unknown>;

		const list = async (): Promise<Item[]> => {
			const res = await app.handle(
				new Request('http://localhost/api/v1/admin/legacy-adoption-conflicts', {
					headers: { cookie: `vici_session=${adminToken}` }
				})
			);

			expect(res.status).toBe(200);

			return ((await res.json()) as { items: Item[] }).items;
		};

		expect(await list()).toContainEqual({
			principal: leftover.principal,
			provisionalUserId: leftover.userId,
			matchedUserId,
			reason: 'multiple_matches',
			notedAt: expect.any(String)
		});

		await query(`update users set claim_pending = false where id = $1`, [leftover.userId]);

		expect((await list()).map((i) => i.principal)).not.toContain(leftover.principal);
	});

	test('the admin queue is admin-only', async () => {
		const token = await createSession(await createTestUser());
		const res = await app.handle(
			new Request('http://localhost/api/v1/admin/legacy-adoption-conflicts', {
				headers: { cookie: `vici_session=${token}` }
			})
		);

		expect(res.status).toBe(403);
	});
});

describe.if(dbAvailable)('isAccountEmpty', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const empty = (userId: string): Promise<boolean> => tx((q) => isAccountEmpty({ q, userId }));

	test('a freshly provisioned account with identities, sessions and custody rows is empty', async () => {
		const email = uniqueEmail();
		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		await createSession(userId);
		await query(`insert into custody_accounts (user_id, chain, address) values ($1, 'ic', $2)`, [
			userId,
			`addr-${userId}`
		]);

		expect(await empty(userId)).toBe(true);
	});

	test('a profile makes an account non-empty', async () => {
		const { userId } = await createTestProfile();

		expect(await empty(userId)).toBe(false);
	});

	test('a custody account with ledger history makes an account non-empty', async () => {
		const userId = await createTestUser();
		const accounts = await query<{ id: string }>(
			`insert into custody_accounts (user_id, chain, address) values ($1, 'ic', $2) returning id`,
			[userId, `addr-${userId}`]
		);
		const assets = await query<{ id: string }>(
			`select id from assets where chain = 'ic' and symbol = 'VXP'`
		);

		// Two legs netting to zero keep the ledger's global invariant intact.
		await query(
			`insert into ledger_entries (account_id, asset_id, delta, kind, event_key, idempotency_key)
			 values ($1, $2, 1, 'test', $3, $3 || ':0'), ($1, $2, -1, 'test', $3, $3 || ':1')`,
			[accounts[0]?.id, assets[0]?.id, `evt-${userId}`]
		);

		expect(await empty(userId)).toBe(false);
	});

	test('a granted role makes an account non-empty', async () => {
		expect(await empty(await createTestUser('admin'))).toBe(false);
	});
});
