// Routes that bind a client-sent id into a uuid column answer an id that is
// not a uuid the way they answer an unknown one, instead of failing the uuid
// bind in the query as a 500.

import { beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { app } from '../src/index';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const NON_UUID_IDS = ['2vxsx-fae', 'not-a-uuid'];

describe('GET /api/v1/leaderboard/rank/:userId', () => {
	test.each(NON_UUID_IDS)('refuses the non-uuid id %s as a 400', async (id) => {
		const res = await app.handle(new Request(`http://localhost/api/v1/leaderboard/rank/${id}`));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid_user_id' });
	});
});

describe.if(dbAvailable)('signed-in routes', () => {
	let cookie: string;

	beforeAll(async () => {
		await ensureMigrated();

		cookie = `vici_session=${await createSession(await createTestUser())}`;
	});

	const post = (path: string, body: Record<string, unknown>): Promise<Response> =>
		app.handle(
			new Request(`http://localhost/api/v1${path}`, {
				method: 'POST',
				headers: { cookie, 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		);

	test.each([...NON_UUID_IDS, 'ICP'])(
		'POST /wallet/withdrawals answers the asset id %s as unknown',
		async (assetId) => {
			const res = await post('/wallet/withdrawals', {
				assetId,
				amount: '1',
				destination: 'aaaaa-aa'
			});

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'unknown_asset' });
		}
	);

	test.each(NON_UUID_IDS)(
		'POST /school/verify answers the submission id %s as not found',
		async (submissionId) => {
			const res = await post('/school/verify', { submissionId, code: '123456' });

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: false, message: 'not-found' });
		}
	);
});
