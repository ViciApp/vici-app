// The ETL cursor stores and the auth-identity drain: DB cursor roundtrip,
// page-by-page persistence, crash resume from the stored key, upsert
// convergence and completion clearing the cursor. The satellite client is
// faked at the actor boundary; no network.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import {
	DRAIN_CURSOR_ID,
	drainAuthIdentities,
	type AuthIdentitySource
} from '../scripts/etl/drain-auth-identities';
import { clearCursor, getCursor, setCursor } from '../scripts/etl/lib';
import { query } from '../src/db/client';
import { ensureMigrated, uniquePrincipal } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

interface ExportRow {
	key: string;
	provider: [] | [string];
	updated_at_ns: string;
	created_at_ns: string;
	openid_email: [] | [string];
	profile_email: [] | [string];
	openid_name: [] | [string];
}

const row = (key: string, email: string): ExportRow => ({
	key,
	provider: ['google'],
	updated_at_ns: '1710000000000000000',
	created_at_ns: '1700000000000000000',
	openid_email: [email],
	profile_email: [],
	openid_name: []
});

/** A fake satellite pager over a fixed key-ordered row set, recording every
 * after_key it was asked for and optionally failing on chosen pages. */
const fakeActor = ({
	rows,
	pageSize,
	failOnPage
}: {
	rows: ExportRow[];
	pageSize: number;
	failOnPage?: number;
}): { actor: AuthIdentitySource; askedAfterKeys: Array<string | undefined> } => {
	const askedAfterKeys: Array<string | undefined> = [];
	let calls = 0;

	const actor: AuthIdentitySource = {
		app_get_auth_identities: ({ after_key }) => {
			calls += 1;

			if (calls === failOnPage) {
				throw new Error('simulated crash');
			}

			const [afterKey] = after_key;

			askedAfterKeys.push(afterKey);

			const start = isNullish(afterKey) ? 0 : rows.findIndex((r) => r.key === afterKey) + 1;
			const page = rows.slice(start, start + pageSize);

			return Promise.resolve({ rows: page, has_more: start + page.length < rows.length });
		}
	};

	return { actor, askedAfterKeys };
};

describe.if(dbAvailable)('etl cursors', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('set, get and clear roundtrip', async () => {
		const id = `test-cursor-${crypto.randomUUID()}`;

		expect(await getCursor({ id })).toBeUndefined();

		await setCursor({ id, cursor: 'a' });

		expect(await getCursor({ id })).toBe('a');

		await setCursor({ id, cursor: 'b' });

		expect(await getCursor({ id })).toBe('b');

		await clearCursor({ id });

		expect(await getCursor({ id })).toBeUndefined();
	});
});

describe.if(dbAvailable)('auth identity drain', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const cleanState = async (): Promise<void> => {
		await clearCursor({ id: DRAIN_CURSOR_ID });
	};

	test('walks every page, upserts rows and clears the cursor on completion', async () => {
		await cleanState();

		const principals = [uniquePrincipal(), uniquePrincipal(), uniquePrincipal()].sort();
		const rows = principals.map((p, i) => row(p, `drain-${i}@test.vici.invalid`));
		const { actor } = fakeActor({ rows, pageSize: 2 });

		const result = await drainAuthIdentities({ actor, pageSize: 2 });

		expect(result.upserted).toBe(3);
		expect(result.pages).toBe(2);
		expect(await getCursor({ id: DRAIN_CURSOR_ID })).toBeUndefined();

		const stored = await query<{ principal: string; openid_email: string }>(
			`select principal, openid_email from legacy_auth_identities where principal = any($1::text[]) order by principal`,
			[principals]
		);

		expect(stored).toHaveLength(3);
	});

	test('a crashed run resumes from the persisted cursor', async () => {
		await cleanState();

		const principals = [
			uniquePrincipal(),
			uniquePrincipal(),
			uniquePrincipal(),
			uniquePrincipal()
		].sort();
		const rows = principals.map((p, i) => row(p, `resume-${i}@test.vici.invalid`));

		// First run dies fetching the second page: page one's rows and cursor
		// are already persisted.
		const crash = fakeActor({ rows, pageSize: 2, failOnPage: 2 });

		await expect(drainAuthIdentities({ actor: crash.actor, pageSize: 2 })).rejects.toThrow(
			'simulated crash'
		);
		expect(await getCursor({ id: DRAIN_CURSOR_ID })).toBe(principals[1]);

		// The retry starts at the stored key and finishes the walk.
		const resume = fakeActor({ rows, pageSize: 2 });
		const result = await drainAuthIdentities({ actor: resume.actor, pageSize: 2 });

		expect(resume.askedAfterKeys[0]).toBe(principals[1]);
		expect(result.upserted).toBe(2);
		expect(await getCursor({ id: DRAIN_CURSOR_ID })).toBeUndefined();

		const stored = await query<{ count: string }>(
			`select count(*)::text as count from legacy_auth_identities where principal = any($1::text[])`,
			[principals]
		);

		expect(Number(stored[0]?.count)).toBe(4);
	});

	test('re-draining upserts in place instead of duplicating', async () => {
		await cleanState();

		const principal = uniquePrincipal();
		const first = fakeActor({ rows: [row(principal, 'old@test.vici.invalid')], pageSize: 10 });

		await drainAuthIdentities({ actor: first.actor });

		const second = fakeActor({ rows: [row(principal, 'new@test.vici.invalid')], pageSize: 10 });

		await drainAuthIdentities({ actor: second.actor });

		const stored = await query<{ openid_email: string }>(
			`select openid_email from legacy_auth_identities where principal = $1`,
			[principal]
		);

		expect(stored).toHaveLength(1);
		expect(stored[0]?.openid_email).toBe('new@test.vici.invalid');
	});
});
