// Identity resolution: map a freshly verified provider identity to a user,
// provisioning on first sign-in and linking new providers to an existing
// account by verified email. Every caller must only pass identities whose
// email ownership has been proven (OTP-verified or provider-asserted).

import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { query, tx, type TxQuery } from '../db/client';
import { settledTotalsByPrincipal, type SettledTotals } from '../engine/clearing';
import { userIcPrincipalText } from '../lib/keys';
import { logger } from '../lib/logger';

export type Provider = 'google' | 'apple' | 'email';

export interface VerifiedIdentity {
	provider: Provider;
	subject: string;
	email: string;
	displayName?: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Serialize with every other login touching these addresses for the rest
 * of the transaction. Sorted so two holders of overlapping sets cannot
 * deadlock. */
const lockLoginEmails = async ({ q, emails }: { q: TxQuery; emails: string[] }): Promise<void> => {
	for (const email of [...new Set(emails)].sort()) {
		await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`login-email:${email}`]);
	}
};

/** Resolve (or provision) the user behind a verified identity; the user id.
 * One transaction under the per-email login lock, so concurrent first logins
 * for one address run one after the other: the later one finds the identity
 * the earlier one attached instead of provisioning again. */
export const resolveIdentity = (identity: VerifiedIdentity): Promise<string> => {
	const email = normalizeEmail(identity.email);
	const displayName = identity.displayName?.trim() ?? '';

	return tx(async (q) => {
		await lockLoginEmails({ q, emails: [email] });

		// A hard-deleted account is never signed back into: its identities are
		// purged with it, and the join keeps a row that slipped past the purge
		// from resolving to it.
		const bySubject = await q<{ user_id: string }>(
			`select ai.user_id from auth_identities ai
			 join users u on u.id = ai.user_id and u.hard_deleted_at is null
			 where ai.provider = $1 and ai.subject = $2`,
			[identity.provider, identity.subject]
		);
		const knownUserId = bySubject[0]?.user_id;

		if (nonNullish(knownUserId)) {
			return knownUserId;
		}

		// A verified email proves ownership, so a new provider attaches to the
		// account that already holds that address under another provider.
		const byEmail = await q<{ user_id: string }>(
			`select ai.user_id from auth_identities ai
			 join users u on u.id = ai.user_id and u.hard_deleted_at is null
			 where lower(ai.email) = $1 limit 1`,
			[email]
		);
		let userId = byEmail[0]?.user_id;

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

		return userId;
	});
};

/** Remove every way to sign in to `userId`: its provider identities and any
 * one-time code still pending for their addresses. Runs inside the caller's
 * transaction and takes the per-email login locks first, so a concurrent
 * first login for one of these addresses runs after the purge and provisions
 * a new account. Idempotent. */
export const deleteSignInIdentities = async ({
	q,
	userId
}: {
	q: TxQuery;
	userId: string;
}): Promise<void> => {
	const rows = await q<{ email: string }>(
		`select distinct lower(email) as email
		 from auth_identities
		 where user_id = $1 and email is not null`,
		[userId]
	);
	const emails = rows.map(({ email }) => email);

	await lockLoginEmails({ q, emails });

	await q(`delete from otp_codes where lower(email) = any($1::text[])`, [emails]);
	await q(`delete from auth_identities where user_id = $1`, [userId]);
};

/**
 * Every on-chain principal each user can have settled under, keyed by user
 * id: the derived custodial principal plus any linked legacy principals, so
 * history from before an account was matched still counts. The one mapping
 * every settled-history score (battles, the Worlds podium, tournament
 * matches) reads members through.
 */
export const settlementPrincipalsByUser = async (
	userIds: readonly string[]
): Promise<Map<string, string[]>> => {
	const principals = new Map(userIds.map((userId) => [userId, [userIcPrincipalText(userId)]]));

	if (userIds.length === 0) {
		return principals;
	}

	const rows = await query<{ user_id: string; principal: string }>(
		`select user_id, principal from legacy_principals where user_id = any($1::uuid[])`,
		[[...userIds]]
	);

	for (const row of rows) {
		principals.get(row.user_id)?.push(row.principal);
	}

	return principals;
};

/** A stored principal text as a principal, or nothing when it does not parse:
 * nothing can settle under it, and one unreadable row must not fail a read
 * that spans every account (the tournament draw, the global leaderboard). */
export const parsedPrincipal = (text: string): Principal | undefined => {
	try {
		return Principal.fromText(text);
	} catch {
		// Left out of the read.
	}
};

/**
 * {@link settlementPrincipalsByUser} as principals. A linked principal that
 * does not parse is left out and counted in one warning tagged `read`, so one
 * bad row never fails a score read over many members (a tournament match, a
 * battle side, a prize claim).
 */
export const parsedSettlementPrincipalsByUser = async ({
	userIds,
	read
}: {
	userIds: readonly string[];
	read: string;
}): Promise<Map<string, Principal[]>> => {
	const parsed = new Map<string, Principal[]>();
	let unparsed = 0;

	for (const [userId, texts] of await settlementPrincipalsByUser(userIds)) {
		const principals = texts.map(parsedPrincipal).filter(nonNullish);

		unparsed += texts.length - principals.length;
		parsed.set(userId, principals);
	}

	if (unparsed > 0) {
		logger.warn(`${read}: skipped ${unparsed} linked principal(s) that do not parse`);
	}

	return parsed;
};

/**
 * Each user's settled-position totals over [fromMs, toMs), summed across
 * every principal {@link parsedSettlementPrincipalsByUser} gives them. A user
 * with nothing settled in the window is absent.
 */
export const settledTotalsByUser = async ({
	userIds,
	fromMs,
	toMs
}: {
	userIds: readonly string[];
	fromMs: number;
	toMs: number;
}): Promise<Map<string, SettledTotals>> => {
	const userOfPrincipal = new Map<string, string>();
	const members: Principal[] = [];

	for (const [userId, principals] of await parsedSettlementPrincipalsByUser({
		userIds,
		read: 'settled totals'
	})) {
		for (const principal of principals) {
			userOfPrincipal.set(principal.toText(), userId);
			members.push(principal);
		}
	}

	const settled = await settledTotalsByPrincipal({ members, fromMs, toMs });
	const totals = new Map<string, SettledTotals>();

	for (const [principal, { calls, wins }] of settled) {
		const userId = userOfPrincipal.get(principal);

		if (nonNullish(userId)) {
			const previous = totals.get(userId) ?? { calls: 0, wins: 0 };

			totals.set(userId, { calls: previous.calls + calls, wins: previous.wins + wins });
		}
	}

	return totals;
};
