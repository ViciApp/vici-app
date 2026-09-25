// Identity resolution: map a freshly verified provider identity to a user,
// provisioning on first sign-in and linking new providers to an existing
// account by verified email. Every caller must only pass identities whose
// email ownership has been proven (OTP-verified or provider-asserted).
//
// A first sign-in whose email matches an exported legacy identity adopts the
// provisional account the data migration created for that principal (see
// adoption.ts) instead of provisioning an empty one. The legacy auto-match
// then links any still-unlinked legacy principal carrying the same email, so
// on-chain history follows the user to this stack without a manual claim.

import { isNullish, nonNullish } from '@dfinity/utils';
import { tx, type TxQuery } from '../db/client';
import { adoptOnFirstLogin } from './adoption';

export type Provider = 'google' | 'apple' | 'email';

export interface VerifiedIdentity {
	provider: Provider;
	subject: string;
	email: string;
	displayName?: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Link every legacy principal carrying this email that no account holds
 * yet. Provider-asserted addresses first: an openid email was verified by
 * the legacy identity provider, a profile email was merely self-reported.
 * `on conflict do nothing` keeps a principal already held by another account
 * (or by the openid pass) untouched. */
const linkUnheldPrincipals = async ({
	q,
	userId,
	email
}: {
	q: TxQuery;
	userId: string;
	email: string;
}): Promise<void> => {
	await q(
		`insert into legacy_principals (principal, user_id, matched_via)
		 select principal, $1, 'openid_email'
		 from legacy_auth_identities
		 where lower(openid_email) = $2
		 on conflict (principal) do nothing`,
		[userId, email]
	);

	await q(
		`insert into legacy_principals (principal, user_id, matched_via)
		 select principal, $1, 'profile_email'
		 from legacy_auth_identities
		 where lower(profile_email) = $2
		 on conflict (principal) do nothing`,
		[userId, email]
	);
};

/** The auto-match for an account that has no legacy link yet; once the link
 * set is non-empty it is settled and later logins leave it alone. */
const linkLegacyPrincipals = async ({
	q,
	userId,
	email
}: {
	q: TxQuery;
	userId: string;
	email: string;
}): Promise<void> => {
	const linked = await q<{ principal: string }>(
		`select principal from legacy_principals where user_id = $1 limit 1`,
		[userId]
	);

	if (nonNullish(linked[0])) {
		return;
	}

	await linkUnheldPrincipals({ q, userId, email });
};

/** Resolve (or provision, or adopt) the user behind a verified identity; the
 * user id. One transaction under a per-email advisory lock, so concurrent
 * first logins for one address run one after the other: the second finds the
 * identity the first attached instead of provisioning or adopting again. */
export const resolveIdentity = (identity: VerifiedIdentity): Promise<string> => {
	const email = normalizeEmail(identity.email);
	const displayName = identity.displayName?.trim() ?? '';

	return tx(async (q) => {
		await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`login-email:${email}`]);

		const bySubject = await q<{ user_id: string }>(
			`select user_id from auth_identities where provider = $1 and subject = $2`,
			[identity.provider, identity.subject]
		);
		const knownUserId = bySubject[0]?.user_id;

		if (nonNullish(knownUserId)) {
			await linkLegacyPrincipals({ q, userId: knownUserId, email });

			return knownUserId;
		}

		// A verified email proves ownership, so a new provider attaches to the
		// account that already holds that address under another provider.
		const byEmail = await q<{ user_id: string }>(
			`select user_id from auth_identities where lower(email) = $1 limit 1`,
			[email]
		);
		let userId = byEmail[0]?.user_id;
		let adopted = false;

		if (isNullish(userId)) {
			userId = await adoptOnFirstLogin({
				q,
				email,
				displayName: displayName === '' ? null : displayName
			});
			adopted = nonNullish(userId);
		}

		if (isNullish(userId)) {
			const inserted = await q<{ id: string }>(
				`insert into users (display_name) values ($1) returning id`,
				[displayName === '' ? null : displayName]
			);
			const insertedId = inserted[0]?.id;

			if (isNullish(insertedId)) {
				throw new Error('user insert returned no row');
			}

			userId = insertedId;
		}

		await q(
			`insert into auth_identities (user_id, provider, subject, email)
			 values ($1, $2, $3, $4)`,
			[userId, identity.provider, identity.subject, email]
		);

		// An adopted account already holds its importer link, which would
		// short-circuit the "no link yet" gate; its unheld siblings still link.
		if (adopted) {
			await linkUnheldPrincipals({ q, userId, email });
		} else {
			await linkLegacyPrincipals({ q, userId, email });
		}

		return userId;
	});
};
