// Analytics: batch ingest (cap, length caps, server stamps, pseudonymous user
// link), the public ingest route's limits, transactional rollup math, the server-side capture bridge, the keyset
// export with its idempotent drain, and the admin summary reads.

import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { captureServerEvents, trackEvents } from '../src/analytics/events';
import {
	deleteAnalyticsEvents,
	getAnalyticsEvents,
	getAnalyticsProfileCreated,
	getAnalyticsSummary,
	getAnalyticsUserStats
} from '../src/analytics/export';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { ZERO } from '../src/lib/constants';
import { resetRateLimits } from '../src/lib/rate-limit';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueSession = (): string => `sess-${randomBytes(6).toString('hex')}`;

interface EventRow {
	key: string;
	name: string;
	ts_ms: string | number;
	session_id: string;
	user_id: string | null;
	path: string | null;
	props: Record<string, unknown> | null;
}

const rowsForSession = (sessionId: string): Promise<EventRow[]> =>
	query<EventRow>(`select * from analytics_events where session_id = $1 order by key`, [sessionId]);

const rollupCount = async (name: string): Promise<number> => {
	const epochDay = Math.floor(Date.now() / 86_400_000);
	const rows = await query<{ count: string | number }>(
		`select count from analytics_event_rollups where epoch_day = $1 and name = $2`,
		[epochDay, name]
	);

	return Number(rows[0]?.count ?? 0);
};

describe.if(dbAvailable)('analytics ingest', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('an empty batch accepts zero', async () => {
		expect(await trackEvents({ events: [] })).toEqual({ accepted: 0 });
	});

	test('writes server-stamped rows with a pseudonymous user link', async () => {
		const userId = await createTestUser();
		const sessionId = uniqueSession();
		const before = Date.now();

		const { accepted } = await trackEvents({
			userId,
			events: [
				{ name: 'market_viewed', sessionId, path: '/markets/abc', marketId: 'srs_1' },
				{ name: 'flow_swipe', sessionId, label: 'yes', step: 3, occurredAtMs: 12345 }
			]
		});

		expect(accepted).toBe(2);

		const rows = await rowsForSession(sessionId);

		expect(rows).toHaveLength(2);
		expect(rows[0]?.name).toBe('market_viewed');
		expect(rows[0]?.user_id).toBe(userId);
		expect(rows[0]?.path).toBe('/markets/abc');
		expect(rows[0]?.props).toEqual({ marketId: 'srs_1' });
		// The server stamp wins: the advisory client time never lands.
		expect(Number(rows[1]?.ts_ms)).toBeGreaterThanOrEqual(before);
		expect(rows[1]?.props).toEqual({ label: 'yes', step: 3 });
	});

	test('anonymous ingest stores no user link', async () => {
		const sessionId = uniqueSession();

		await trackEvents({ events: [{ name: 'session_started', sessionId }] });

		const rows = await rowsForSession(sessionId);

		expect(rows[0]?.user_id).toBeNull();
	});

	test('caps a batch at 100 events and reports the accepted count', async () => {
		const sessionId = uniqueSession();
		const events = Array.from({ length: 120 }, () => ({ name: 'perf_metric', sessionId }));

		expect(await trackEvents({ events })).toEqual({ accepted: 100 });
		expect(await rowsForSession(sessionId)).toHaveLength(100);
	});

	test('rejects unknown names and malformed dimensions, writing nothing', async () => {
		const sessionId = uniqueSession();

		expect(trackEvents({ events: [{ name: 'not_an_event', sessionId }] })).rejects.toThrow(
			'known event name'
		);

		expect(
			trackEvents({
				events: [
					{ name: 'app_error', sessionId },
					{ name: 'app_error', sessionId, step: 'three' }
				]
			})
		).rejects.toThrow('wrong type');

		// The batch is transactional: the valid first event must not survive
		// the invalid second one.
		expect(await rowsForSession(sessionId)).toHaveLength(0);
	});

	test('rejects an overlong sessionId, path or string dimension, writing nothing', async () => {
		const sessionId = uniqueSession();

		await expect(
			trackEvents({ events: [{ name: 'app_error', sessionId: 's'.repeat(129) }] })
		).rejects.toThrow('sessionId exceeds 128 characters');

		await expect(
			trackEvents({
				events: [
					{ name: 'app_error', sessionId },
					{ name: 'app_error', sessionId, path: `/${'p'.repeat(2048)}` }
				]
			})
		).rejects.toThrow('path exceeds 2048 characters');

		await expect(
			trackEvents({ events: [{ name: 'app_error', sessionId, label: 'l'.repeat(257) }] })
		).rejects.toThrow('label exceeds 256 characters');

		expect(await rowsForSession(sessionId)).toHaveLength(0);
	});

	test('accepts strings right at the length caps', async () => {
		const sessionId = `${uniqueSession()}-`.padEnd(128, 's');

		expect(
			await trackEvents({
				events: [
					{
						name: 'market_viewed',
						sessionId,
						path: `/${'p'.repeat(2047)}`,
						marketId: 'm'.repeat(256)
					}
				]
			})
		).toEqual({ accepted: 1 });
		expect(await rowsForSession(sessionId)).toHaveLength(1);
	});

	test('rollups accumulate per (day, name) across batches', async () => {
		const sessionId = uniqueSession();
		const baseline = await rollupCount('sound_toggled');

		await trackEvents({
			events: [
				{ name: 'sound_toggled', sessionId },
				{ name: 'sound_toggled', sessionId }
			]
		});
		await trackEvents({ events: [{ name: 'sound_toggled', sessionId }] });

		expect(await rollupCount('sound_toggled')).toBe(baseline + 3);
	});

	test('captureServerEvents stamps the server session and bumps rollups', async () => {
		const userId = await createTestUser();
		const baseline = await rollupCount('vxp_awarded');

		await captureServerEvents({
			events: [{ name: 'vxp_awarded', userId, props: { value: 25, label: 'streak' } }]
		});
		await captureServerEvents({
			events: [{ name: 'vxp_awarded', userId, props: { value: 10, label: 'flow' } }]
		});

		const rows = await query<EventRow>(
			`select * from analytics_events where session_id = 'server' and user_id = $1 order by key`,
			[userId]
		);

		expect(rows).toHaveLength(2);
		expect(rows[0]?.props).toEqual({ value: 25, label: 'streak' });
		expect(await rollupCount('vxp_awarded')).toBe(baseline + 2);
	});

	test('summary flattens the trailing days, newest first', async () => {
		const sessionId = uniqueSession();

		await trackEvents({ events: [{ name: 'faucet_claimed', sessionId }] });

		const { rows } = await getAnalyticsSummary({ days: 1 });
		const today = Math.floor(Date.now() / 86_400_000);
		const faucet = rows.find(({ name }) => name === 'faucet_claimed');

		expect(faucet?.day).toBe(today);
		expect(faucet?.start).toBe(today * 86_400_000);
		expect(faucet?.count).toBeGreaterThanOrEqual(1);
		expect(rows.every(({ day }) => day === today)).toBe(true);

		expect((await getAnalyticsSummary({ days: 0 })).rows).toEqual([]);
	});
});

describe.if(dbAvailable)('analytics export and drain', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	/** Seed `count` events in one session and return their keys in key order. */
	const seed = async (count: number): Promise<{ sessionId: string; keys: string[] }> => {
		const sessionId = uniqueSession();

		for (let i = 0; i < count; i++) {
			await trackEvents({ events: [{ name: 'perf_metric', sessionId, durationMs: i }] });
		}

		const rows = await rowsForSession(sessionId);

		return { sessionId, keys: rows.map(({ key }) => key) };
	};

	test('keyset pagination walks every row in key order without gaps or repeats', async () => {
		const { sessionId, keys } = await seed(5);

		const collected: string[] = [];
		let afterUpdatedAtNs: string | undefined;
		// Keys are monotonic and the walk is key-ordered, so cursoring in just
		// below the first seeded key bounds the walk to this test's own rows
		// instead of the whole log a long-lived local database accumulates.
		let afterKey: string | undefined = keys[0]?.slice(0, -1);

		for (;;) {
			const { rows, hasMore } = await getAnalyticsEvents({ afterUpdatedAtNs, afterKey, limit: 2 });

			for (const row of rows) {
				if (row.sessionId === sessionId) {
					collected.push(row.key);
				}
			}

			if (collected.length === keys.length || !hasMore || rows.length === 0) {
				break;
			}

			const last = rows[rows.length - 1];

			afterUpdatedAtNs = last?.updatedAtNs;
			afterKey = last?.key;
		}

		expect(collected).toEqual(keys);
	});

	test('rejects a timestamp-only cursor and clamps the limit', async () => {
		expect(getAnalyticsEvents({ afterUpdatedAtNs: '123', limit: 10 })).rejects.toThrow(
			'after_key is required'
		);

		// An over-asking limit is clamped to the ceiling rather than honored.
		const { rows } = await getAnalyticsEvents({ limit: 100000 });

		expect(rows.length).toBeLessThanOrEqual(100);
	});

	test('export rows flatten the stored dimensions', async () => {
		const { sessionId, keys } = await seed(1);

		// Cursor in just below the seeded key so the page starts at it even
		// when earlier suites filled the log.
		const { rows } = await getAnalyticsEvents({ afterKey: keys[0]?.slice(0, -1), limit: 100 });
		const mine = rows.find((row) => row.sessionId === sessionId);

		expect(mine?.name).toBe('perf_metric');
		expect(mine?.durationMs).toBe(0);
		expect(mine?.createdAtNs).toBe(mine?.updatedAtNs);
		expect(BigInt(mine?.createdAtNs ?? '0') > ZERO).toBe(true);
	});

	test('the drain deletes listed keys and is idempotent on a retry', async () => {
		const { sessionId, keys } = await seed(3);

		expect(await deleteAnalyticsEvents({ keys })).toEqual({ deleted: 3 });
		expect(await rowsForSession(sessionId)).toHaveLength(0);

		// Retrying the same page (downstream write landed, delete unsure) is safe.
		expect(await deleteAnalyticsEvents({ keys })).toEqual({ deleted: 0 });
		expect(await deleteAnalyticsEvents({ keys: [] })).toEqual({ deleted: 0 });
	});

	test('user stats count every profile row, soft-deleted included', async () => {
		const { registered: before } = await getAnalyticsUserStats();

		const activeId = await createTestUser();
		const deletedId = await createTestUser();

		await query(`insert into profiles (user_id) values ($1)`, [activeId]);
		await query(`insert into profiles (user_id, deleted_at_ms) values ($1, $2)`, [
			deletedId,
			Date.now()
		]);

		const { registered: after } = await getAnalyticsUserStats();

		expect(after).toBe(before + 2);
	});

	test('profile-created export pages by key and carries created_at in ns', async () => {
		const userId = await createTestUser();

		await query(`insert into profiles (user_id) values ($1)`, [userId]);

		const collected: { key: string; createdAtNs: string }[] = [];
		let afterKey: string | undefined;

		for (;;) {
			const { rows, hasMore } = await getAnalyticsProfileCreated({ afterKey, limit: 100 });

			collected.push(...rows);

			if (!hasMore || rows.length === 0) {
				break;
			}

			afterKey = rows[rows.length - 1]?.key;
		}

		const mine = collected.find(({ key }) => key === userId);

		expect(mine).toBeDefined();
		expect(BigInt(mine?.createdAtNs ?? '0') > ZERO).toBe(true);

		// Keyset order and no duplicates across pages.
		const keys = collected.map(({ key }) => key);

		expect(new Set(keys).size).toBe(keys.length);
		expect([...keys].sort()).toEqual(keys);
	});
});

// Addresses from TEST-NET-3 (RFC 5737), so the per-IP bucket under test never
// collides with a real client or another suite's "unknown" key.
const postEvents = ({ events, ip }: { events: unknown[]; ip: string }): Promise<Response> =>
	app.handle(
		new Request('http://localhost/api/v1/events', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
			body: JSON.stringify({ events })
		})
	);

describe.if(dbAvailable)('analytics ingest route', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	test('a normal anonymous batch is accepted', async () => {
		const sessionId = uniqueSession();
		const res = await postEvents({
			ip: '203.0.113.10',
			events: [
				{ name: 'session_started', sessionId, path: '/', label: 'dark' },
				{ name: 'market_viewed', sessionId, path: '/markets/abc', marketId: 'srs_1' }
			]
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ accepted: 2 });
		expect(await rowsForSession(sessionId)).toHaveLength(2);
	});

	test('a batch over 100 events is a 400 and writes nothing', async () => {
		const sessionId = uniqueSession();
		const res = await postEvents({
			ip: '203.0.113.11',
			events: Array.from({ length: 101 }, () => ({ name: 'perf_metric', sessionId }))
		});

		expect(res.status).toBe(400);
		expect(await rowsForSession(sessionId)).toHaveLength(0);
	});

	test('an overlong path or sessionId is a 400 and writes nothing', async () => {
		const sessionId = uniqueSession();
		const longPath = await postEvents({
			ip: '203.0.113.12',
			events: [{ name: 'app_error', sessionId, path: `/${'p'.repeat(4096)}` }]
		});
		const longSession = await postEvents({
			ip: '203.0.113.12',
			events: [{ name: 'app_error', sessionId: `${sessionId}${'s'.repeat(4096)}` }]
		});

		expect(longPath.status).toBe(400);
		expect(longSession.status).toBe(400);
		expect(await rowsForSession(sessionId)).toHaveLength(0);
	});

	test('answers 429 with Retry-After once an IP spends its bucket', async () => {
		const ip = '203.0.113.13';

		for (let i = 0; i < 600; i++) {
			const res = await postEvents({ ip, events: [] });

			expect(res.status).toBe(200);
		}

		const limited = await postEvents({ ip, events: [] });

		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: 'rate_limited' });
		expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

		// The bucket is per IP: another client is unaffected.
		expect((await postEvents({ ip: '203.0.113.14', events: [] })).status).toBe(200);
	});
});
