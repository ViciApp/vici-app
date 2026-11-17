// Anonymous markers of the one-time awards a hard-deleted account was paid.
// The purge removes the account's award rows, and a later sign-in with the
// same identity provisions a new account, so the marker is what keeps that
// identity from collecting a one-time award twice. A marker is a one-way
// digest of a sign-in identity plus the award type and key: no user id, no
// address. Every grant reads it through grantAward / grantCappedAward.

import { nonNullish } from '@dfinity/utils';
import { normalizeEmail } from '../auth/identity';
import { query, type TxQuery } from '../db/client';
import { identityDigest } from '../lib/keys';
import type { VxpAwardType } from './awards';

/** The award types a user may collect again under the same key: the overtime
 * bonus is once per day key, bounded by its rolling cap. Every other type is
 * one-time per key and leaves a marker. */
export const REPEATABLE_VXP_AWARD_TYPES: readonly VxpAwardType[] = ['flow_overtime'];

const isOneTimeAwardType = (awardType: VxpAwardType): boolean =>
	!REPEATABLE_VXP_AWARD_TYPES.includes(awardType);

/** Award rows that may have moved VXP: paid, or a transfer whose outcome is
 * still being settled. A pending row never sent anything and a failed one was
 * rejected, so neither leaves a marker. */
const PAID_AWARD_STATUSES = ['paid', 'processing', 'needs_ledger_check'];

/** The marker key for an award keyed by the account itself (the referee
 * bonus): the new account's id differs, so the key is written as this. */
const SELF_AWARD_KEY = 'self';

const markerAwardKey = ({ userId, awardKey }: { userId: string; awardKey: string }): string =>
	awardKey === userId ? SELF_AWARD_KEY : awardKey;

/**
 * The digests a user's sign-in identities answer to: each provider subject,
 * and each verified address, since a verified address signs into whichever
 * account holds it, under any provider.
 */
const identityDigestsOf = async (userId: string, q: TxQuery = query): Promise<string[]> => {
	const rows = await q<{ provider: string; subject: string; email: string | null }>(
		`select provider, subject, email from auth_identities where user_id = $1`,
		[userId]
	);
	const digests = new Set<string>();

	for (const { provider, subject, email } of rows) {
		digests.add(identityDigest(`subject:${provider}:${subject}`));

		if (nonNullish(email)) {
			digests.add(identityDigest(`email:${normalizeEmail(email)}`));
		}
	}

	return [...digests];
};

/**
 * Writes the account's markers: every one-time award it was paid, under every
 * identity it can sign in with. Runs inside the hard-delete transaction before
 * the identities and the award rows go. Idempotent through the primary key.
 */
export const recordAwardMarkers = async ({
	userId,
	q
}: {
	userId: string;
	q: TxQuery;
}): Promise<void> => {
	const digests = await identityDigestsOf(userId, q);

	if (digests.length === 0) {
		return;
	}

	await q(
		`insert into vxp_award_markers (identity_digest, award_type, award_key)
		 select d.digest, a.award_type,
		        case when a.award_key = a.user_id::text then $5 else a.award_key end
		 from vxp_awards a cross join unnest($2::text[]) as d(digest)
		 where a.user_id = $1
		   and a.status = any($3::text[])
		   and a.award_type <> all($4::text[])
		 on conflict do nothing`,
		[userId, digests, PAID_AWARD_STATUSES, REPEATABLE_VXP_AWARD_TYPES, SELF_AWARD_KEY]
	);
};

/** Whether one of the user's identities was already paid this one-time award
 * under an earlier, deleted account. Always false for a repeatable type. */
export const hasAwardMarker = async (
	{
		userId,
		awardType,
		awardKey
	}: {
		userId: string;
		awardType: VxpAwardType;
		awardKey: string;
	},
	q: TxQuery = query
): Promise<boolean> => {
	if (!isOneTimeAwardType(awardType)) {
		return false;
	}

	const digests = await identityDigestsOf(userId, q);

	if (digests.length === 0) {
		return false;
	}

	const rows = await q<{ found: boolean }>(
		`select exists (
		   select 1 from vxp_award_markers
		   where identity_digest = any($1::text[]) and award_type = $2 and award_key = $3
		 ) as found`,
		[digests, awardType, markerAwardKey({ userId, awardKey })]
	);

	return rows[0]?.found === true;
};

/**
 * How many awards of one type the user's identities were paid under earlier,
 * deleted accounts, never counting the self-keyed one: the share of a
 * lifetime cap or tier those accounts already used up.
 */
export const countAwardMarkers = async (
	{ userId, awardType }: { userId: string; awardType: VxpAwardType },
	q: TxQuery = query
): Promise<number> => {
	const digests = await identityDigestsOf(userId, q);

	if (digests.length === 0) {
		return 0;
	}

	const rows = await q<{ count: string }>(
		`select count(distinct award_key)::text as count from vxp_award_markers
		 where identity_digest = any($1::text[]) and award_type = $2 and award_key <> $3`,
		[digests, awardType, SELF_AWARD_KEY]
	);

	return Number(rows[0]?.count ?? 0);
};
