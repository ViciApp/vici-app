// Resolved-results digest: idempotent per-(user, market) upsert, the
// friend-scoped retention-windowed read, and the pruning job.

import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import {
	listFriendResolvedResults,
	pruneResolvedResults,
	RESOLVED_RESULTS_RETENTION_MS,
	upsertResolvedResult
} from '../src/social/resolved-results';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe.if(dbAvailable)('resolved results', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a replayed settlement overwrites instead of duplicating', async () => {
		const userId = await createTestUser();

		await upsertResolvedResult({
			userId,
			marketId: 'srs_1',
			title: 'First title',
			side: 'YES',
			outcome: 'win',
			netVxp: 100,
			resolvedAtMs: Date.now()
		});

		await upsertResolvedResult({
			userId,
			marketId: 'srs_1',
			title: 'Replayed title',
			side: 'YES',
			outcome: 'win',
			netVxp: 100,
			resolvedAtMs: Date.now()
		});

		const rows = await listFriendResolvedResults({ friendIds: [userId] });

		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe('Replayed title');
	});

	test('a replayed settlement keeps the first resolution time', async () => {
		const userId = await createTestUser();
		const firstResolvedAtMs = Date.now() - 60_000;

		const upsert = async (resolvedAtMs: number): Promise<void> =>
			await upsertResolvedResult({
				userId,
				marketId: 'srs_replay',
				title: 'Replay',
				side: 'YES',
				outcome: 'win',
				netVxp: 100,
				resolvedAtMs
			});

		await upsert(firstResolvedAtMs);
		await upsert(Date.now());

		const rows = await listFriendResolvedResults({ friendIds: [userId] });

		expect(rows).toHaveLength(1);
		expect(rows[0]?.resolvedAtMs).toBe(firstResolvedAtMs);
	});

	test('the friend read scopes to the given set and the retention window', async () => {
		const friend = await createTestUser();
		const stranger = await createTestUser();
		const now = Date.now();

		await upsertResolvedResult({
			userId: friend,
			marketId: 'srs_recent',
			title: 'Recent',
			side: 'NO',
			outcome: 'loss',
			netVxp: -50,
			resolvedAtMs: now
		});
		await upsertResolvedResult({
			userId: friend,
			marketId: 'srs_stale',
			title: 'Stale',
			side: 'YES',
			outcome: 'win',
			netVxp: 10,
			resolvedAtMs: now - RESOLVED_RESULTS_RETENTION_MS - 1_000
		});
		await upsertResolvedResult({
			userId: stranger,
			marketId: 'srs_other',
			title: 'Not a friend',
			side: 'YES',
			outcome: 'win',
			netVxp: 10,
			resolvedAtMs: now
		});

		const rows = await listFriendResolvedResults({ friendIds: [friend] });

		expect(rows.map((row) => row.marketId)).toEqual(['srs_recent']);
		expect(rows[0]?.outcome).toBe('loss');
		expect(rows[0]?.netVxp).toBe(-50);

		expect(await listFriendResolvedResults({ friendIds: [] })).toEqual([]);
	});

	test('pruning removes only rows past the retention horizon', async () => {
		const userId = await createTestUser();
		const now = Date.now();

		await upsertResolvedResult({
			userId,
			marketId: 'srs_keep',
			title: 'Keep',
			side: 'YES',
			outcome: 'win',
			netVxp: 5,
			resolvedAtMs: now
		});
		await upsertResolvedResult({
			userId,
			marketId: 'srs_prune',
			title: 'Prune',
			side: 'NO',
			outcome: 'loss',
			netVxp: -5,
			resolvedAtMs: now - RESOLVED_RESULTS_RETENTION_MS - 1_000
		});

		const { pruned } = await pruneResolvedResults();

		expect(pruned).toBeGreaterThanOrEqual(1);

		const remaining = await query<{ market_id: string }>(
			`select market_id from resolved_results where user_id = $1 order by market_id`,
			[userId]
		);

		expect(remaining.map((row) => row.market_id)).toEqual(['srs_keep']);
	});

	test('the friend read orders most-recent-first with a deterministic tiebreak', async () => {
		const friend = await createTestUser();
		const now = Date.now();

		const seed = async (marketId: string, resolvedAtMs: number): Promise<void> =>
			await upsertResolvedResult({
				userId: friend,
				marketId,
				title: marketId,
				side: 'YES',
				outcome: 'win',
				netVxp: 1,
				resolvedAtMs
			});

		// Inserted out of order on purpose; the tie between srs_b and srs_a
		// must break on the primary key, not on insertion order.
		await seed('srs_b', now);
		await seed('srs_old', now - 1_000);
		await seed('srs_new', now + 1_000);
		await seed('srs_a', now);

		const rows = await listFriendResolvedResults({ friendIds: [friend] });

		expect(rows.map((row) => row.marketId)).toEqual(['srs_new', 'srs_a', 'srs_b', 'srs_old']);
	});
});
