// The two public catalog-wide reads the app makes without a session: every
// market metadata row (tag and suggested-flag projections) and the count of
// live profiles (the landing proof figure).

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { app } from '../src/index';
import { upsertMarketMetadata } from '../src/markets/metadata';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, softDeleteProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const get = (path: string): Promise<Response> => app.handle(new Request(`http://localhost${path}`));

describe.if(dbAvailable)('public catalog reads', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('GET /api/v1/markets/metadata lists stored rows without a session', async () => {
		const seriesId = `srs_${randomBytes(6).toString('hex')}`;
		const admin = { id: await createTestUser('admin'), role: 'admin' as const };

		await upsertMarketMetadata({ user: admin, seriesId, body: { tags: ['soccer'] } });

		const res = await get('/api/v1/markets/metadata');

		expect(res.status).toBe(200);

		const { items } = (await res.json()) as { items: { seriesId: string; tags: string[] }[] };

		expect(items.find((item) => item.seriesId === seriesId)?.tags).toEqual(['soccer']);
	});

	test('GET /api/v1/profiles/count counts live profiles only', async () => {
		const read = async (): Promise<number> => {
			const res = await get('/api/v1/profiles/count');

			expect(res.status).toBe(200);

			return ((await res.json()) as { count: number }).count;
		};

		const before = await read();

		await createTestProfile();
		const { userId: gone } = await createTestProfile();

		await softDeleteProfile(gone);

		expect(await read()).toBe(before + 1);
	});
});
