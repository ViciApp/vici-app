// The server-side facts the streak, call-count and achievement awards read:
// the recorded activity days and the streak derived from them, the executed
// fill count and fill days, and the achievement rules over engine history.

import { Principal } from '@icp-sdk/core/principal';
import { beforeAll, describe, expect, test } from 'bun:test';
import type { ClearingDid } from '../src/declarations';
import {
	activityVerifiedAchievements,
	engineAchievementFacts,
	engineVerifiedAchievements
} from '../src/vxp/achievements';
import { dailyStreakOf, listActivityDays, recordActivityDays } from '../src/vxp/activity-days';
import { executedFillDays, executedPredictionCount } from '../src/vxp/predictions';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const event = ({
	id,
	eventType,
	qty,
	atMs,
	price = 0.5
}: {
	id: number;
	eventType: ClearingDid.EventType;
	qty: number;
	atMs: number;
	price?: number;
}): ClearingDid.Event => ({
	event_id: BigInt(id),
	series_id: 'series-activity-days',
	user: Principal.anonymous(),
	clearing_id: Principal.anonymous(),
	qty: BigInt(qty),
	timestamp: BigInt(atMs) * BigInt(1_000_000),
	price: {
		timestamp: [],
		oracle_id: [],
		decimal: { value: BigInt(Math.round(price * 100)), decimals: 2 }
	},
	event_type: eventType
});

const AUG_1 = Date.UTC(2026, 7, 1, 12);

describe('dailyStreakOf', () => {
	test('counts the run of active days ending at the latest one', () => {
		expect(dailyStreakOf([])).toBe(0);
		expect(dailyStreakOf(['2026-08-01'])).toBe(1);
		expect(dailyStreakOf(['2026-08-01', '2026-08-02', '2026-08-03'])).toBe(3);
	});

	test('one fully-missed day is forgiven, two break the streak', () => {
		expect(dailyStreakOf(['2026-08-01', '2026-08-03', '2026-08-04'])).toBe(3);
		expect(dailyStreakOf(['2026-08-01', '2026-08-04', '2026-08-05'])).toBe(2);
	});

	test('a run that ended earlier does not count toward the current one', () => {
		expect(
			dailyStreakOf(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-08-01'])
		).toBe(1);
	});
});

describe('executed fills', () => {
	test('count distinct executed events with a non-zero quantity, and their UTC days', () => {
		const events = [
			event({ id: 1, eventType: { Executed: null }, qty: 10, atMs: AUG_1 }),
			// The other side of a self-matched trade: same event, counted once.
			event({ id: 1, eventType: { Executed: null }, qty: -10, atMs: AUG_1 }),
			event({ id: 2, eventType: { Executed: null }, qty: 0, atMs: AUG_1 + 86_400_000 }),
			event({ id: 3, eventType: { OrderPlaced: null }, qty: 5, atMs: AUG_1 + 86_400_000 }),
			event({ id: 4, eventType: { Executed: null }, qty: 3, atMs: AUG_1 + 2 * 86_400_000 })
		];

		expect(executedPredictionCount(events)).toBe(2);
		expect(executedFillDays(events)).toEqual(['2026-08-01', '2026-08-03']);
	});
});

describe('engine-verified achievements', () => {
	const settled = (id: number, qty: number, price = 0.5): ClearingDid.Event =>
		event({ id, eventType: { Settled: null }, qty, atMs: AUG_1 + id, price });

	test('first-call needs one executed prediction', () => {
		const facts = engineAchievementFacts({ events: [], executedPredictions: 1 });

		expect(engineVerifiedAchievements(facts)).toEqual(['first-call']);
		expect(engineVerifiedAchievements({ ...facts, executedPredictions: 0 })).toEqual([]);
	});

	test('on-fire reads the current run of wins; a later loss breaks it', () => {
		const wins = Array.from({ length: 10 }, (_, i) => settled(i + 1, 5));

		expect(engineAchievementFacts({ events: wins, executedPredictions: 1 }).currentWinStreak).toBe(
			10
		);
		expect(
			engineAchievementFacts({ events: [...wins, settled(11, -5)], executedPredictions: 1 })
				.currentWinStreak
		).toBe(0);
	});

	test('contrarian counts wins at or below the long-shot price', () => {
		const events = [
			...Array.from({ length: 9 }, (_, i) => settled(i + 1, 5, 0.3)),
			settled(10, 5, 0.31),
			settled(11, -5, 0.1)
		];

		expect(engineAchievementFacts({ events, executedPredictions: 1 }).contrarianWins).toBe(9);
	});

	test('oracle needs both the call count and the accuracy', () => {
		const events = [
			...Array.from({ length: 8 }, (_, i) => settled(i + 1, 5)),
			settled(9, -5),
			settled(10, -5)
		];

		expect(
			engineVerifiedAchievements(engineAchievementFacts({ events, executedPredictions: 50 }))
		).toContain('oracle');
		expect(
			engineVerifiedAchievements(engineAchievementFacts({ events, executedPredictions: 49 }))
		).not.toContain('oracle');
		expect(
			engineVerifiedAchievements(
				engineAchievementFacts({ events: [...events, settled(11, -5)], executedPredictions: 50 })
			)
		).not.toContain('oracle');
	});

	test('marathon and league-founder come from the streak and the rosters', () => {
		expect(activityVerifiedAchievements({ dailyStreak: 29, ownsQualifyingLeague: false })).toEqual(
			[]
		);
		expect(activityVerifiedAchievements({ dailyStreak: 30, ownsQualifyingLeague: true })).toEqual([
			'marathon',
			'league-founder'
		]);
	});
});

describe.if(dbAvailable)('recordActivityDays', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('records each day once and answers only the new ones', async () => {
		const userId = await createTestUser();

		expect(
			(await recordActivityDays({ userId, dayKeys: ['2026-08-02', '2026-08-01', '2026-08-01'] }))
				.slice()
				.sort()
		).toEqual(['2026-08-01', '2026-08-02']);
		expect(await recordActivityDays({ userId, dayKeys: ['2026-08-01', '2026-08-02'] })).toEqual([]);
		expect(await recordActivityDays({ userId, dayKeys: ['2026-08-02', '2026-08-03'] })).toEqual([
			'2026-08-03'
		]);
		expect(await listActivityDays({ userId })).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
	});
});
