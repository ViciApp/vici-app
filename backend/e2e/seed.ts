// Seeds the E2E database with the fixture accounts. Idempotent, so a local
// re-run converges instead of failing:
//
//   - the legacy accounts are provisional claim_pending users linked with
//     matched_via = 'etl', each with a profile;
//   - their legacy identities carry the emails the login adoption and the
//     beta gate's legacy match read;
//   - the admin account gets an email identity and the admin role, so the
//     specs can drive the admin settings API after a normal OTP sign-in;
//   - the beta gate starts open: a local run interrupted mid-spec can leave it
//     set, and every spec except the gate's own assumes it is off.
//
// Run with `bun run e2e:seed` after `bun run migrate`.

import { isNullish, nonNullish } from '@dfinity/utils';
import { deleteAppSetting } from '../src/admin/settings';
import { BETA_GATE_SETTING_KEY } from '../src/auth/beta-gate';
import { normalizeEmail } from '../src/auth/identity';
import { pool, query } from '../src/db/client';
import { seedProvisionalAccount } from '../tests/helpers/adoption';
import { E2E_ADMIN_EMAIL, E2E_LEGACY_ADOPT, E2E_LEGACY_PENDING } from './fixtures';
import { assertE2eEnvironment } from './guard';

const seedLegacyAccounts = async (): Promise<void> => {
	const accounts = [E2E_LEGACY_ADOPT, E2E_LEGACY_PENDING];

	for (const { principal, nickname } of accounts) {
		await seedProvisionalAccount({ principal, nickname, points: 1250, level: 3 });
	}

	for (const { principal, email } of accounts) {
		await query(
			`insert into legacy_auth_identities (principal, provider, openid_email, profile_email)
			 values ($1, 'google', $2, $2)
			 on conflict (principal) do update
			   set openid_email = excluded.openid_email, profile_email = excluded.profile_email`,
			[principal, email]
		);
	}
};

const seedAdmin = async (): Promise<void> => {
	const email = normalizeEmail(E2E_ADMIN_EMAIL);
	const existing = await query<{ user_id: string }>(
		`select user_id from auth_identities where provider = 'email' and subject = $1`,
		[email]
	);
	const existingUserId = existing[0]?.user_id;

	if (nonNullish(existingUserId)) {
		await query(`update users set role = 'admin' where id = $1`, [existingUserId]);

		return;
	}

	const created = await query<{ id: string }>(
		`insert into users (role) values ('admin') returning id`
	);
	const userId = created[0]?.id;

	if (isNullish(userId)) {
		throw new Error('admin user insert returned no row');
	}

	await query(
		`insert into auth_identities (user_id, provider, subject, email) values ($1, 'email', $2, $2)`,
		[userId, email]
	);
};

if (import.meta.main) {
	assertE2eEnvironment(process.env);

	await seedLegacyAccounts();
	await seedAdmin();
	await deleteAppSetting(BETA_GATE_SETTING_KEY);

	console.log('e2e seed applied');

	await pool.end();
}
