// Profile write guards: the server-owned daily goal (the Flow cap backstop),
// the integer counters, the bounds of the ranked stats, the handle-change
// cooldown with its ~now stamp requirement, the handle rule with its
// lookalike and reserved checks, and the grandfather clause for handles that
// predate the rule.

import { isNullish, nonNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { DAILY_HARD_CAP, recordFlowSwipe } from '../src/profiles/flow';
import { MAX_HANDLE_LENGTH, nicknameUniqueKey } from '../src/profiles/nickname';
import {
	getProfileRow,
	getProfileView,
	ProfileValidationError,
	searchProfiles,
	shapeOwnProfile,
	shapeProfile
} from '../src/profiles/profile';
import {
	MAX_PROFILE_COUNTER,
	MAX_PROFILE_POINTS,
	upsertMyProfile
} from '../src/profiles/profile-write';
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

describe.if(dbAvailable)('ranked stats', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('points past the ceiling, a fraction or a negative is a validation error', async () => {
		const { userId, profile } = await createTestProfile();
		const cases: Record<string, unknown>[] = [
			{ points: Number.MAX_VALUE },
			{ points: MAX_PROFILE_POINTS + 1 },
			{ points: 10.5 },
			{ points: -1 },
			{ winRate: 101 },
			{ winRate: -0.1 },
			{ accuracy: 1e9 },
			{ accuracy: -5 }
		];

		for (const fields of cases) {
			expect(
				upsertMyProfile({ userId, body: { nickname: profile.nickname, ...fields } })
			).rejects.toBeInstanceOf(ProfileValidationError);
		}

		const accepted = await upsertMyProfile({
			userId,
			body: {
				nickname: profile.nickname,
				points: MAX_PROFILE_POINTS,
				winRate: 100,
				accuracy: 62.5
			}
		});

		expect(accepted.points).toBe(MAX_PROFILE_POINTS);
		expect(accepted.winRate).toBe(100);
		expect(accepted.accuracy).toBe(62.5);
	});

	test('a rejected points figure never reaches the leaderboard order', async () => {
		const { userId, profile } = await createTestProfile();
		const response = await app.handle(
			new Request('http://localhost/api/v1/profiles/me', {
				method: 'PUT',
				headers: {
					cookie: `vici_session=${await createSession(userId)}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ nickname: profile.nickname, points: 1e300 })
			})
		);

		expect(response.status).toBe(400);

		const [row] = await query<{ points: number }>(
			`select points from profiles where user_id = $1`,
			[userId]
		);

		expect(row?.points).toBe(0);
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

	test('re-casing the own handle into an uppercase form is refused', async () => {
		const { userId, profile } = await createTestProfile();

		expect(
			upsertMyProfile({ userId, body: { nickname: profile.nickname.toUpperCase() } })
		).rejects.toThrow('lowercase letters and numbers only');
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

describe.if(dbAvailable)('handle rule on write', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	// Handles that predate the rule: a direct row insert mirrors that state.
	// The trigger fills handle_key, as it does for a row an old release writes.
	const seedLegacyProfile = async (nickname: string): Promise<string> => {
		const userId = await createTestUser();

		await query(`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, $3)`, [
			userId,
			nickname,
			nicknameUniqueKey(nickname)
		]);

		return userId;
	};

	test('a new handle outside the rule is refused', async () => {
		const { userId } = await createTestProfile();
		const base = uniqueNickname();

		for (const [nickname, message] of [
			[`${base}A`, 'lowercase letters and numbers only'],
			[`${base}é`, 'lowercase letters and numbers only'],
			[`${base.slice(0, 5)}.${base.slice(5)}`, 'lowercase letters and numbers only'],
			[`${base.slice(0, 5)}_${base.slice(5)}`, 'lowercase letters and numbers only'],
			[`${base.slice(0, 5)}-${base.slice(5)}`, 'lowercase letters and numbers only'],
			['ab', 'at least 3 characters'],
			[base.padEnd(MAX_HANDLE_LENGTH + 1, 'a'), `at most ${MAX_HANDLE_LENGTH} characters`]
		] as const) {
			expect(
				upsertMyProfile({ userId, body: { nickname, handleLastChangeMs: Date.now() } })
			).rejects.toThrow(message);
		}
	});

	test('a lookalike of a stored handle is taken', async () => {
		const base = uniqueNickname();
		const head = base.slice(0, 5);
		const tail = base.slice(5);

		for (const stored of [
			`${head}.${tail}`,
			`${head.toUpperCase()}_${tail}`,
			`${base}`.replace('n', 'ñ')
		]) {
			const owner = await seedLegacyProfile(stored);
			const { userId } = await createTestProfile();

			expect(
				upsertMyProfile({
					userId,
					body: { nickname: base, handleLastChangeMs: Date.now() }
				})
			).rejects.toThrow('already taken');

			await query(`delete from profiles where user_id = $1`, [owner]);
		}
	});

	test('a reserved handle is refused, whoever asks', async () => {
		const { userId } = await createTestProfile();

		for (const nickname of ['admin', 'vici', 'oracle']) {
			expect(
				upsertMyProfile({ userId, body: { nickname, handleLastChangeMs: Date.now() } })
			).rejects.toThrow('reserved');
		}
	});

	test('the route answers a reserved handle with a 400', async () => {
		const { userId } = await createTestProfile();
		const res = await app.handle(
			new Request('http://localhost/api/v1/profiles/me', {
				method: 'PUT',
				headers: {
					cookie: `vici_session=${await createSession(userId)}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ nickname: 'admin', handleLastChangeMs: Date.now() })
			})
		);

		expect(res.status).toBe(400);
	});

	test('an untouched handle outside the rule keeps saving', async () => {
		for (const legacyNickname of [
			`bad name ${uniqueNickname()}`,
			`José.${uniqueNickname()}`,
			uniqueNickname().padEnd(MAX_HANDLE_LENGTH + 4, 'a')
		]) {
			const userId = await seedLegacyProfile(legacyNickname);

			const profile = await upsertMyProfile({
				userId,
				body: { nickname: legacyNickname, avatar: 'new-avatar' }
			});

			expect(profile.nickname).toBe(legacyNickname);
			expect(profile.avatar).toBe('new-avatar');
		}
	});

	test('changing a handle outside the rule to another one outside it is refused', async () => {
		const userId = await seedLegacyProfile(`bad name ${uniqueNickname()}`);

		expect(
			upsertMyProfile({
				userId,
				body: { nickname: 'still bad', handleLastChangeMs: Date.now() }
			})
		).rejects.toThrow('lowercase letters and numbers only');
	});

	test('tidying the own handle to the rule is free inside the window', async () => {
		const base = uniqueNickname();
		const stored = `${base.slice(0, 5).toUpperCase()}.${base.slice(5)}`;
		const userId = await seedLegacyProfile(stored);
		const stampMs = Date.now() - DAY_MS;

		await query(`update profiles set handle_last_change_ms = $2 where user_id = $1`, [
			userId,
			stampMs
		]);

		const profile = await upsertMyProfile({
			userId,
			body: { nickname: base, handleLastChangeMs: stampMs }
		});

		expect(profile.nickname).toBe(base);
		expect(profile.handleLastChangeMs).toBe(stampMs);

		const rows = await query<{ handle_key: string; nickname_key: string }>(
			`select handle_key, nickname_key from profiles where user_id = $1`,
			[userId]
		);

		expect(rows[0]).toEqual({ handle_key: base, nickname_key: base });
	});

	test('a write of the previous release cannot add a lookalike', async () => {
		const handle = uniqueNickname();
		await createTestProfile({ nickname: handle });
		const dotted = `${handle.slice(0, 5)}.${handle.slice(5)}`;

		// The previous release writes nickname and nickname_key only.
		const userId = await createTestUser();

		expect(
			query(`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, $3)`, [
				userId,
				dotted,
				nicknameUniqueKey(dotted)
			])
		).rejects.toMatchObject({ code: '23505' });

		const { userId: renamer, profile } = await createTestProfile();

		expect(
			query(`update profiles set nickname = $2, nickname_key = $3 where user_id = $1`, [
				renamer,
				dotted,
				nicknameUniqueKey(dotted)
			])
		).rejects.toMatchObject({ code: '23505' });

		// Re-saving an untouched profile is no claim.
		await query(
			`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, $3)
			 on conflict (user_id) do update set avatar = 'resaved'`,
			[renamer, profile.nickname, nicknameUniqueKey(profile.nickname)]
		);
	});

	test('untouched lookalikes that predate the rule keep saving', async () => {
		const handle = uniqueNickname();
		const dotted = `${handle.slice(0, 5)}.${handle.slice(5)}`;
		const first = await seedLegacyProfile(dotted);
		const second = await createTestUser();

		// The import's duplicate: no reserved handle.
		await query(`insert into profiles (user_id, nickname, nickname_key) values ($1, $2, '')`, [
			second,
			handle
		]);

		for (const [userId, nickname] of [
			[first, dotted],
			[second, handle]
		] as const) {
			const saved = await upsertMyProfile({ userId, body: { nickname, avatar: 'resaved' } });

			expect(saved.avatar).toBe('resaved');
		}
	});

	test('two writers of the same new handle: one wins, the other is taken', async () => {
		const handle = uniqueNickname();
		const writers = await Promise.all([createTestProfile(), createTestProfile()]);

		const results = await Promise.allSettled(
			writers.map(({ userId }) =>
				upsertMyProfile({ userId, body: { nickname: handle, handleLastChangeMs: Date.now() } })
			)
		);

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
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
