// Public profile search: blank and too-short queries list nobody, results are
// capped with the exact handle first, and the route is limited per client IP.

import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { app } from '../src/index';
import { resetRateLimits } from '../src/lib/rate-limit';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

interface SearchBody {
	items: { userId: string; nickname: string }[];
}

// The rate limiter is in-memory and reset per test, so a random address only
// keeps tests in one run from sharing a window.
const uniqueIp = (): string => `10.${[...randomBytes(3)].join('.')}`;

// The cap the route promises; spelled out so the test pins the contract.
const MAX_RESULTS = 20;

const search = async ({ q, ip }: { q: string; ip: string }): Promise<Response> =>
	await app.handle(
		new Request(`http://localhost/api/v1/profiles/search?${new URLSearchParams({ q })}`, {
			headers: { 'x-forwarded-for': ip }
		})
	);

const searchItems = async ({ q, ip }: { q: string; ip: string }): Promise<SearchBody['items']> => {
	const res = await search({ q, ip });

	expect(res.status).toBe(200);

	return ((await res.json()) as SearchBody).items;
};

describe.if(dbAvailable)('profile search', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	test('a handle and an account id find the profile', async () => {
		const { userId, profile } = await createTestProfile();
		const ip = uniqueIp();

		expect((await searchItems({ q: profile.nickname, ip })).map(({ userId: id }) => id)).toEqual([
			userId
		]);
		expect((await searchItems({ q: userId, ip })).map(({ userId: id }) => id)).toEqual([userId]);
	});

	test('a blank, whitespace or one-letter query lists nobody', async () => {
		await createTestProfile();
		const ip = uniqueIp();

		expect(await searchItems({ q: '', ip })).toEqual([]);
		expect(await searchItems({ q: '   ', ip })).toEqual([]);
		expect(await searchItems({ q: 'n', ip })).toEqual([]);
	});

	test('results are capped, exact handle first, then handles that start with the query', async () => {
		const base = `s${randomBytes(4).toString('hex')}`;

		for (let i = 0; i < 4; i++) {
			await createTestProfile({ nickname: `x${base}${i}` });
		}

		for (let i = 0; i < MAX_RESULTS + 4; i++) {
			await createTestProfile({ nickname: `${base}${String(i).padStart(2, '0')}` });
		}

		const { userId: exactId } = await createTestProfile({ nickname: base });
		const items = await searchItems({ q: base.toUpperCase(), ip: uniqueIp() });

		expect(items).toHaveLength(MAX_RESULTS);
		expect(items[0]?.userId).toBe(exactId);

		for (const { nickname } of items.slice(1)) {
			expect(nickname.startsWith(base)).toBeTrue();
		}
	});

	test('one client IP gets 300 searches an hour, then 429; another IP is unaffected', async () => {
		const ip = uniqueIp();

		// One-letter queries never reach the database, so the budget is cheap
		// to exhaust.
		for (let i = 0; i < 300; i++) {
			expect((await search({ q: 'n', ip })).status).toBe(200);
		}

		const refused = await search({ q: 'n', ip });

		expect(refused.status).toBe(429);
		expect(refused.headers.get('retry-after')).not.toBeNull();
		expect(await refused.json()).toEqual({ error: 'rate_limited' });

		expect((await search({ q: 'n', ip: uniqueIp() })).status).toBe(200);
	});
});
