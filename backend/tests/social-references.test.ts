// A social write that names a user who does not exist, or replays an
// activity key, is a client error with a stable code, never a 500.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { app } from '../src/index';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const post = async ({
	userId,
	path,
	body
}: {
	userId: string;
	path: string;
	body: Record<string, unknown>;
}): Promise<Response> =>
	await app.handle(
		new Request(`http://localhost/api/v1/social${path}`, {
			method: 'POST',
			headers: {
				cookie: `vici_session=${await createSession(userId)}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(body)
		})
	);

describe.if(dbAvailable)('social writes that name a missing user', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a friend request, a follow or an activity aimed at no user is a 400 unknown_user', async () => {
		const userId = await createTestUser();
		const missing = randomUUID();
		const responses = [
			await post({ userId, path: '/friend-requests', body: { target: missing } }),
			await post({ userId, path: '/follow', body: { target: missing } }),
			await post({
				userId,
				path: '/activities',
				body: { type: 'comment', targetUser: missing, title: 'hi', timestamp: Date.now() }
			})
		];

		for (const response of responses) {
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'unknown_user' });
		}
	});

	test('the same writes aimed at a real user still succeed', async () => {
		const userId = await createTestUser();
		const target = await createTestUser();

		expect((await post({ userId, path: '/friend-requests', body: { target } })).status).toBe(200);
		expect((await post({ userId, path: '/follow', body: { target } })).status).toBe(200);

		const activity = await post({
			userId,
			path: '/activities',
			body: { type: 'comment', targetUser: target, title: 'hi', timestamp: Date.now() }
		});

		expect(activity.status).toBe(201);
	});

	test('a replayed activity key is a 409 activity_exists', async () => {
		const userId = await createTestUser();
		const body = { type: 'comment', title: 'once', timestamp: Date.now() };

		expect((await post({ userId, path: '/activities', body })).status).toBe(201);

		const replay = await post({ userId, path: '/activities', body });

		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual({ error: 'activity_exists' });
	});
});
