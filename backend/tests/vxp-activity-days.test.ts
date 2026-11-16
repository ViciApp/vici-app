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
import type { CallSide } from '../src/vxp/calibration';
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

	describe('contrarian judges the entry price of the side held, not the Settled price', () => {
		// A call as the engine fills it: YES is a buy at the side's price, NO a
		// sell at one minus it.
		const call = (id: number, side: CallSide, price: number, qty = 10): ClearingDid.Event =>
			event({
				id,
				eventType: { Executed: null },
				qty: side === 'YES' ? qty : -qty,
				atMs: AUG_1 + id,
				price: side === 'YES' ? price : 1 - price
			});

		// A winning settlement at its real payoff: 1 when YES resolves, 0 when NO does.
		const won = (id: number, resolved: CallSide): ClearingDid.Event =>
			settled(id, 5, resolved === 'YES' ? 1 : 0);

		const contrarianWins = (events: ClearingDid.Event[]): number =>
			engineAchievementFacts({ events, executedPredictions: 1 }).contrarianWins;

		test('a cheap entry on the side paid counts, up to the threshold, on YES and NO', () => {
			expect(contrarianWins([call(1, 'YES', 0.2), won(2, 'YES')])).toBe(1);
			expect(contrarianWins([call(1, 'NO', 0.3), won(2, 'NO')])).toBe(1);
			expect(contrarianWins([call(1, 'YES', 0.31), won(2, 'YES')])).toBe(0);
		});

		test('an expensive NO win does not count though its Settled price reads 0', () => {
			expect(contrarianWins([call(1, 'NO', 0.8), won(2, 'NO')])).toBe(0);
		});

		test('a win whose held side is not the side paid is not judged', () => {
			expect(contrarianWins([call(1, 'YES', 0.2), won(2, 'NO')])).toBe(0);
		});

		test('several fills are judged on the average cost of the contracts held', () => {
			// 10 at 20% and 10 at 50% average 35%.
			expect(contrarianWins([call(1, 'YES', 0.2), call(2, 'YES', 0.5), won(3, 'YES')])).toBe(0);
			// Selling part of a cheap position back leaves its cost as it was.
			expect(contrarianWins([call(1, 'YES', 0.2, 20), call(2, 'NO', 0.4), won(3, 'YES')])).toBe(1);
			// A cheap round trip does not discount the position held after it.
			expect(
				contrarianWins([
					call(1, 'YES', 0.1),
					call(2, 'NO', 0.9),
					call(3, 'YES', 0.9),
					won(4, 'YES')
				])
			).toBe(0);
			// Selling through a position flips it and restarts the cost at that fill.
			expect(contrarianWins([call(1, 'YES', 0.9), call(2, 'NO', 0.2, 20), won(3, 'NO')])).toBe(1);
		});

		test('a self-matched trade, free to print at any price, does not move the entry price', () => {
			const selfMatch = [call(2, 'YES', 0.01, 1000), call(2, 'NO', 0.99, 1000)];

			expect(contrarianWins([call(1, 'YES', 0.9), ...selfMatch, won(3, 'YES')])).toBe(0);
		});

		test('an Outcome settlement (the engine prices it 1 at zero decimals) is not judged', () => {
			const placeholder = won(2, 'YES');

			expect(
				contrarianWins([
					call(1, 'YES', 0.1),
					{
						...placeholder,
						price: { ...placeholder.price, decimal: { value: BigInt(1), decimals: 0 } }
					}
				])
			).toBe(0);
		});
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
