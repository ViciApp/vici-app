// Adoption of importer-provisioned accounts. The data migration owns every
// legacy principal's rows through a provisional claim_pending user linked
// with matched_via = 'etl'; this module hands such an account to the real
// person once they prove who they are:
//
//   - login: a first verified sign-in whose email matches the exported
//     legacy identity adopts the provisional account itself, so no empty
//     twin account is ever created;
//   - claim: a signed principal handoff folds the caller's still-empty
//     account into the provisional one (identities, sessions and links move,
//     the empty user row goes), so the caller keeps their session and lands
//     on the imported history.
//
// Two populated accounts are never merged: user ids are embedded in activity
// and relation keys, and VXP was paid to each account's own derived
// principal, so no per-table merge rule is safe. Those cases are recorded in
// legacy_adoption_conflicts for an admin instead.
//
// Lock order, shared by every path here: users rows first (ascending id when
// more than one), then the legacy_principals row. Login and claim adoptions
// racing on the same provisional account therefore serialize on its users
// row instead of deadlocking.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';

export type AdoptionMatch = 'openid_email' | 'profile_email' | 'claim';

type ConflictReason = 'multiple_matches' | 'account_not_empty';

/**
 * Whether an account holds no user-owned data yet: only its users row,
 * auth identities, sessions, legacy links, and custody accounts that never
 * saw a ledger entry, deposit or withdrawal. Anything else (a profile, a
 * feed row, an award, a league seat, a granted role...) makes it non-empty.
 * Attribution-only references (analytics events, market edit stamps) do not
 * count: they follow the account when it is folded.
 */
export const isAccountEmpty = async ({
	q,
	userId
}: {
	q: TxQuery;
	userId: string;
}): Promise<boolean> => {
	const rows = await q<{ has_data: boolean }>(
		`select
		   exists (select 1 from users where id = $1 and (role <> 'user' or hard_deleted_at is not null))
		   or exists (select 1 from profiles where user_id = $1)
		   or exists (select 1 from user_stats where user_id = $1)
		   or exists (select 1 from user_monthly_stats where user_id = $1)
		   or exists (select 1 from resolved_results where user_id = $1)
		   or exists (select 1 from relations where participant_one = $1 or participant_two = $1)
		   or exists (select 1 from activities where user_id = $1 or target_user = $1)
		   or exists (select 1 from activity_reactions where liker = $1)
		   or exists (select 1 from vxp_awards where user_id = $1)
		   or exists (select 1 from referrals where referee_user_id = $1 or referrer_user_id = $1)
		   or exists (select 1 from referral_codes where owner_user_id = $1)
		   or exists (select 1 from leagues where owner_user_id = $1)
		   or exists (select 1 from league_members where member_user_id = $1)
		   or exists (
		     select 1 from battles
		     where proposer_user_id = $1
		        or (kind = 'duel' and (side_a = $1::text or side_b = $1::text))
		   )
		   or exists (select 1 from affiliations where member_user_id = $1)
		   or exists (select 1 from school_submissions where user_id = $1)
		   or exists (select 1 from withdrawals where user_id = $1)
		   or exists (
		     select 1 from custody_accounts c
		     where c.user_id = $1
		       and (exists (select 1 from ledger_entries l where l.account_id = c.id)
		            or exists (select 1 from deposits d where d.account_id = c.id))
		   ) as has_data`,
		[userId]
	);

	return rows[0]?.has_data === false;
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

/** Lock and adopt one ranked candidate; false when a concurrent claim
 * adopted it since the ranking read (the row lock waits that claim out and
 * the claim_pending re-check then skips the account). */
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
 * The caller must serialize first logins for the email (resolveIdentity
 * holds a per-email advisory lock) and attach the auth identity to the
 * returned user in the same transaction.
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

/** Fold an empty account into a locked provisional one: every sign-in
 * identity, live session and legacy link moves over, attribution-only
 * references are re-pointed, the unused custody rows and the user row go. */
const foldEmptyAccount = async ({
	q,
	fromUserId,
	toUserId
}: {
	q: TxQuery;
	fromUserId: string;
	toUserId: string;
}): Promise<void> => {
	await q(
		`update users t
		 set display_name = coalesce(t.display_name, f.display_name),
		     avatar_url = coalesce(t.avatar_url, f.avatar_url)
		 from users f
		 where t.id = $2 and f.id = $1`,
		[fromUserId, toUserId]
	);

	// Moving the session rows (rather than minting new ones) keeps the
	// caller's cookie valid: it now resolves to the adopted account.
	await q(`update auth_identities set user_id = $2 where user_id = $1`, [fromUserId, toUserId]);
	await q(`update sessions set user_id = $2 where user_id = $1`, [fromUserId, toUserId]);
	await q(`update legacy_principals set user_id = $2 where user_id = $1`, [fromUserId, toUserId]);
	await q(`update analytics_events set user_id = $2 where user_id = $1`, [fromUserId, toUserId]);
	await q(`update market_metadata set updated_by = $2 where updated_by = $1`, [
		fromUserId,
		toUserId
	]);
	await q(`update market_translations set updated_by = $2 where updated_by = $1`, [
		fromUserId,
		toUserId
	]);

	// Emptiness guarantees these rows carry no ledger, deposit or withdrawal
	// history (the FKs restrict otherwise). Funds sent on-chain to such an
	// address without ever being observed stay recoverable: the key derives
	// from the root secret and the old user id, not from this row.
	await q(`delete from custody_accounts where user_id = $1`, [fromUserId]);
	await q(`delete from users where id = $1`, [fromUserId]);
};

export type ClaimLinkOutcome =
	| { kind: 'linked' | 'already_linked' | 'adopted'; userId: string }
	| { kind: 'conflict' | 'account_not_empty' };

/**
 * Link a principal proven by the claim handoff to the caller's account.
 * An unlinked principal links directly; one still held by an importer
 * provisional account is adopted when the caller's account is empty (the
 * caller becomes that account, `userId` in the outcome) and refused with
 * `account_not_empty` otherwise; one owned by any other real account is a
 * conflict.
 */
export const claimPrincipal = ({
	principal,
	callerUserId
}: {
	principal: string;
	callerUserId: string;
}): Promise<ClaimLinkOutcome> =>
	tx(async (q) => {
		const inserted = await q<{ principal: string }>(
			`insert into legacy_principals (principal, user_id, matched_via)
			 values ($1, $2, 'claim')
			 on conflict (principal) do nothing
			 returning principal`,
			[principal, callerUserId]
		);

		if (nonNullish(inserted[0])) {
			return { kind: 'linked', userId: callerUserId };
		}

		const owners = await q<{ user_id: string; provisional: boolean }>(
			`select lp.user_id, (lp.matched_via = 'etl' and u.claim_pending) as provisional
			 from legacy_principals lp
			 join users u on u.id = lp.user_id
			 where lp.principal = $1`,
			[principal]
		);
		const [owner] = owners;

		if (owner?.user_id === callerUserId) {
			return { kind: 'already_linked', userId: callerUserId };
		}

		// Unlocked pre-check so a principal owned by a real account never
		// takes a row lock on that account; the locked re-check below decides.
		if (isNullish(owner) || !owner.provisional) {
			return { kind: 'conflict' };
		}

		const ownerId = owner.user_id;

		// Both users rows, ascending id: the documented lock order. Locking the
		// caller also blocks its concurrent writes (child-row FK checks need a
		// key-share lock), so the emptiness verdict below cannot go stale.
		await q(`select id from users where id = any($1::uuid[]) order by id for update`, [
			[ownerId, callerUserId]
		]);

		if (!(await lockProvisionalLink({ q, principal, userId: ownerId }))) {
			// Not (or no longer) an importer link: either a real account owns it
			// or a concurrent adoption just handed it to one.
			const now = await q<{ user_id: string }>(
				`select user_id from legacy_principals where principal = $1`,
				[principal]
			);

			return now[0]?.user_id === callerUserId
				? { kind: 'already_linked', userId: callerUserId }
				: { kind: 'conflict' };
		}

		if (!(await isAccountEmpty({ q, userId: callerUserId }))) {
			await recordConflict({
				q,
				principal,
				provisionalUserId: ownerId,
				matchedUserId: callerUserId,
				reason: 'account_not_empty'
			});

			return { kind: 'account_not_empty' };
		}

		await foldEmptyAccount({ q, fromUserId: callerUserId, toUserId: ownerId });
		await finalizeAdoption({
			q,
			provisionalUserId: ownerId,
			principal,
			matchedVia: 'claim',
			displayName: null
		});

		return { kind: 'adopted', userId: ownerId };
	});

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
