// Activity feed reactions: the transactional like/unlike rollup, its
// consistency under concurrent-ish writes, and the admin recompute that
// heals drift.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import {
	boundedLimit,
	DEFAULT_ACTIVITY_LIMIT,
	DEFAULT_REACTIONS_LIMIT,
	MAX_ACTIVITY_LIMIT,
	MAX_REACTIONS_LIMIT
} from '../src/routes/social';
import {
	ActivityNotFoundError,
	createActivity,
	likeActivity,
	listActivities,
	listReactions,
	listReceivedReactions,
	recomputeActivityReactionCounts,
	unlikeActivity
} from '../src/social/activities';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const countOf = async (activityKey: string): Promise<number | undefined> => {
	const rows = await query<{ count: number }>(
		`select count from activity_reaction_counts where activity_key = $1`,
		[activityKey]
	);

	return rows[0]?.count;
};

describe.if(dbAvailable)('activities', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('creates a keyed activity and lists it', async () => {
		const userId = await createTestUser();
		const timestamp = Date.now();

		const activity = await createActivity({
			userId,
			type: 'trade',
			title: 'Placed a prediction',
			marketId: 'srs_1',
			timestamp
		});

		expect(activity.key).toBe(`${userId}#${timestamp}#trade`);

		const items = await listActivities({ limit: 50 });

		expect(items.some((item) => item.key === activity.key)).toBe(true);
	});

	test('rejects unknown types and unsafe timestamps', async () => {
		const userId = await createTestUser();

		expect(
			createActivity({ userId, type: 'bogus', title: 't', timestamp: Date.now() })
		).rejects.toThrow('Unknown activity type');

		expect(
			createActivity({ userId, type: 'trade', title: 't', timestamp: Number.MAX_SAFE_INTEGER + 1 })
		).rejects.toThrow('safe integer');
	});

	test('filters by type', async () => {
		const userId = await createTestUser();

		await createActivity({ userId, type: 'comment', title: 'c', timestamp: Date.now() });

		const comments = await listActivities({ limit: 100, type: 'comment' });

		expect(comments.length).toBeGreaterThan(0);
		expect(comments.every((item) => item.type === 'comment')).toBe(true);
	});
});

describe.if(dbAvailable)('reaction rollup', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const seedActivity = async (): Promise<string> => {
		const userId = await createTestUser();
		const activity = await createActivity({
			userId,
			type: 'trade',
			title: 'Placed a prediction',
			timestamp: Date.now()
		});

		return activity.key;
	};

	test('like increments once; a re-like does not double-count', async () => {
		const activityKey = await seedActivity();
		const liker = await createTestUser();

		await likeActivity({ likerId: liker, activityKey, timestamp: Date.now(), activityTitle: 't' });

		expect(await countOf(activityKey)).toBe(1);

		await likeActivity({ likerId: liker, activityKey, timestamp: Date.now(), activityTitle: 't' });

		expect(await countOf(activityKey)).toBe(1);
	});

	test('unlike decrements to zero and never below', async () => {
		const activityKey = await seedActivity();
		const liker = await createTestUser();

		await likeActivity({ likerId: liker, activityKey, timestamp: Date.now(), activityTitle: 't' });
		await unlikeActivity({ likerId: liker, activityKey });

		expect(await countOf(activityKey)).toBe(0);

		// Unliking again is a no-op, not a negative count.
		await unlikeActivity({ likerId: liker, activityKey });

		expect(await countOf(activityKey)).toBe(0);
	});

	test('concurrent-ish likes from distinct users land an exact count', async () => {
		const activityKey = await seedActivity();
		const likers = await Promise.all(Array.from({ length: 8 }, () => createTestUser()));

		await Promise.all(
			likers.map((likerId) =>
				likeActivity({ likerId, activityKey, timestamp: Date.now(), activityTitle: 't' })
			)
		);

		expect(await countOf(activityKey)).toBe(8);

		await Promise.all(likers.map((likerId) => unlikeActivity({ likerId, activityKey })));

		expect(await countOf(activityKey)).toBe(0);
	});

	test('rejects a malformed activity key and an oversized title', async () => {
		const liker = await createTestUser();

		expect(
			likeActivity({
				likerId: liker,
				activityKey: 'not-a-key',
				timestamp: Date.now(),
				activityTitle: 't'
			})
		).rejects.toThrow('reaction key');

		expect(
			likeActivity({
				likerId: liker,
				activityKey: await seedActivity(),
				timestamp: Date.now(),
				activityTitle: 'x'.repeat(501)
			})
		).rejects.toThrow('at most 500');
	});

	test('rejects a reaction to a nonexistent activity and writes no rollup', async () => {
		const liker = await createTestUser();
		// Structurally valid key, but no activities row behind it.
		const phantomKey = `${randomUUID()}#${Date.now()}#trade`;

		await expect(
			likeActivity({
				likerId: liker,
				activityKey: phantomKey,
				timestamp: Date.now(),
				activityTitle: 't'
			})
		).rejects.toThrow(ActivityNotFoundError);

		expect(await countOf(phantomKey)).toBeUndefined();
	});

	test('reactions list surfaces the denormalized fields', async () => {
		const activityKey = await seedActivity();
		const liker = await createTestUser();

		await likeActivity({
			likerId: liker,
			activityKey,
			timestamp: Date.now(),
			activityTitle: 'Denormalized title',
			marketId: 'srs_9'
		});

		const reactions = await listReactions({ limit: 1000 });
		const mine = reactions.find((r) => r.activityKey === activityKey && r.liker === liker);

		expect(mine?.activityTitle).toBe('Denormalized title');
		expect(mine?.marketId).toBe('srs_9');
	});

	test('recompute heals a drifted counter and zeroes an orphaned one', async () => {
		const activityKey = await seedActivity();
		const liker = await createTestUser();

		await likeActivity({ likerId: liker, activityKey, timestamp: Date.now(), activityTitle: 't' });

		// Drift the counter away from the reaction rows.
		await query(`update activity_reaction_counts set count = 5 where activity_key = $1`, [
			activityKey
		]);

		// Orphan counter: no reaction rows behind it.
		const orphanKey = await seedActivity();

		await query(
			`insert into activity_reaction_counts (activity_key, count, updated_at_ms) values ($1, 3, $2)`,
			[orphanKey, Date.now()]
		);

		const { recomputed } = await recomputeActivityReactionCounts();

		expect(recomputed).toBeGreaterThanOrEqual(2);
		expect(await countOf(activityKey)).toBe(1);
		expect(await countOf(orphanKey)).toBe(0);
	});
});

describe.if(dbAvailable)('received reactions', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const activityOf = async (userId: string): Promise<string> => {
		const { key } = await createActivity({
			userId,
			type: 'trade',
			title: 'Placed a prediction',
			timestamp: Date.now()
		});

		return key;
	};

	const like = async ({
		likerId,
		activityKey
	}: {
		likerId: string;
		activityKey: string;
	}): Promise<void> =>
		await likeActivity({ likerId, activityKey, timestamp: Date.now(), activityTitle: 't' });

	test('lists the likes on the author own activities, past newer likes elsewhere', async () => {
		const author = await createTestUser();
		const ownKey = await activityOf(author);
		const fan = await createTestUser();

		await like({ likerId: fan, activityKey: ownKey });

		const otherKey = await activityOf(await createTestUser());

		for (const likerId of await Promise.all([createTestUser(), createTestUser()])) {
			await like({ likerId, activityKey: otherKey });
		}

		const window = await listReactions({ limit: 2 });

		expect(window.some((r) => r.activityKey === ownKey)).toBe(false);

		const received = await listReceivedReactions({ authorId: author, limit: 2 });

		expect(received.map(({ activityKey, liker }) => ({ activityKey, liker }))).toEqual([
			{ activityKey: ownKey, liker: fan }
		]);
	});

	test('returns newest first and honours the limit', async () => {
		const author = await createTestUser();
		const first = await activityOf(author);
		const second = await activityOf(author);
		const fan = await createTestUser();

		await like({ likerId: fan, activityKey: first });
		await like({ likerId: fan, activityKey: second });

		const received = await listReceivedReactions({ authorId: author, limit: 1 });

		expect(received.map(({ activityKey }) => activityKey)).toEqual([second]);
		expect(await listReceivedReactions({ authorId: author, limit: 0 })).toEqual([]);
	});

	test('the route answers the signed-in author only', async () => {
		const author = await createTestUser();
		const ownKey = await activityOf(author);
		const fan = await createTestUser();

		await like({ likerId: fan, activityKey: ownKey });

		const anonymous = await app.handle(
			new Request('http://localhost/api/v1/social/activity-reactions/received')
		);

		expect(anonymous.status).toBe(401);

		const signedIn = await app.handle(
			new Request('http://localhost/api/v1/social/activity-reactions/received?limit=10', {
				headers: { cookie: `vici_session=${await createSession(author)}` }
			})
		);
		const { items } = (await signedIn.json()) as { items: { activityKey: string }[] };

		expect(signedIn.status).toBe(200);
		expect(items.map(({ activityKey }) => activityKey)).toEqual([ownKey]);

		const asFan = await app.handle(
			new Request('http://localhost/api/v1/social/activity-reactions/received', {
				headers: { cookie: `vici_session=${await createSession(fan)}` }
			})
		);

		expect(((await asFan.json()) as { items: unknown[] }).items).toEqual([]);
	});
});

describe('boundedLimit', () => {
	test('each surface caps at its own ceiling, so both defaults are reachable', () => {
		expect(
			boundedLimit({ raw: undefined, fallback: DEFAULT_ACTIVITY_LIMIT, max: MAX_ACTIVITY_LIMIT })
		).toBe(DEFAULT_ACTIVITY_LIMIT);
		expect(
			boundedLimit({ raw: '2000', fallback: DEFAULT_ACTIVITY_LIMIT, max: MAX_ACTIVITY_LIMIT })
		).toBe(MAX_ACTIVITY_LIMIT);

		expect(
			boundedLimit({ raw: undefined, fallback: DEFAULT_REACTIONS_LIMIT, max: MAX_REACTIONS_LIMIT })
		).toBe(DEFAULT_REACTIONS_LIMIT);
		expect(
			boundedLimit({
				raw: `${DEFAULT_REACTIONS_LIMIT}`,
				fallback: DEFAULT_REACTIONS_LIMIT,
				max: MAX_REACTIONS_LIMIT
			})
		).toBe(DEFAULT_REACTIONS_LIMIT);
		expect(
			boundedLimit({ raw: '5000', fallback: DEFAULT_REACTIONS_LIMIT, max: MAX_REACTIONS_LIMIT })
		).toBe(MAX_REACTIONS_LIMIT);
	});

	test('falls back on non-integer and negative input', () => {
		for (const raw of ['-5', '1.5', 'abc', 'NaN']) {
			expect(boundedLimit({ raw, fallback: DEFAULT_ACTIVITY_LIMIT, max: MAX_ACTIVITY_LIMIT })).toBe(
				DEFAULT_ACTIVITY_LIMIT
			);
		}
	});
});
