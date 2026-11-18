// Profile write guards: the server-owned daily goal (the Flow cap backstop),
// the integer counters, the handle-change cooldown with its ~now stamp
// requirement, and the grandfather clause for legacy nicknames.

import { isNullish, nonNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { DAILY_HARD_CAP, recordFlowSwipe } from '../src/profiles/flow';
import { MAX_NICKNAME_LENGTH, nicknameUniqueKey } from '../src/profiles/nickname';
import {
	getProfileRow,
	getProfileView,
	ProfileValidationError,
	searchProfiles,
	shapeOwnProfile,
	shapeProfile
} from '../src/profiles/profile';
import { MAX_PROFILE_COUNTER, upsertMyProfile } from '../src/profiles/profile-write';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const DAY_MS = 24 * 60 * 60 * 1000;

describe.if(dbAvailable)('daily goal is server-owned', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('the first write stores no count, whatever the client sends', async () => {
		const { profile } = await createTestProfile({
			dailyGoalDone: DAILY_HARD_CAP,
			dailyGoalDate: '2026-08-17'
		});

		expect(profile.dailyGoalDone).toBe(0);
		expect(profile.dailyGoalDate).toBeUndefined();
	});

	test('a later write keeps the recorded count and day, whatever the client sends', async () => {
		const { userId, profile } = await createTestProfile();

		for (let swipe = 0; swipe < 3; swipe++) {
			await recordFlowSwipe({ userId, dayKey: '2026-08-17' });
		}

		const sent = [
			{ dailyGoalDone: 0, dailyGoalDate: '2026-08-18' },
			{ dailyGoalDone: 9, dailyGoalDate: '2026-08-17' },
			{ dailyGoalDone: DAILY_HARD_CAP + 1, dailyGoalDate: '2026-08-17' },
			{ dailyGoalDone: 1.5, dailyGoalDate: '2026-08-17' },
			{ dailyGoalDone: -1 }
		];

		for (const fields of sent) {
			const saved = await upsertMyProfile({
				userId,
				body: { nickname: profile.nickname, ...fields }
			});

			expect(saved.dailyGoalDone).toBe(3);
			expect(saved.dailyGoalDate).toBe('2026-08-17');
		}
	});
});

describe.if(dbAvailable)('integer counters', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a fraction, a negative or a value past the ceiling is a validation error', async () => {
		const { userId, profile } = await createTestProfile();
		const cases: Record<string, unknown>[] = [
			{ totalTrades: 1.5 },
			{ streak: -1 },
			{ level: 3_000_000_000 },
			{ comebacks: MAX_PROFILE_COUNTER + 1 },
			{ topDecileStreak: '7' }
		];

		for (const fields of cases) {
			expect(
				upsertMyProfile({ userId, body: { nickname: profile.nickname, ...fields } })
			).rejects.toBeInstanceOf(ProfileValidationError);
		}

		const accepted = await upsertMyProfile({
			userId,
			body: { nickname: profile.nickname, totalTrades: MAX_PROFILE_COUNTER, level: 4 }
		});

		expect(accepted.totalTrades).toBe(MAX_PROFILE_COUNTER);
		expect(accepted.level).toBe(4);
	});

	test('the profile route answers an out-of-range counter with a 400', async () => {
		const { userId, profile } = await createTestProfile();
		const response = await app.handle(
			new Request('http://localhost/api/v1/profiles/me', {
				method: 'PUT',
				headers: {
					cookie: `vici_session=${await createSession(userId)}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ nickname: profile.nickname, totalTrades: 2_147_483_648 })
			})
		);

		expect(response.status).toBe(400);
	});
});

describe.if(dbAvailable)('handle-change cooldown', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a handle change must stamp handleLastChangeMs to ~now', async () => {
		const { userId } = await createTestProfile();

		expect(upsertMyProfile({ userId, body: { nickname: uniqueNickname() } })).rejects.toThrow(
			'handleLastChangeMs must be set to the current time'
		);

		const renamed = uniqueNickname();
		const profile = await upsertMyProfile({
			userId,
			body: { nickname: renamed, handleLastChangeMs: Date.now() }
		});

		expect(profile.nickname).toBe(renamed);
	});

	test('a second change inside the window is rejected; after it, allowed', async () => {
		const { userId } = await createTestProfile();

		await upsertMyProfile({
			userId,
			body: { nickname: uniqueNickname(), handleLastChangeMs: Date.now() }
		});

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: uniqueNickname(), handleLastChangeMs: Date.now() }
			})
		).rejects.toThrow('changed recently');

		// Age the stored stamp past the 30-day window.
		await query(`update profiles set handle_last_change_ms = $2 where user_id = $1`, [
			userId,
			Date.now() - 31 * DAY_MS
		]);

		const renamed = uniqueNickname();
		const profile = await upsertMyProfile({
			userId,
			body: { nickname: renamed, handleLastChangeMs: Date.now() }
		});

		expect(profile.nickname).toBe(renamed);
	});

	test('the stamp is immutable while the handle is unchanged', async () => {
		const { userId, profile } = await createTestProfile();

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: profile.nickname, handleLastChangeMs: Date.now() }
			})
		).rejects.toThrow('cannot change unless the handle changes');
	});

	test('re-casing the own handle is not a change', async () => {
		const { userId, profile } = await createTestProfile();
		const recased = profile.nickname.toUpperCase();

		const updated = await upsertMyProfile({ userId, body: { nickname: recased } });

		expect(updated.nickname).toBe(recased);
		expect(updated.handleLastChangeMs).toBeUndefined();
	});

	test('a backdated or future stamp on an allowed change is rejected', async () => {
		const { userId } = await createTestProfile();

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: uniqueNickname(), handleLastChangeMs: Date.now() - DAY_MS }
			})
		).rejects.toThrow('handleLastChangeMs must be set to the current time');

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: uniqueNickname(), handleLastChangeMs: Date.now() + DAY_MS }
			})
		).rejects.toThrow('handleLastChangeMs must be set to the current time');
	});
});

describe.if(dbAvailable)('legacy nickname grandfathering', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const seedLegacyProfile = async (nickname: string): Promise<string> => {
		const userId = await createTestUser();

		// Legacy imports can carry nicknames that predate the charset rule; a
		// direct row insert mirrors that state.
		await query(`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, $3)`, [
			userId,
			nickname,
			nicknameUniqueKey(nickname)
		]);

		return userId;
	};

	test('an unchanged invalid legacy nickname does not block unrelated edits', async () => {
		const legacyNickname = `bad name ${uniqueNickname()}`;
		const userId = await seedLegacyProfile(legacyNickname);

		const profile = await upsertMyProfile({
			userId,
			body: { nickname: legacyNickname, avatar: 'new-avatar' }
		});

		expect(profile.nickname).toBe(legacyNickname);
		expect(profile.avatar).toBe('new-avatar');
	});

	test('actually changing to an invalid handle is rejected', async () => {
		const userId = await seedLegacyProfile(`bad name ${uniqueNickname()}`);

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: 'still bad', handleLastChangeMs: Date.now() }
			})
		).rejects.toThrow('contains invalid characters');
	});

	test('an unchanged over-length legacy nickname does not block unrelated edits', async () => {
		const legacyNickname = uniqueNickname().padEnd(MAX_NICKNAME_LENGTH + 4, 'a');
		const userId = await seedLegacyProfile(legacyNickname);

		const profile = await upsertMyProfile({
			userId,
			body: { nickname: legacyNickname, avatar: 'new-avatar' }
		});

		expect(profile.nickname).toBe(legacyNickname);
		expect(profile.avatar).toBe('new-avatar');
	});

	test('setting a new over-length handle is rejected', async () => {
		const { userId } = await createTestProfile();

		expect(
			upsertMyProfile({
				userId,
				body: {
					nickname: uniqueNickname().padEnd(MAX_NICKNAME_LENGTH + 1, 'a'),
					handleLastChangeMs: Date.now()
				}
			})
		).rejects.toThrow(`at most ${MAX_NICKNAME_LENGTH} characters`);
	});
});

describe.if(dbAvailable)('email privacy split', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('public shapes carry no email; owner surfaces do', async () => {
		const { userId, profile } = await createTestProfile();

		await upsertMyProfile({
			userId,
			body: { nickname: profile.nickname, email: 'own@vici.invalid' }
		});

		const row = await getProfileRow({ userId });

		if (isNullish(row)) {
			throw new Error('profile row missing');
		}

		expect(shapeOwnProfile(row).email).toBe('own@vici.invalid');
		expect('email' in shapeProfile(row)).toBeFalse();

		const viewOther = await getProfileView({ userId, callerId: crypto.randomUUID() });
		const viewSelf = await getProfileView({ userId, callerId: userId });

		expect(nonNullish(viewOther) && 'email' in viewOther).toBeFalse();
		expect(nonNullish(viewSelf) && 'email' in viewSelf).toBeTrue();

		for (const item of await searchProfiles(userId)) {
			expect('email' in item).toBeFalse();
		}
	});
});

describe.if(dbAvailable)('preferences on write', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('are stored in the read shape: a non-boolean flag falls back, unknown keys drop', async () => {
		const { userId, profile } = await createTestProfile();

		await upsertMyProfile({
			userId,
			body: {
				nickname: profile.nickname,
				preferences: {
					sharing: { worldsOptIn: 'x', leaderboardOptIn: false },
					notify: { weeklyDigest: 2 },
					unknownKey: 'kept nowhere'
				}
			}
		});

		const [stored] = await query<{ preferences: Record<string, unknown> }>(
			`select preferences from profiles where user_id = $1`,
			[userId]
		);

		expect(stored?.preferences).toMatchObject({
			sharing: { worldsOptIn: true, leaderboardOptIn: false },
			notify: { weeklyDigest: true }
		});
		expect(stored?.preferences).not.toHaveProperty('unknownKey');
	});
});

describe.if(dbAvailable)('server-set school status', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a client write cannot set schoolStatus on a new profile', async () => {
		const { profile } = await createTestProfile({ schoolStatus: 'verified' });

		expect(profile.schoolStatus).toBeUndefined();
	});

	test('a client write keeps the stored schoolStatus', async () => {
		const { userId, profile } = await createTestProfile();

		await query(`update profiles set school_status = 'verified' where user_id = $1`, [userId]);

		const cleared = await upsertMyProfile({ userId, body: { nickname: profile.nickname } });

		expect(cleared.schoolStatus).toBe('verified');

		const forged = await upsertMyProfile({
			userId,
			body: { nickname: profile.nickname, schoolStatus: 'pending' }
		});

		expect(forged.schoolStatus).toBe('verified');
	});
});
