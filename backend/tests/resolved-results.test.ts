// Resolved-results digest: idempotent per-(user, market) upsert, the
// friend-scoped retention-windowed read (the caller's active, visible
// friends only), and the pruning job.

import { beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { acceptFriendRequest, friendRelationKey, sendFriendRequest } from '../src/social/relations';
import {
	listFriendResolvedResults,
	pruneResolvedResults,
	RESOLVED_RESULTS_RETENTION_MS,
	upsertResolvedResult
} from '../src/social/resolved-results';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, hibernateProfile, softDeleteProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

/** A viewer with a profile and one active friend who has a profile too. */
const seedFriends = async (): Promise<{ viewerId: string; friend: string }> => {
	const { userId: viewerId } = await createTestProfile();
	const { userId: friend } = await createTestProfile();

	await sendFriendRequest({ senderId: viewerId, targetId: friend });
	await acceptFriendRequest({ relationId: friendRelationKey(viewerId, friend), callerId: friend });

	return { viewerId, friend };
};

const seedResult = async ({
	userId,
	marketId
}: {
	userId: string;
	marketId: string;
}): Promise<void> =>
	await upsertResolvedResult({
		userId,
		marketId,
		title: marketId,
		side: 'YES',
		outcome: 'win',
		netVxp: 1,
		resolvedAtMs: Date.now()
	});

describe.if(dbAvailable)('resolved results', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a replayed settlement overwrites instead of duplicating', async () => {
		const { viewerId, friend: userId } = await seedFriends();

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

		const rows = await listFriendResolvedResults({ viewerId, friendIds: [userId] });

		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe('Replayed title');
	});

	test('a replayed settlement keeps the first resolution time', async () => {
		const { viewerId, friend: userId } = await seedFriends();
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

		const rows = await listFriendResolvedResults({ viewerId, friendIds: [userId] });

		expect(rows).toHaveLength(1);
		expect(rows[0]?.resolvedAtMs).toBe(firstResolvedAtMs);
	});

	test('the friend read scopes to the given set and the retention window', async () => {
		const { viewerId, friend } = await seedFriends();
		const { userId: stranger } = await createTestProfile();
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

		const rows = await listFriendResolvedResults({ viewerId, friendIds: [friend] });

		expect(rows.map((row) => row.marketId)).toEqual(['srs_recent']);
		expect(rows[0]?.outcome).toBe('loss');
		expect(rows[0]?.netVxp).toBe(-50);

		expect(await listFriendResolvedResults({ viewerId, friendIds: [] })).toEqual([]);
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
		const { viewerId, friend } = await seedFriends();
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

		const rows = await listFriendResolvedResults({ viewerId, friendIds: [friend] });

		expect(rows.map((row) => row.marketId)).toEqual(['srs_new', 'srs_a', 'srs_b', 'srs_old']);
	});

	test('the friend read leaves out an id that is not an active friend', async () => {
		const { viewerId, friend } = await seedFriends();
		const { userId: stranger } = await createTestProfile();
		const { userId: requested } = await createTestProfile();

		await sendFriendRequest({ senderId: viewerId, targetId: requested });

		for (const userId of [friend, stranger, requested]) {
			await seedResult({ userId, marketId: `srs_scope_${userId}` });
		}

		const rows = await listFriendResolvedResults({
			viewerId,
			friendIds: [friend, stranger, requested]
		});

		expect(rows.map((row) => row.userId)).toEqual([friend]);
	});

	test('the friend read leaves out a friend whose account is deleted or hibernated', async () => {
		const deleted = await seedFriends();
		const hibernated = await seedFriends();

		await seedResult({ userId: deleted.friend, marketId: 'srs_deleted' });
		await seedResult({ userId: hibernated.friend, marketId: 'srs_hibernated' });
		await softDeleteProfile(deleted.friend);
		await hibernateProfile(hibernated.friend);

		expect(
			await listFriendResolvedResults({ viewerId: deleted.viewerId, friendIds: [deleted.friend] })
		).toEqual([]);
		expect(
			await listFriendResolvedResults({
				viewerId: hibernated.viewerId,
				friendIds: [hibernated.friend]
			})
		).toEqual([]);
	});

	test("the route answers only the caller's friends", async () => {
		const { viewerId, friend } = await seedFriends();
		const { userId: stranger } = await createTestProfile();

		await seedResult({ userId: friend, marketId: 'srs_route_friend' });
		await seedResult({ userId: stranger, marketId: 'srs_route_stranger' });

		const response = await app.handle(
			new Request(`http://localhost/api/v1/social/resolved-results?friends=${friend},${stranger}`, {
				headers: { cookie: `vici_session=${await createSession(viewerId)}` }
			})
		);
		const body = (await response.json()) as { items: { marketId: string }[] };

		expect(response.status).toBe(200);
		expect(body.items.map((item) => item.marketId)).toEqual(['srs_route_friend']);
	});
});
