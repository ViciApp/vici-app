// The cutover email steps: the sheet's CSV round trip, the unmatched-accounts
// listing, and assign-emails end to end (every refusal, the write, a re-run
// changing nothing, and the first login with an assigned address adopting
// the provisional account through the real identity resolution).

import { beforeAll, describe, expect, test } from 'bun:test';
import {
	assignmentRequests,
	executeAssignments,
	planAssignments,
	type AssignmentRequest
} from '../scripts/cutover/assign-emails';
import {
	formatCsv,
	parseCsvRecords,
	parseCsvRows,
	UNMATCHED_CSV_COLUMNS
} from '../scripts/cutover/lib';
import { listUnmatchedAccounts, unmatchedAccountsCsv } from '../scripts/cutover/list-unmatched';
import { lockLoginEmails } from '../src/auth/adoption';
import { resolveIdentity } from '../src/auth/identity';
import { query } from '../src/db/client';
import { claimPendingOf, linkOf, seedImportedAccount } from './helpers/adoption';
import { ensureMigrated, uniqueEmail, uniquePrincipal } from './helpers/auth';
import { openTransaction, waitForLockWait } from './helpers/locks';
import { dbAvailable } from './helpers/setup';

describe('cutover sheet csv', () => {
	test('round-trips commas, quotes, line breaks and blanks', () => {
		const rows = [
			['a,b', 'say "hi"', 'two\nlines', ''],
			['plain', ' padded ', 'x', 'y']
		];
		const text = formatCsv({ header: ['w', 'x', 'y', 'z'], rows });

		expect(parseCsvRows(text)).toEqual([['w', 'x', 'y', 'z'], ...rows]);
	});

	test('neutralizes cells a spreadsheet would run as formulas', () => {
		const text = formatCsv({ header: ['handle'], rows: [['=HYPERLINK("x")'], ['@me']] });

		expect(parseCsvRows(text).slice(1)).toEqual([[`'=HYPERLINK("x")`], ["'@me"]]);
	});

	test('reads a spreadsheet export: byte-order mark, LF endings, trailing blank line', () => {
		const records = parseCsvRecords({
			text: '\uFEFFuser_id,email\nu1, A@Example.com \n\n',
			required: ['user_id', 'email']
		});

		expect(records).toEqual([{ line: 2, cells: { user_id: 'u1', email: ' A@Example.com ' } }]);
		expect(assignmentRequests(records)).toEqual([
			{ line: 2, userId: 'u1', email: 'a@example.com' }
		]);
	});

	test('refuses a sheet without the columns it needs', () => {
		expect(() =>
			parseCsvRecords({ text: 'user_id\nu1\n', required: ['user_id', 'email'] })
		).toThrow('missing column(s) email');
	});

	test('rows left blank are not requests', () => {
		const records = parseCsvRecords({
			text: 'user_id,email\nu1,\nu2,b@example.com\n',
			required: ['user_id', 'email']
		});

		expect(assignmentRequests(records).map(({ userId }) => userId)).toEqual(['u2']);
	});
});

describe.if(dbAvailable)('cutover email assignment', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const request = (userId: string, email: string, line = 2): AssignmentRequest => ({
		line,
		userId,
		email
	});

	const profileEmailOf = async (principal: string): Promise<string | null | undefined> => {
		const rows = await query<{ profile_email: string | null }>(
			`select profile_email from legacy_auth_identities where principal = $1`,
			[principal]
		);

		return rows[0]?.profile_email;
	};

	test('lists an unadopted provisional account with its principal, school and known email', async () => {
		const withEmail = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: uniqueEmail()
		});
		const withoutEmail = await seedImportedAccount({ principal: uniquePrincipal() });
		const school = `school-${withoutEmail.userId.slice(0, 8)}`;

		await query(
			`insert into affiliations (member_user_id, kind, affiliation_identifier, joined_at_ms, locked_until_ms)
			 values ($1, 'university', $2, 0, 0)`,
			[withoutEmail.userId, school]
		);

		const listed = await listUnmatchedAccounts();
		const bare = listed.find(({ user_id }) => user_id === withoutEmail.userId);
		const known = listed.find(({ user_id }) => user_id === withEmail.userId);

		expect(bare).toEqual({
			user_id: withoutEmail.userId,
			handle: withoutEmail.nickname,
			display_name: '',
			legacy_principals: withoutEmail.principal,
			legacy_provider: '',
			school,
			known_email: '',
			email: ''
		});
		expect(known?.legacy_provider).toBe('google');
		expect(known?.known_email).not.toBe('');

		const sheet = parseCsvRecords({
			text: unmatchedAccountsCsv(listed),
			required: UNMATCHED_CSV_COLUMNS
		});

		expect(sheet.find(({ cells }) => cells.user_id === withoutEmail.userId)?.cells.school).toBe(
			school
		);
	});

	test('an adopted account is no longer listed', async () => {
		const email = uniqueEmail();
		const account = await seedImportedAccount({ principal: uniquePrincipal(), openidEmail: email });

		await resolveIdentity({ provider: 'email', subject: email, email });

		const listed = await listUnmatchedAccounts();

		expect(listed.some(({ user_id }) => user_id === account.userId)).toBe(false);
	});

	test('assigns, re-runs as a no-op, and the first login with the address adopts the account', async () => {
		const account = await seedImportedAccount({ principal: uniquePrincipal() });
		const email = uniqueEmail();

		expect(await planAssignments({ requests: [request(account.userId, email)] })).toEqual([
			{ ...request(account.userId, email), outcome: 'assign', principal: account.principal }
		]);
		// The dry run wrote nothing.
		expect(await profileEmailOf(account.principal)).toBeUndefined();

		const [first] = await executeAssignments([request(account.userId, email)]);

		expect(first?.outcome).toBe('assign');
		expect(await profileEmailOf(account.principal)).toBe(email);

		const [again] = await executeAssignments([request(account.userId, email)]);

		expect(again?.outcome).toBe('already_assigned');
		expect(await profileEmailOf(account.principal)).toBe(email);

		const userId = await resolveIdentity({ provider: 'email', subject: email, email });

		expect(userId).toBe(account.userId);
		expect(await claimPendingOf(account.userId)).toBe(false);
		expect((await linkOf(account.principal))?.matched_via).toBe('profile_email');
	});

	test('waits for a login holding a legacy address of the account, then finds it adopted', async () => {
		const legacyEmail = uniqueEmail();
		const account = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: legacyEmail
		});
		const login = await openTransaction();

		// A first login with the legacy address holds its lock while it adopts.
		await lockLoginEmails({ q: login.q, emails: [legacyEmail] });
		await login.q(`update users set claim_pending = false where id = $1`, [account.userId]);

		const assigning = executeAssignments([request(account.userId, uniqueEmail())]);

		await waitForLockWait();
		await login.commit();

		const [row] = await assigning;

		expect(row?.outcome).toBe('not_provisional');
		expect(await profileEmailOf(account.principal)).toBeNull();
	});

	test('reports the self-reported address an assignment replaces', async () => {
		const previous = uniqueEmail();
		const account = await seedImportedAccount({ principal: uniquePrincipal() });

		await query(`insert into legacy_auth_identities (principal, profile_email) values ($1, $2)`, [
			account.principal,
			previous
		]);

		// The previous address already adopts this account; a new one replaces it.
		const email = uniqueEmail();
		const [row] = await executeAssignments([request(account.userId, email)]);

		expect(row).toMatchObject({ outcome: 'assign', replacesProfileEmail: previous });
		expect(await profileEmailOf(account.principal)).toBe(email);
	});

	test('refuses an address or an account used on two rows, leaving both untouched', async () => {
		const one = await seedImportedAccount({ principal: uniquePrincipal() });
		const two = await seedImportedAccount({ principal: uniquePrincipal() });
		const shared = uniqueEmail();

		const plan = await executeAssignments([
			request(one.userId, shared, 2),
			request(two.userId, shared, 3),
			request(two.userId, uniqueEmail(), 4)
		]);

		expect(plan.map(({ outcome }) => outcome)).toEqual([
			'email_repeated',
			'user_repeated',
			'user_repeated'
		]);
		expect(await profileEmailOf(one.principal)).toBeUndefined();
		expect(await profileEmailOf(two.principal)).toBeUndefined();
	});

	test('refuses an address that already signs in to a web2 account', async () => {
		const email = uniqueEmail();

		await resolveIdentity({ provider: 'email', subject: email, email });

		const account = await seedImportedAccount({ principal: uniquePrincipal() });
		const [row] = await executeAssignments([request(account.userId, email)]);

		expect(row?.outcome).toBe('email_has_web2_account');
		expect(await profileEmailOf(account.principal)).toBeUndefined();
	});

	test('refuses an address the export holds for another legacy account', async () => {
		const email = uniqueEmail();
		const other = await seedImportedAccount({ principal: uniquePrincipal(), profileEmail: email });
		const account = await seedImportedAccount({ principal: uniquePrincipal() });
		const [row] = await executeAssignments([request(account.userId, email)]);

		expect(row?.outcome).toBe('email_on_other_legacy_account');
		expect(row?.detail).toContain(other.principal);
		expect(await profileEmailOf(account.principal)).toBeUndefined();
	});

	test('refuses malformed rows and accounts that are not unadopted provisional ones', async () => {
		const adoptedEmail = uniqueEmail();
		const adopted = await seedImportedAccount({
			principal: uniquePrincipal(),
			openidEmail: adoptedEmail
		});

		await resolveIdentity({ provider: 'email', subject: adoptedEmail, email: adoptedEmail });

		const plan = await planAssignments({
			requests: [
				request('not-a-uuid', uniqueEmail(), 2),
				request(crypto.randomUUID(), 'no-at-sign', 3),
				request(crypto.randomUUID(), uniqueEmail(), 4),
				request(adopted.userId, uniqueEmail(), 5)
			]
		});

		expect(plan.map(({ outcome }) => outcome)).toEqual([
			'invalid_user_id',
			'invalid_email',
			'unknown_user',
			'not_provisional'
		]);
	});
});
