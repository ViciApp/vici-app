import { beforeAll, describe, expect, test } from 'bun:test';
import { resolveIdentity } from '../src/auth/identity';
import { createOtp, verifyOtp } from '../src/auth/otp';
import { query } from '../src/db/client';
import { ensureMigrated, uniqueEmail, uniquePrincipal } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const seedLegacyIdentity = async ({
	principal,
	openidEmail = null,
	profileEmail = null
}: {
	principal: string;
	openidEmail?: string | null;
	profileEmail?: string | null;
}): Promise<void> => {
	await query(
		`insert into legacy_auth_identities (principal, provider, openid_email, profile_email)
		 values ($1, 'google', $2, $3)`,
		[principal, openidEmail, profileEmail]
	);
};

const linksFor = (userId: string): Promise<{ principal: string; matched_via: string }[]> =>
	query<{ principal: string; matched_via: string }>(
		`select principal, matched_via from legacy_principals where user_id = $1 order by principal`,
		[userId]
	);

describe.if(dbAvailable)('legacy principal auto-match', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('matches by openid_email on first verified login', async () => {
		const email = uniqueEmail();
		const principal = uniquePrincipal();

		await seedLegacyIdentity({ principal, openidEmail: email });

		const result = await verifyOtp({ email, code: await createOtp(email) });

		expect(result.ok).toBe(true);

		if (!result.ok) {
			throw new Error('unreachable');
		}

		expect(await linksFor(result.userId)).toEqual([{ principal, matched_via: 'openid_email' }]);
	});

	test('falls back to profile_email when no openid_email matches', async () => {
		const email = uniqueEmail();
		const principal = uniquePrincipal();

		await seedLegacyIdentity({ principal, profileEmail: email });

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(await linksFor(userId)).toEqual([{ principal, matched_via: 'profile_email' }]);
	});

	test('openid_email wins over profile_email for the same principal', async () => {
		const email = uniqueEmail();
		const principal = uniquePrincipal();

		await seedLegacyIdentity({ principal, openidEmail: email, profileEmail: email });

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(await linksFor(userId)).toEqual([{ principal, matched_via: 'openid_email' }]);
	});

	test('no legacy row means no link', async () => {
		const email = uniqueEmail();
		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(await linksFor(userId)).toEqual([]);
	});

	test('a later login does not duplicate or rewrite an existing link', async () => {
		const email = uniqueEmail();
		const principal = uniquePrincipal();

		await seedLegacyIdentity({ principal, openidEmail: email });

		const first = await resolveIdentity({ provider: 'email', subject: email, email });

		// A legacy row appearing after the first match must not attach to an
		// already-linked account: the link set is settled once non-empty.
		await seedLegacyIdentity({ principal: uniquePrincipal(), openidEmail: email });

		const second = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(second).toBe(first);
		expect(await linksFor(first)).toEqual([{ principal, matched_via: 'openid_email' }]);
	});

	test('a principal already claimed by another account is not stolen', async () => {
		const emailA = uniqueEmail();
		const emailB = uniqueEmail();
		const principal = uniquePrincipal();

		// Both addresses appear on the same legacy identity (openid vs profile).
		await seedLegacyIdentity({ principal, openidEmail: emailA, profileEmail: emailB });

		const userA = await resolveIdentity({ provider: 'email', subject: emailA, email: emailA });
		const userB = await resolveIdentity({ provider: 'email', subject: emailB, email: emailB });

		expect(await linksFor(userA)).toEqual([{ principal, matched_via: 'openid_email' }]);
		expect(await linksFor(userB)).toEqual([]);
	});

	test('matching links every principal that carried the email', async () => {
		const email = uniqueEmail();
		const p1 = uniquePrincipal();
		const p2 = uniquePrincipal();

		await seedLegacyIdentity({ principal: p1, openidEmail: email });
		await seedLegacyIdentity({ principal: p2, profileEmail: email });

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });
		const links = await linksFor(userId);

		expect(links).toHaveLength(2);
		expect(links.find((l) => l.principal === p1)?.matched_via).toBe('openid_email');
		expect(links.find((l) => l.principal === p2)?.matched_via).toBe('profile_email');
	});

	test('a provider identity with the same verified email joins the same user', async () => {
		const email = uniqueEmail();
		const viaOtp = await resolveIdentity({ provider: 'email', subject: email, email });
		const viaGoogle = await resolveIdentity({
			provider: 'google',
			subject: `google-sub-${email}`,
			email
		});

		expect(viaGoogle).toBe(viaOtp);

		const identities = await query<{ provider: string }>(
			`select provider from auth_identities where user_id = $1 order by provider`,
			[viaOtp]
		);

		expect(identities.map((i) => i.provider)).toEqual(['email', 'google']);
	});
});
