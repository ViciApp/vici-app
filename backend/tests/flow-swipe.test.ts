// Server-authoritative Flow daily counter: capped increments, day rollover,
// day-key validation, and the interplay with the monotonic profile guard.

import { beforeAll, describe, expect, test } from 'bun:test';
import {
	DAILY_HARD_CAP,
	InvalidDayKeyError,
	isWellFormedDayKey,
	recordFlowSwipe
} from '../src/profiles/flow';
import { upsertMyProfile } from '../src/profiles/profile-write';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

describe('isWellFormedDayKey', () => {
	test('accepts a real calendar day', () => {
		expect(isWellFormedDayKey('2026-08-17')).toBe(true);
		expect(isWellFormedDayKey('2024-02-29')).toBe(true);
	});

	test('rejects malformed and non-round-tripping keys', () => {
		expect(isWellFormedDayKey('2026-02-31')).toBe(false);
		expect(isWellFormedDayKey('2023-02-29')).toBe(false);
		expect(isWellFormedDayKey('2026-13-01')).toBe(false);
		expect(isWellFormedDayKey('2026-8-17')).toBe(false);
		expect(isWellFormedDayKey('not-a-day')).toBe(false);
		expect(isWellFormedDayKey('')).toBe(false);
	});
});

describe.if(dbAvailable)('recordFlowSwipe', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('increments to the hard cap and stays there', async () => {
		const { userId } = await createTestProfile();
		const dayKey = '2026-08-17';

		for (let swipe = 1; swipe <= DAILY_HARD_CAP; swipe++) {
			const result = await recordFlowSwipe({ userId, dayKey });

			expect(result.dailyGoalDone).toBe(swipe);
			expect(result.dailyGoalDate).toBe(dayKey);
			expect(result.capReached).toBe(swipe >= DAILY_HARD_CAP);
		}

		// Swipes past the cap are idempotent on the count.
		const over = await recordFlowSwipe({ userId, dayKey });

		expect(over.dailyGoalDone).toBe(DAILY_HARD_CAP);
		expect(over.capReached).toBe(true);
	});

	test('a new day key starts the count fresh at 1', async () => {
		const { userId } = await createTestProfile();

		await recordFlowSwipe({ userId, dayKey: '2026-08-17' });
		await recordFlowSwipe({ userId, dayKey: '2026-08-17' });

		const next = await recordFlowSwipe({ userId, dayKey: '2026-08-18' });

		expect(next.dailyGoalDone).toBe(1);
		expect(next.dailyGoalDate).toBe('2026-08-18');
		expect(next.capReached).toBe(false);
	});

	test('rejects a malformed day key with the typed error', () => {
		expect(recordFlowSwipe({ userId: 'unused', dayKey: '2026-02-31' })).rejects.toThrow(
			InvalidDayKeyError
		);
		expect(recordFlowSwipe({ userId: 'unused', dayKey: '2026-02-31' })).rejects.toThrow(
			'well-formed'
		);
	});

	test('fails fast for a caller with no profile', async () => {
		const userId = await createTestUser();

		expect(recordFlowSwipe({ userId, dayKey: '2026-08-17' })).rejects.toThrow('has no profile');
	});

	test('a stale full-profile write cannot roll the recorded count back', async () => {
		const { userId, profile } = await createTestProfile();
		const dayKey = '2026-08-17';

		for (let swipe = 0; swipe < 4; swipe++) {
			await recordFlowSwipe({ userId, dayKey });
		}

		// A cleared client re-saving a lower same-day total is rejected, so the
		// authoritative count stands and the cap cannot be re-opened.
		expect(
			upsertMyProfile({
				userId,
				body: { nickname: profile.nickname, dailyGoalDone: 2, dailyGoalDate: dayKey }
			})
		).rejects.toThrow('cannot decrease within the same day');

		const after = await recordFlowSwipe({ userId, dayKey });

		expect(after.dailyGoalDone).toBe(5);
	});

	test('concurrent swipes never lose or double-count an increment', async () => {
		const { userId } = await createTestProfile();
		const dayKey = '2026-08-17';

		await Promise.all(Array.from({ length: 5 }, () => recordFlowSwipe({ userId, dayKey })));

		const final = await recordFlowSwipe({ userId, dayKey });

		expect(final.dailyGoalDone).toBe(6);
	});
});
