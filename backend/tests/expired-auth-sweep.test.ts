// The expired-auth sweep: long-expired sessions and one-time codes go, live
// and recently expired ones stay, a pass never deletes more than its limit,
// and a second pass over a drained table deletes nothing.

import { beforeAll, describe, expect, test } from 'bun:test';
import { EXPIRED_AUTH_ROW_RETENTION_MS, sweepExpiredAuthRows } from '../src/auth/expired-sweep';
import { query } from '../src/db/client';
import { randomToken } from '../src/lib/crypto';
import { HOUR_IN_MS } from '../src/lib/time';
import { createTestUser, ensureMigrated, uniqueEmail } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const PAST_RETENTION_MS = EXPIRED_AUTH_ROW_RETENTION_MS + HOUR_IN_MS;

const seedSession = async ({
	userId,
	expiresInMs
}: {
	userId: string;
	expiresInMs: number;
}): Promise<string> => {
	const id = randomToken();

	await query(`insert into sessions (id, user_id, expires_at) values ($1, $2, $3)`, [
		id,
		userId,
		new Date(Date.now() + expiresInMs)
	]);

	return id;
};

const seedCode = async (expiresInMs: number): Promise<string> => {
	const [row] = await query<{ id: string }>(
		`insert into otp_codes (email, code_hash, expires_at) values ($1, $2, $3) returning id`,
		[uniqueEmail(), randomToken(), new Date(Date.now() + expiresInMs)]
	);

	return row?.id ?? '';
};

const existing = async ({ table, ids }: { table: 'sessions' | 'otp_codes'; ids: string[] }) =>
	(
		await query<{ id: string }>(`select id::text from ${table} where id::text = any($1)`, [ids])
	).map(({ id }) => id);

/** Sweeps until a pass finds nothing, so rows other suites left behind in the
 * shared database cannot keep this suite's rows out of the bounded batch. */
const drain = async (): Promise<void> => {
	for (;;) {
		const { sessions, otpCodes } = await sweepExpiredAuthRows();

		if (sessions + otpCodes === 0) {
			return;
		}
	}
};

describe.if(dbAvailable)('expired auth sweep', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('removes long-expired rows and keeps live and recently expired ones', async () => {
		const userId = await createTestUser();
		const staleSession = await seedSession({ userId, expiresInMs: -PAST_RETENTION_MS });
		const recentSession = await seedSession({ userId, expiresInMs: -HOUR_IN_MS });
		const liveSession = await seedSession({ userId, expiresInMs: HOUR_IN_MS });
		const staleCode = await seedCode(-PAST_RETENTION_MS);
		const recentCode = await seedCode(-HOUR_IN_MS);
		const liveCode = await seedCode(HOUR_IN_MS);

		await drain();

		expect(
			(
				await existing({ table: 'sessions', ids: [staleSession, recentSession, liveSession] })
			).sort()
		).toEqual([recentSession, liveSession].sort());
		expect(
			(await existing({ table: 'otp_codes', ids: [staleCode, recentCode, liveCode] })).sort()
		).toEqual([recentCode, liveCode].sort());

		expect(await sweepExpiredAuthRows()).toEqual({ sessions: 0, otpCodes: 0 });
	});

	test('one pass deletes at most its limit per table', async () => {
		const userId = await createTestUser();
		const stale = [
			await seedSession({ userId, expiresInMs: -PAST_RETENTION_MS }),
			await seedSession({ userId, expiresInMs: -PAST_RETENTION_MS }),
			await seedSession({ userId, expiresInMs: -PAST_RETENTION_MS })
		];
		const staleCodes = [await seedCode(-PAST_RETENTION_MS), await seedCode(-PAST_RETENTION_MS)];

		expect(await sweepExpiredAuthRows({ limit: 1 })).toEqual({ sessions: 1, otpCodes: 1 });

		expect((await existing({ table: 'sessions', ids: stale })).length).toBeGreaterThanOrEqual(2);
		expect((await existing({ table: 'otp_codes', ids: staleCodes })).length).toBeGreaterThanOrEqual(
			1
		);

		await drain();

		expect(await existing({ table: 'sessions', ids: stale })).toEqual([]);
		expect(await existing({ table: 'otp_codes', ids: staleCodes })).toEqual([]);
	});
});
