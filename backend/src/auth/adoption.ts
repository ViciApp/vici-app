// Adoption of importer-provisioned accounts. The data migration owns every
// legacy principal's rows through a provisional claim_pending user linked
// with matched_via = 'etl'; this module hands such an account to the real
// person once they prove who they are: a first verified sign-in whose email
// matches the exported legacy identity adopts the provisional account itself,
// so no empty twin account is ever created.
//
// Two populated accounts are never merged: user ids are embedded in activity
// and relation keys, and VXP was paid to each account's own derived
// principal, so no per-table merge rule is safe. Those cases are recorded in
// legacy_adoption_conflicts for an admin instead.
//
// Lock order: the per-email login advisory locks first (sorted), then users
// rows (ascending id when more than one), then the legacy_principals row.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';

export type AdoptionMatch = 'openid_email' | 'profile_email';

type ConflictReason = 'multiple_matches' | 'account_not_empty';

/** Serialize with every other login touching these addresses for
 * the rest of the transaction. Sorted so two holders of overlapping sets
 * cannot deadlock. */
export const lockLoginEmails = async ({
	q,
	emails
}: {
	q: TxQuery;
	emails: string[];
}): Promise<void> => {
	for (const email of [...new Set(emails)].sort()) {
		await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`login-email:${email}`]);
	}
};

const recordConflict = async ({
	q,
	principal,
	provisionalUserId,
	matchedUserId,
	reason
}: {
	q: TxQuery;
	principal: string;
	provisionalUserId: string;
	matchedUserId: string;
	reason: ConflictReason;
}): Promise<void> => {
	await q(
		`insert into legacy_adoption_conflicts (principal, provisional_user_id, matched_user_id, reason)
		 values ($1, $2, $3, $4)
		 on conflict (principal, matched_user_id)
		 do update set provisional_user_id = excluded.provisional_user_id,
		               reason = excluded.reason,
		               noted_at = now()`,
		[principal, provisionalUserId, matchedUserId, reason]
	);
};

/** Whether `principal` is still the importer link of the claim_pending
 * account `userId`; locks the link row. Call with the users row already
 * locked (see the lock order above). */
const lockProvisionalLink = async ({
	q,
	principal,
	userId
}: {
	q: TxQuery;
	principal: string;
	userId: string;
}): Promise<boolean> => {
	const rows = await q<{ principal: string }>(
		`select lp.principal
		 from legacy_principals lp
		 join users u on u.id = lp.user_id
		 where lp.principal = $1 and lp.user_id = $2 and lp.matched_via = 'etl' and u.claim_pending
		 for update of lp`,
		[principal, userId]
	);

	return nonNullish(rows[0]);
};

/** Turn a locked provisional account into a regular one reached through
 * `principal`'s link, upgrading that link's provenance. */
const finalizeAdoption = async ({
	q,
	provisionalUserId,
	principal,
	matchedVia,
	displayName
}: {
	q: TxQuery;
	provisionalUserId: string;
	principal: string;
	matchedVia: AdoptionMatch;
	displayName: string | null;
}): Promise<void> => {
	await q(
		`update users
		 set claim_pending = false, display_name = coalesce(display_name, $2)
		 where id = $1`,
		[provisionalUserId, displayName]
	);

	await q(`update legacy_principals set matched_via = $2, linked_at = now() where principal = $1`, [
		principal,
		matchedVia
	]);
};

interface AdoptionCandidate {
	principal: string;
	user_id: string;
	via_openid: boolean;
}

/** Lock and adopt one ranked candidate; false when a concurrent adoption
 * took it since the ranking read (the row lock waits that one out and the
 * claim_pending re-check then skips the account). */
const tryAdoptCandidate = async ({
	q,
	candidate,
	displayName
}: {
	q: TxQuery;
	candidate: AdoptionCandidate;
	displayName: string | null;
}): Promise<boolean> => {
	const locked = await q<{ id: string }>(
		`select id from users where id = $1 and claim_pending for update`,
		[candidate.user_id]
	);

	if (
		isNullish(locked[0]) ||
		!(await lockProvisionalLink({ q, principal: candidate.principal, userId: candidate.user_id }))
	) {
		return false;
	}

	await finalizeAdoption({
		q,
		provisionalUserId: candidate.user_id,
		principal: candidate.principal,
		matchedVia: candidate.via_openid ? 'openid_email' : 'profile_email',
		displayName
	});

	return true;
};

/**
 * First-login adoption: the provisional account this verified email should
 * take over, adopted in place (claim_pending cleared, link provenance
 * upgraded), or undefined when there is none. Candidates rank openid matches
 * (provider-asserted) before profile matches (self-reported), then by
 * imported feed activity, then by principal for a stable order. Every other
 * candidate is left provisional and recorded for an admin.
 *
 * The caller must hold the email's login lock (`lockLoginEmails`) and attach
 * the auth identity to the returned user in the same transaction.
 */
export const adoptOnFirstLogin = async ({
	q,
	email,
	displayName
}: {
	q: TxQuery;
	email: string;
	displayName: string | null;
}): Promise<string | undefined> => {
	const candidates = await q<AdoptionCandidate>(
		`select lp.principal, lp.user_id,
		        coalesce(lower(lai.openid_email) = $1, false) as via_openid
		 from legacy_auth_identities lai
		 join legacy_principals lp on lp.principal = lai.principal and lp.matched_via = 'etl'
		 join users u on u.id = lp.user_id and u.claim_pending
		 where lower(lai.openid_email) = $1 or lower(lai.profile_email) = $1
		 order by via_openid desc,
		          (select count(*) from activities a where a.user_id = lp.user_id) desc,
		          lp.principal`,
		[email]
	);

	let adopted: string | undefined;
	const leftovers: AdoptionCandidate[] = [];

	for (const candidate of candidates) {
		if (nonNullish(adopted)) {
			leftovers.push(candidate);
		} else if (await tryAdoptCandidate({ q, candidate, displayName })) {
			adopted = candidate.user_id;
		}
	}

	if (nonNullish(adopted)) {
		for (const leftover of leftovers) {
			await recordConflict({
				q,
				principal: leftover.principal,
				provisionalUserId: leftover.user_id,
				matchedUserId: adopted,
				reason: 'multiple_matches'
			});
		}
	}

	return adopted;
};

export interface AdoptionConflict {
	principal: string;
	provisionalUserId: string;
	matchedUserId: string;
	reason: ConflictReason;
	notedAt: string;
}

/** Recorded leftovers whose provisional account is still unadopted, newest
 * first: the admin work queue. */
export const listAdoptionConflicts = async (): Promise<AdoptionConflict[]> => {
	const rows = await query<{
		principal: string;
		provisional_user_id: string;
		matched_user_id: string;
		reason: ConflictReason;
		noted_at: Date;
	}>(
		`select c.principal, c.provisional_user_id, c.matched_user_id, c.reason, c.noted_at
		 from legacy_adoption_conflicts c
		 join users u on u.id = c.provisional_user_id
		 where u.claim_pending
		 order by c.noted_at desc, c.principal`
	);

	return rows.map((r) => ({
		principal: r.principal,
		provisionalUserId: r.provisional_user_id,
		matchedUserId: r.matched_user_id,
		reason: r.reason,
		notedAt: r.noted_at.toISOString()
	}));
};
