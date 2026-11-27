// Fixtures for the provisional-account adoption suites: a provisional
// claim_pending account linked to its legacy principal with matched_via =
// 'etl', holding a profile and some activity rows, the shape the adoption
// code reads.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query } from '../../src/db/client';
import { nicknameUniqueKey } from '../../src/profiles/nickname';
import { activityKey } from '../../src/social/activities';
import { uniqueNickname } from './profiles';

const BASE_TS_MS = 1_750_000_000_000;

export interface ImportedAccount {
	principal: string;
	userId: string;
	nickname: string;
}

/** The provisional account of `principal` with its profile, created on the
 * first call and returned as is on a later one. */
export const seedProvisionalAccount = async ({
	principal,
	nickname,
	points = 250,
	level = 1
}: {
	principal: string;
	nickname: string;
	points?: number;
	level?: number;
}): Promise<string> => {
	const existing = await query<{ user_id: string }>(
		`select user_id from legacy_principals where principal = $1`,
		[principal]
	);
	const existingUserId = existing[0]?.user_id;

	if (nonNullish(existingUserId)) {
		return existingUserId;
	}

	const created = await query<{ id: string }>(
		`insert into users (claim_pending) values (true) returning id`
	);
	const userId = created[0]?.id;

	if (isNullish(userId)) {
		throw new Error('provisional user insert returned no row');
	}

	await query(
		`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'etl')`,
		[principal, userId]
	);
	await query(
		`insert into profiles (user_id, nickname, nickname_key, visibility, points, level)
		 values ($1, $2, $3, 'public', $4, $5)`,
		[userId, nickname, nicknameUniqueKey(nickname), points, level]
	);

	return userId;
};

/** A provisional account for `principal` with `activities` trade rows, and
 * optionally the exported legacy identity carrying its email(s). */
export const seedImportedAccount = async ({
	principal,
	openidEmail = null,
	profileEmail = null,
	activities = 1
}: {
	principal: string;
	openidEmail?: string | null;
	profileEmail?: string | null;
	activities?: number;
}): Promise<ImportedAccount> => {
	const nickname = uniqueNickname();
	const userId = await seedProvisionalAccount({ principal, nickname });

	for (let i = 0; i < activities; i++) {
		const timestamp = BASE_TS_MS + i;

		await query(
			`insert into activities (key, user_id, type, title, timestamp_ms)
			 values ($1, $2, 'trade', 'Called YES', $3)`,
			[activityKey({ userId, timestamp, type: 'trade' }), userId, timestamp]
		);
	}

	if (nonNullish(openidEmail) || nonNullish(profileEmail)) {
		await query(
			`insert into legacy_auth_identities (principal, provider, openid_email, profile_email)
			 values ($1, 'google', $2, $3)`,
			[principal, openidEmail, profileEmail]
		);
	}

	return { principal, userId, nickname };
};

export const linkOf = async (
	principal: string
): Promise<{ user_id: string; matched_via: string } | undefined> => {
	const rows = await query<{ user_id: string; matched_via: string }>(
		`select user_id, matched_via from legacy_principals where principal = $1`,
		[principal]
	);

	return rows[0];
};

export const claimPendingOf = async (userId: string): Promise<boolean | undefined> => {
	const rows = await query<{ claim_pending: boolean }>(
		`select claim_pending from users where id = $1`,
		[userId]
	);

	return rows[0]?.claim_pending;
};

export const userCount = async (): Promise<number> => {
	const rows = await query<{ count: string }>(`select count(*) from users`);

	return Number(rows[0]?.count ?? 0);
};
