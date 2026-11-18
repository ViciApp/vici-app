// Budgets on the social and referral routes that do work per request: trade
// activities are limited per account (each one re-reads the engine trade
// history), the market id an activity or a reaction stores is bounded, and the
// public referral code lookup is limited per client IP.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';
import { ACTIVITY_MARKET_ID_MAX_LENGTH, createActivity } from '../src/social/activities';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const postActivity = async ({
	cookie,
	body
}: {
	cookie: string;
	body: Record<string, unknown>;
}): Promise<Response> =>
	await app.handle(
		new Request('http://localhost/api/v1/social/activities', {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);

const sessionCookie = async (userId: string): Promise<string> =>
	`vici_session=${await createSession(userId)}`;

const lookup = async (ip: string): Promise<Response> =>
	await app.handle(
		new Request('http://localhost/api/v1/referrals/lookup?code=NOPE', {
			headers: { 'fly-client-ip': ip }
		})
	);

beforeEach(() => {
	resetRateLimits();
});

describe.if(dbAvailable)('trade activity budget', () => {
	let historyReads = 0;
	let restoreEngine: (() => void) | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		historyReads = 0;
		restoreEngine = setEngineActorProvider({
			clearing: () =>
				Promise.resolve({
					get_trade_history: () => {
						historyReads += 1;

						return Promise.resolve([]);
					}
				} as unknown as ClearingService),
			registry: () => Promise.resolve({} as unknown as RegistryService)
		});
	});

	afterEach(() => {
		restoreEngine?.();
		restoreEngine = undefined;
	});

	test('an account past the budget gets a 429 and triggers no further history read', async () => {
		const cookie = await sessionCookie(await createTestUser());
		const baseMs = Date.now();
		const trade = (offset: number): Record<string, unknown> => ({
			type: 'trade',
			title: 'Predicted 10 on YES @ 50%',
			timestamp: baseMs + offset
		});

		const statuses: number[] = [];

		for (let offset = 0; offset < 30; offset++) {
			statuses.push((await postActivity({ cookie, body: trade(offset) })).status);
		}

		expect(statuses.every((status) => status === 201)).toBe(true);

		const limited = await postActivity({ cookie, body: trade(30) });

		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: 'rate_limited' });
		expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(historyReads).toBe(30);

		// Only trades spend the budget, and it is per account.
		const comment = await postActivity({
			cookie,
			body: { type: 'comment', title: 'nice call', timestamp: baseMs }
		});

		expect(comment.status).toBe(201);

		const other = await postActivity({
			cookie: await sessionCookie(await createTestUser()),
			body: trade(0)
		});

		expect(other.status).toBe(201);
	});
});

describe.if(dbAvailable)('stored market id bound', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('an activity or a reaction with an overlong market id is refused', async () => {
		const userId = await createTestUser();
		const cookie = await sessionCookie(userId);
		const marketId = 'm'.repeat(ACTIVITY_MARKET_ID_MAX_LENGTH + 1);
		const timestamp = Date.now();

		const activity = await postActivity({
			cookie,
			body: { type: 'comment', marketId, title: 'too long', timestamp }
		});

		expect(activity.status).toBe(400);

		const atCap = await postActivity({
			cookie,
			body: {
				type: 'comment',
				marketId: marketId.slice(1),
				title: 'at the cap',
				timestamp: timestamp + 1
			}
		});

		expect(atCap.status).toBe(201);

		const liked = await createActivity({
			userId,
			type: 'comment',
			title: 'to like',
			timestamp: timestamp + 2
		});
		const reaction = await app.handle(
			new Request('http://localhost/api/v1/social/activity-reactions', {
				method: 'POST',
				headers: { cookie, 'content-type': 'application/json' },
				body: JSON.stringify({
					activityKey: liked.key,
					timestamp: Date.now(),
					activityTitle: liked.title,
					marketId
				})
			})
		);

		expect(reaction.status).toBe(400);
	});
});

describe('referral code lookup budget', () => {
	test('a client IP past the budget gets a 429; another IP is unaffected', async () => {
		const statuses = new Set<number>();

		for (let i = 0; i < 120; i++) {
			statuses.add((await lookup('203.0.113.7')).status);
		}

		expect([...statuses]).toEqual([200]);

		const limited = await lookup('203.0.113.7');

		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: 'rate_limited' });
		expect((await lookup('203.0.113.8')).status).toBe(200);
	});
});
