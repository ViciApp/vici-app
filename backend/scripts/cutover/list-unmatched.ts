// Lists every provisional account the data migration created that nobody has
// adopted yet, as the sheet the team fills in: one row per account, with its
// legacy principals, the legacy login provider when the export knows it, the
// school, the emails the export already holds for it (those adopt on first
// login without help) and an empty `email` column for the rest. The filled
// sheet is the input of assign-emails.
//
// Usage: bun run cutover:list-unmatched [out.csv]   (stdout without a path)
// Env: DATABASE_URL.

import { isNullish } from '@dfinity/utils';
import { writeFileSync } from 'node:fs';
import { pool, query, type TxQuery } from '../../src/db/client';
import type { AffiliationKind } from '../../src/worlds/affiliations';
import { printTable } from '../etl/lib';
import { formatCsv, positionalArgs, UNMATCHED_CSV_COLUMNS, type UnmatchedCsvColumn } from './lib';

export type UnmatchedAccount = Record<UnmatchedCsvColumn, string>;

/** The school a sheet row shows: the account's Worlds university slot. */
const SCHOOL_AFFILIATION: AffiliationKind = 'university';

/** Every claim_pending, not hard-deleted account still holding an importer
 * ('etl') link: exactly the accounts a first login or a claim can adopt. */
export const listUnmatchedAccounts = async (q: TxQuery = query): Promise<UnmatchedAccount[]> => {
	const rows = await q<{
		user_id: string;
		handle: string;
		display_name: string;
		principals: string;
		providers: string;
		school: string;
		known_emails: string;
	}>(
		`select u.id as user_id,
		        coalesce(p.nickname, '') as handle,
		        coalesce(u.display_name, '') as display_name,
		        (select string_agg(lp.principal, ' ' order by lp.principal)
		         from legacy_principals lp
		         where lp.user_id = u.id and lp.matched_via = 'etl') as principals,
		        coalesce((select string_agg(distinct lai.provider, ' ' order by lai.provider)
		                  from legacy_principals lp
		                  join legacy_auth_identities lai on lai.principal = lp.principal
		                  where lp.user_id = u.id and lai.provider is not null), '') as providers,
		        coalesce((select a.affiliation_identifier
		                  from affiliations a
		                  where a.member_user_id = u.id and a.kind = $1), '') as school,
		        coalesce((select string_agg(distinct lower(e.email), ' ' order by lower(e.email))
		                  from legacy_principals lp
		                  join legacy_auth_identities lai on lai.principal = lp.principal
		                  cross join lateral (values (lai.openid_email), (lai.profile_email)) as e (email)
		                  where lp.user_id = u.id and coalesce(e.email, '') <> ''), '') as known_emails
		 from users u
		 left join profiles p on p.user_id = u.id
		 where u.claim_pending
		   and u.hard_deleted_at is null
		   and exists (select 1 from legacy_principals lp where lp.user_id = u.id and lp.matched_via = 'etl')
		 order by lower(coalesce(p.nickname, '')), u.id`,
		[SCHOOL_AFFILIATION]
	);

	return rows.map((row) => ({
		user_id: row.user_id,
		handle: row.handle,
		display_name: row.display_name,
		legacy_principals: row.principals,
		legacy_provider: row.providers,
		school: row.school,
		known_email: row.known_emails,
		email: ''
	}));
};

export const unmatchedAccountsCsv = (accounts: readonly UnmatchedAccount[]): string =>
	formatCsv({
		header: UNMATCHED_CSV_COLUMNS,
		rows: accounts.map((account) => UNMATCHED_CSV_COLUMNS.map((column) => account[column]))
	});

if (import.meta.main) {
	const [outPath] = positionalArgs({ argv: process.argv.slice(2), valued: [] });
	const accounts = await listUnmatchedAccounts();
	const csv = unmatchedAccountsCsv(accounts);
	const withoutEmail = accounts.filter(({ known_email }) => known_email === '').length;

	if (isNullish(outPath)) {
		process.stdout.write(csv);
	} else {
		writeFileSync(outPath, csv);
		printTable([
			['unadopted accounts', 'no known email', 'written to'],
			[accounts.length.toString(), withoutEmail.toString(), outPath]
		]);
		console.log(
			'Fill the `email` column of the rows without a known email, then run cutover:assign-emails.'
		);
	}

	await pool.end();
}
