// Fixtures for the provisional-account adoption suites: run the real ETL
// importers so the provisional account, its 'etl' link and its imported rows
// look exactly like production data after a bulk import.

import { isNullish, nonNullish } from '@dfinity/utils';
import { importDocs } from '../../scripts/etl/transforms';
import { query } from '../../src/db/client';
import { uniqueNickname } from './profiles';

const BASE_TS_MS = 1_750_000_000_000;

export interface ImportedAccount {
	principal: string;
	userId: string;
	nickname: string;
}

/** Import a profile plus `activities` trade rows for `principal`, and
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

	await importDocs({
		collection: 'profiles',
		docs: [
			{
				key: principal,
				data: { owner: principal, nickname, visibility: 'public', points: 250 },
				createdAtNs: '1700000000000000000',
				updatedAtNs: '1710000000000000000'
			}
		]
	});

	if (activities > 0) {
		await importDocs({
			collection: 'activities',
			docs: Array.from({ length: activities }, (_, i) => ({
				key: `${principal}#${BASE_TS_MS + i}#trade`,
				data: { type: 'trade', user: principal, title: 'Called YES', timestamp: BASE_TS_MS + i },
				createdAtNs: '1700000000000000000',
				updatedAtNs: '1710000000000000000'
			}))
		});
	}

	if (nonNullish(openidEmail) || nonNullish(profileEmail)) {
		await query(
			`insert into legacy_auth_identities (principal, provider, openid_email, profile_email)
			 values ($1, 'google', $2, $3)`,
			[principal, openidEmail, profileEmail]
		);
	}

	const rows = await query<{ user_id: string }>(
		`select user_id from legacy_principals where principal = $1`,
		[principal]
	);
	const userId = rows[0]?.user_id;

	if (isNullish(userId)) {
		throw new Error('import created no link');
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
