// The add-friend lookup by typed handle: an exact handle first, otherwise a
// lookalike on the handle key, deterministic when lookalikes that predate the
// rule share one key, and blind to hidden accounts.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { nicknameUniqueKey } from '../src/profiles/nickname';
import { getProfileByHandle } from '../src/profiles/profile';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

// A handle that predates the rule, as an import leaves it; the trigger fills
// handle_key.
const seedLegacyProfile = async (nickname: string): Promise<string> => {
	const userId = await createTestUser();

	await query(`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, $3)`, [
		userId,
		nickname,
		nicknameUniqueKey(nickname)
	]);

	return userId;
};

const dotted = (handle: string): string => `${handle.slice(0, 5)}.${handle.slice(5)}`;

describe.if(dbAvailable)('getProfileByHandle', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a handle within the rule finds a stored lookalike', async () => {
		const handle = uniqueNickname();
		const userId = await seedLegacyProfile(dotted(handle));

		expect((await getProfileByHandle(handle))?.userId).toBe(userId);
		expect((await getProfileByHandle(`@${handle.toUpperCase()}`))?.userId).toBe(userId);
	});

	test('a typed lookalike finds the handle within the rule', async () => {
		const { userId, profile } = await createTestProfile();

		expect((await getProfileByHandle(dotted(profile.nickname)))?.userId).toBe(userId);
		expect((await getProfileByHandle(profile.nickname))?.userId).toBe(userId);
	});

	test('two stored lookalikes resolve the same way on every call', async () => {
		const handle = uniqueNickname();
		await seedLegacyProfile(dotted(handle));
		const compliant = await seedLegacyProfile(handle);

		for (let i = 0; i < 3; i++) {
			expect((await getProfileByHandle(`${handle.slice(0, 3)}_${handle.slice(3)}`))?.userId).toBe(
				compliant
			);
		}
	});

	test('the exact stored handle wins over a lookalike', async () => {
		const handle = uniqueNickname();
		const dottedOwner = await seedLegacyProfile(dotted(handle));
		await seedLegacyProfile(handle);

		expect((await getProfileByHandle(dotted(handle)))?.userId).toBe(dottedOwner);
	});

	test('hidden accounts stay hidden', async () => {
		const { userId, profile } = await createTestProfile();

		await query(`update profiles set hibernated_at_ms = $2 where user_id = $1`, [
			userId,
			Date.now()
		]);

		expect(await getProfileByHandle(profile.nickname)).toBeUndefined();
	});

	test('text that folds to no key finds nothing', async () => {
		expect(await getProfileByHandle('...')).toBeUndefined();
		expect(await getProfileByHandle('')).toBeUndefined();
	});
});

describe.if(dbAvailable)('GET /api/v1/profiles/by-handle', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const lookup = async (handle: string, userId?: string): Promise<Response> =>
		await app.handle(
			new Request(
				`http://localhost/api/v1/profiles/by-handle?${new URLSearchParams({ handle }).toString()}`,
				isNullish(userId)
					? undefined
					: { headers: { cookie: `vici_session=${await createSession(userId)}` } }
			)
		);

	test('answers the profile to a signed-in caller', async () => {
		const { userId: caller } = await createTestProfile();
		const { userId, profile } = await createTestProfile();

		const res = await lookup(dotted(profile.nickname), caller);

		expect(res.status).toBe(200);
		expect(((await res.json()) as { profile: { userId: string } }).profile.userId).toBe(userId);
	});

	test('answers 404 for nothing, 401 to a signed-out caller', async () => {
		const { userId: caller } = await createTestProfile();

		expect((await lookup(uniqueNickname(), caller)).status).toBe(404);
		expect((await lookup('...', caller)).status).toBe(404);
		expect((await lookup(uniqueNickname())).status).toBe(401);
	});
});
