// Profile write guards: daily-goal monotonicity (the Flow cap backstop),
// the handle-change cooldown with its ~now stamp requirement, and the
// grandfather clause for legacy nicknames.

import { isNullish, nonNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { DAILY_HARD_CAP } from '../src/profiles/flow';
import { MAX_NICKNAME_LENGTH, nicknameUniqueKey } from '../src/profiles/nickname';
import {
	getProfileRow,
	getProfileView,
	searchProfiles,
	shapeOwnProfile,
	shapeProfile,
	upsertMyProfile
} from '../src/profiles/profile';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile, uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const DAY_MS = 24 * 60 * 60 * 1000;

describe.if(dbAvailable)('daily-goal monotonicity', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('accepts a same-day increase and rejects a same-day decrease', async () => {
		const { userId, profile } = await createTestProfile({
			dailyGoalDone: 5,
			dailyGoalDate: '2026-08-17'
		});

		const raised = await upsertMyProfile({
			userId,
			body: { nickname: profile.nickname, dailyGoalDone: 7, dailyGoalDate: '2026-08-17' }
		});

		expect(raised.dailyGoalDone).toBe(7);

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: profile.nickname, dailyGoalDone: 3, dailyGoalDate: '2026-08-17' }
			})
		).rejects.toThrow('cannot decrease within the same day');
	});

	test('allows a reset on a genuine new day', async () => {
		const { userId, profile } = await createTestProfile({
			dailyGoalDone: 9,
			dailyGoalDate: '2026-08-17'
		});

		const next = await upsertMyProfile({
			userId,
			body: { nickname: profile.nickname, dailyGoalDone: 0, dailyGoalDate: '2026-08-18' }
		});

		expect(next.dailyGoalDone).toBe(0);
	});

	test('caps every write at the hard cap, including the first', async () => {
		const userId = await createTestUser();

		expect(
			upsertMyProfile({
				userId,
				body: {
					nickname: uniqueNickname(),
					dailyGoalDone: DAILY_HARD_CAP + 1,
					dailyGoalDate: '2026-08-17'
				}
			})
		).rejects.toThrow(`cannot exceed the daily hard cap of ${DAILY_HARD_CAP}`);
	});

	test('rejects non-integer and negative counts', async () => {
		const { userId, profile } = await createTestProfile();

		for (const dailyGoalDone of [1.5, -1]) {
			expect(
				upsertMyProfile({
					userId,
					body: { nickname: profile.nickname, dailyGoalDone, dailyGoalDate: '2026-08-17' }
				})
			).rejects.toThrow('non-negative integer');
		}
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
