// Gives provisional accounts whose legacy login carried no email (passkey,
// Internet Identity) the address the team collected for them, so the first
// verified sign-in with it adopts the account like any other legacy login.
// It writes the one column adoption and the beta gate already match on,
// `legacy_auth_identities.profile_email`, for one of the account's importer
// ('etl') principals, inserting that principal's row when the export has
// none; no new adoption path.
//
// Refused, per row: a malformed user id or email; an account that is not an
// unadopted provisional one; a user id or an email used on two rows (one
// person must not be split across two accounts, nor two accounts share one
// address, since a login adopts only one of them); an email that already
// signs in to a web2 account (that login never reaches adoption); an email
// the export already holds for another principal (two accounts would compete
// for one login). An email the account already carries is a no-op, so a
// re-run converges.
//
// etl:drain-auth rewrites profile_email from the satellite, wiping what this
// wrote: run this after the final drain, and again after any later drain.
//
// Usage: bun run cutover:assign-emails <filled.csv> [--execute]
//   (dry run without --execute: prints the plan, writes nothing)
// Env: DATABASE_URL.

import { isNullish, nonNullish } from '@dfinity/utils';
import { readFileSync } from 'node:fs';
import { lockLoginEmails } from '../../src/auth/adoption';
import { normalizeEmail } from '../../src/auth/identity';
import { pool, query, tx, type TxQuery } from '../../src/db/client';
import { UUID_RE } from '../../src/lib/constants';
import { printTable } from '../etl/lib';
import {
	DRAIN_WIPES_ASSIGNED_EMAILS_WARNING,
	hasFlag,
	parseCsvRecords,
	positionalArgs,
	type CsvRecord,
	type UnmatchedCsvColumn
} from './lib';

const USER_ID_COLUMN: UnmatchedCsvColumn = 'user_id';
const EMAIL_COLUMN: UnmatchedCsvColumn = 'email';

export type AssignmentOutcome =
	| 'assign'
	| 'already_assigned'
	| 'invalid_user_id'
	| 'invalid_email'
	| 'user_repeated'
	| 'email_repeated'
	| 'unknown_user'
	| 'not_provisional'
	| 'email_has_web2_account'
	| 'email_on_other_legacy_account';

/** The outcomes that change nothing and need nothing from the operator. */
const ACCEPTED: ReadonlySet<AssignmentOutcome> = new Set(['assign', 'already_assigned']);

export interface AssignmentRequest {
	line: number;
	userId: string;
	email: string;
}

export interface AssignmentPlanRow extends AssignmentRequest {
	outcome: AssignmentOutcome;
	/** The principal whose exported identity receives the email. */
	principal?: string;
	/** The self-reported address the write replaces, when there is one. */
	replacesProfileEmail?: string;
	detail?: string;
}

/** The rows of a filled sheet that carry an email; rows left blank are not
 * requests. */
export const assignmentRequests = (records: readonly CsvRecord[]): AssignmentRequest[] =>
	records
		.map(({ line, cells }) => ({
			line,
			userId: (cells[USER_ID_COLUMN] ?? '').trim(),
			email: normalizeEmail(cells[EMAIL_COLUMN] ?? '')
		}))
		.filter(({ email }) => email !== '');

// The sign-in form's own bar (an @, nothing blank), plus no inner whitespace:
// a pasted address with a space in it can never be typed back at login.
const isPlausibleEmail = (email: string): boolean => email.includes('@') && !/\s/.test(email);

const countBy = (values: readonly string[]): Map<string, number> => {
	const counts = new Map<string, number>();

	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return counts;
};

interface ProvisionalPrincipal {
	user_id: string;
	principal: string;
	has_identity: boolean;
	profile_email: string | null;
}

/** What the database says about the requested accounts and addresses. */
interface AssignmentFacts {
	users: Map<string, { provisional: boolean }>;
	/** Each account's importer principals, the one to write first. */
	principals: Map<string, ProvisionalPrincipal[]>;
	web2Emails: Set<string>;
	/** Each address the export holds, with the principals and accounts
	 * (null when unlinked) carrying it. */
	legacyEmails: Map<string, Array<{ principal: string; userId: string | null }>>;
}

const readFacts = async ({
	q,
	userIds,
	emails
}: {
	q: TxQuery;
	userIds: string[];
	emails: string[];
}): Promise<AssignmentFacts> => {
	const users = await q<{ id: string; provisional: boolean }>(
		`select u.id,
		        (u.claim_pending and u.hard_deleted_at is null
		         and exists (select 1 from legacy_principals lp
		                     where lp.user_id = u.id and lp.matched_via = 'etl')) as provisional
		 from users u
		 where u.id = any($1::uuid[])`,
		[userIds]
	);

	// A principal whose exported row already exists goes first, so the write
	// updates that row instead of adding a second identity for the account.
	const principals = await q<ProvisionalPrincipal>(
		`select lp.user_id, lp.principal, lai.principal is not null as has_identity, lai.profile_email
		 from legacy_principals lp
		 left join legacy_auth_identities lai on lai.principal = lp.principal
		 where lp.user_id = any($1::uuid[]) and lp.matched_via = 'etl'
		 order by lp.user_id, has_identity desc, lp.principal`,
		[userIds]
	);

	// Same match as resolveIdentity's lookup by email: a live account holding
	// the address under any provider takes the login before adoption runs.
	const web2 = await q<{ email: string }>(
		`select distinct lower(ai.email) as email
		 from auth_identities ai
		 join users u on u.id = ai.user_id and u.hard_deleted_at is null
		 where lower(ai.email) = any($1::text[])`,
		[emails]
	);

	const legacy = await q<{ email: string; principal: string; user_id: string | null }>(
		`select distinct lower(e.email) as email, lai.principal, lp.user_id
		 from legacy_auth_identities lai
		 cross join lateral (values (lai.openid_email), (lai.profile_email)) as e (email)
		 left join legacy_principals lp on lp.principal = lai.principal
		 where lower(e.email) = any($1::text[])`,
		[emails]
	);

	const principalsByUser = new Map<string, ProvisionalPrincipal[]>();

	for (const row of principals) {
		principalsByUser.set(row.user_id, [...(principalsByUser.get(row.user_id) ?? []), row]);
	}

	const legacyEmails = new Map<string, Array<{ principal: string; userId: string | null }>>();

	for (const row of legacy) {
		legacyEmails.set(row.email, [
			...(legacyEmails.get(row.email) ?? []),
			{ principal: row.principal, userId: row.user_id }
		]);
	}

	return {
		users: new Map(users.map(({ id, provisional }) => [id, { provisional }])),
		principals: principalsByUser,
		web2Emails: new Set(web2.map(({ email }) => email)),
		legacyEmails
	};
};

interface JudgeInput {
	request: AssignmentRequest;
	facts: AssignmentFacts;
	userCounts: Map<string, number>;
	emailCounts: Map<string, number>;
}

/** The refusals a row earns from the sheet alone, before the database. */
const sheetRefusal = ({
	request,
	userCounts,
	emailCounts
}: JudgeInput): AssignmentOutcome | undefined => {
	if (!UUID_RE.test(request.userId)) {
		return 'invalid_user_id';
	}

	if (!isPlausibleEmail(request.email)) {
		return 'invalid_email';
	}

	if ((userCounts.get(request.userId) ?? 0) > 1) {
		return 'user_repeated';
	}

	if ((emailCounts.get(request.email) ?? 0) > 1) {
		return 'email_repeated';
	}
};

const judge = (input: JudgeInput): AssignmentPlanRow => {
	const { request, facts } = input;
	const { userId, email } = request;
	const refuse = (outcome: AssignmentOutcome, detail?: string): AssignmentPlanRow => ({
		...request,
		outcome,
		...(nonNullish(detail) && { detail })
	});
	const fromSheet = sheetRefusal(input);

	if (nonNullish(fromSheet)) {
		return refuse(fromSheet);
	}

	const user = facts.users.get(userId);
	const [principal] = facts.principals.get(userId) ?? [];

	if (isNullish(user)) {
		return refuse('unknown_user');
	}

	if (!user.provisional || isNullish(principal)) {
		return refuse('not_provisional');
	}

	if (facts.web2Emails.has(email)) {
		return refuse('email_has_web2_account');
	}

	const carriers = facts.legacyEmails.get(email) ?? [];
	const elsewhere = carriers.filter((carrier) => carrier.userId !== userId);

	if (elsewhere.length > 0) {
		return refuse(
			'email_on_other_legacy_account',
			elsewhere.map((carrier) => `${carrier.principal} (${carrier.userId ?? 'unlinked'})`).join(' ')
		);
	}

	if (carriers.length > 0) {
		return { ...request, outcome: 'already_assigned', principal: carriers[0]?.principal };
	}

	const previous = principal.profile_email ?? '';

	return {
		...request,
		outcome: 'assign',
		principal: principal.principal,
		...(previous !== '' && { replacesProfileEmail: previous })
	};
};

/** The well-formed user ids of the requests, once each: a malformed one
 * never reaches a uuid bind. */
const requestedUserIds = (requests: readonly AssignmentRequest[]): string[] =>
	[...new Set(requests.map(({ userId }) => userId))].filter((id) => UUID_RE.test(id));

/** The verdict for every request, from the database as `q` sees it. */
export const planAssignments = async ({
	requests,
	q = query
}: {
	requests: readonly AssignmentRequest[];
	q?: TxQuery;
}): Promise<AssignmentPlanRow[]> => {
	const userIds = requestedUserIds(requests);
	const emails = [...new Set(requests.map(({ email }) => email))];
	const facts = await readFacts({ q, userIds, emails });
	const userCounts = countBy(requests.map(({ userId }) => userId));
	const emailCounts = countBy(requests.map(({ email }) => email));

	return requests.map((request) => judge({ request, facts, userCounts, emailCounts }));
};

/** Every address an importer principal of these accounts already signs in
 * with on the legacy side: a write replacing one of them must hold its login
 * lock too, or a first login with it could adopt the account mid-write. */
const currentLegacyEmails = async ({
	q,
	userIds
}: {
	q: TxQuery;
	userIds: string[];
}): Promise<string[]> => {
	const rows = await q<{ email: string }>(
		`select distinct lower(e.email) as email
		 from legacy_principals lp
		 join legacy_auth_identities lai on lai.principal = lp.principal
		 cross join lateral (values (lai.openid_email), (lai.profile_email)) as e (email)
		 where lp.user_id = any($1::uuid[]) and lp.matched_via = 'etl' and coalesce(e.email, '') <> ''`,
		[userIds]
	);

	return rows.map(({ email }) => email);
};

/** Plans and writes the accepted rows in one transaction, under the login
 * locks (the lock order of adoption.ts: every address sorted, before any row)
 * of the requested addresses and of the legacy addresses the accounts already
 * carry, so a first login with any of them runs strictly before the plan
 * (which then finds the account adopted: `not_provisional`) or after the
 * write, never between the check and the write. Only etl:drain-auth writes
 * those columns, and it does not run during this step. */
export const executeAssignments = (
	requests: readonly AssignmentRequest[]
): Promise<AssignmentPlanRow[]> =>
	tx(async (q) => {
		const userIds = requestedUserIds(requests);

		await lockLoginEmails({
			q,
			emails: [
				...requests.map(({ email }) => email),
				...(await currentLegacyEmails({ q, userIds }))
			]
		});

		const plan = await planAssignments({ requests, q });

		for (const row of plan) {
			if (row.outcome === 'assign' && nonNullish(row.principal)) {
				await q(
					`insert into legacy_auth_identities (principal, profile_email)
					 values ($1, $2)
					 on conflict (principal) do update set profile_email = excluded.profile_email`,
					[row.principal, row.email]
				);
			}
		}

		return plan;
	});

export const isAccepted = (row: AssignmentPlanRow): boolean => ACCEPTED.has(row.outcome);

const printPlan = (plan: readonly AssignmentPlanRow[]): void => {
	printTable([
		['line', 'user_id', 'email', 'outcome', 'principal / detail'],
		...plan.map((row) => [
			row.line.toString(),
			row.userId,
			row.email,
			row.outcome,
			[
				row.principal ?? '',
				nonNullish(row.replacesProfileEmail) ? `(replaces ${row.replacesProfileEmail})` : '',
				row.detail ?? ''
			]
				.filter((part) => part !== '')
				.join(' ')
		])
	]);

	const counts = countBy(plan.map(({ outcome }) => outcome));

	console.log('');
	printTable([['outcome', 'rows'], ...[...counts].map(([outcome, n]) => [outcome, n.toString()])]);
};

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const [csvPath] = positionalArgs({ argv, valued: [] });
	const execute = hasFlag({ argv, flag: '--execute' });

	if (isNullish(csvPath)) {
		console.error('usage: bun run cutover:assign-emails <filled.csv> [--execute]');
		process.exit(2);
	}

	console.log(DRAIN_WIPES_ASSIGNED_EMAILS_WARNING);
	console.log('');

	const requests = assignmentRequests(
		parseCsvRecords({
			text: readFileSync(csvPath, 'utf8'),
			required: [USER_ID_COLUMN, EMAIL_COLUMN]
		})
	);
	const plan = execute ? await executeAssignments(requests) : await planAssignments({ requests });

	printPlan(plan);
	console.log('');
	console.log(
		execute
			? `Wrote ${plan.filter(({ outcome }) => outcome === 'assign').length} email(s).`
			: 'Dry run: nothing written. Re-run with --execute to write the `assign` rows.'
	);
	console.log(DRAIN_WIPES_ASSIGNED_EMAILS_WARNING);

	await pool.end();

	// Refused rows need the operator: fix the sheet and run again.
	process.exit(plan.every(isAccepted) ? 0 : 1);
}
