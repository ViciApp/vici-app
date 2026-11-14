// Calibration claim gates (engine mocked at the actor provider boundary)
// and the league-founder award cap, including both caps under concurrent
// claims.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { clearCache } from '../src/engine/cache';
import { grantAward } from '../src/vxp/awards';
import { claimCalibrationReward, type CalibrationRewardResult } from '../src/vxp/calibration';
import {
	CALIBRATION_DAILY_CAP,
	CALIBRATION_HOURLY_CAP,
	parseVxp,
	VXP_LEAGUE_FOUNDER_MAX_AWARDS
} from '../src/vxp/constants';
import { grantLeagueFounderAward } from '../src/vxp/founder';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { readAwardRow, stubVxpLedger, type LedgerStub, type RecordedTransfer } from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreActors: (() => void) | undefined;

beforeAll(async () => {
	await ensureMigrated();
});

afterEach(() => {
	stub?.restore();
	stub = undefined;
	restoreActors?.();
	restoreActors = undefined;
	clearCache();
});

const mockEngine = ({
	engineId = 'eng_0',
	payoff = { Binary: null },
	finalised = true,
	priceValue = BigInt(1)
}: {
	engineId?: string;
	payoff?: Record<string, null>;
	finalised?: boolean;
	priceValue?: bigint;
} = {}): void => {
	const series = { engine_id: [engineId], payoff_type: payoff };
	const view = {
		status: finalised ? { Finalised: null } : { Pending: null },
		settlement: { Price: { decimal: { value: priceValue }, timestamp: [], oracle_id: [] } }
	};

	restoreActors = setEngineActorProvider({
		clearing: () =>
			Promise.resolve({
				get_settlement_status: () => Promise.resolve([view])
			} as unknown as ClearingService),
		registry: () =>
			Promise.resolve({
				get_series: () => Promise.resolve([series])
			} as unknown as RegistryService)
	});
};

/** Transfers of the calibration reward alone: the engagement grant is a
 * transfer too. */
const calibrationTransfers = (ledger: LedgerStub): RecordedTransfer[] =>
	ledger.transfers.filter((t) => t.memo?.startsWith('vxp:calibration:') === true);

/** The onboarding m1 grant doubles as the calibration engagement gate. */
const engageUser = async (userId: string): Promise<void> => {
	await grantAward({
		userId,
		awardType: 'onboarding',
		awardKey: 'm1',
		amountBaseUnits: parseVxp(1500)
	});
};

describe('calibration gates', () => {
	test('a user without the onboarding grant is not engaged yet', async () => {
		stub = stubVxpLedger();
		mockEngine();
		const userId = await createTestUser();

		const result = await claimCalibrationReward({ userId, seriesId: 's1', chosenSide: 'YES' });

		expect(result).toEqual({
			correct: false,
			paidNow: false,
			alreadyClaimed: false,
			reason: 'not_engaged_yet'
		});
	});

	test('a healthy balance is above the recovery floor: no payout', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(150)) });
		mockEngine();
		const userId = await createTestUser();

		await engageUser(userId);

		const result = await claimCalibrationReward({ userId, seriesId: 's2', chosenSide: 'YES' });

		expect(result.reason).toBe('balance_above_floor');
	});

	test('only Vici engine markets qualify', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		mockEngine({ engineId: 'eng_9' });
		const userId = await createTestUser();

		await engageUser(userId);

		const result = await claimCalibrationReward({ userId, seriesId: 's3', chosenSide: 'YES' });

		expect(result.reason).toBe('not_vici_market');
	});

	test('a correct call on a finalised binary market pays 20 VXP once', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		mockEngine({ priceValue: BigInt(1) });
		const userId = await createTestUser();

		await engageUser(userId);

		const result = await claimCalibrationReward({ userId, seriesId: 's4', chosenSide: 'YES' });

		expect(result.correct).toBe(true);
		expect(result.paidNow).toBe(true);
		expect(result.rewardBaseUnits).toBe(parseVxp(20).toString());
		expect((await readAwardRow({ userId, awardType: 'calibration', awardKey: 's4' }))?.status).toBe(
			'paid'
		);

		const again = await claimCalibrationReward({ userId, seriesId: 's4', chosenSide: 'YES' });

		expect(again.alreadyClaimed).toBe(true);
		expect(again.paidNow).toBe(false);
	});

	test('a wrong call pays nothing, writes no award and consumes no budget', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		mockEngine({ priceValue: BigInt(0) });
		const userId = await createTestUser();

		await engageUser(userId);

		const result = await claimCalibrationReward({ userId, seriesId: 's5', chosenSide: 'YES' });

		expect(result).toEqual({ correct: false, paidNow: false, alreadyClaimed: false });
		expect(
			await readAwardRow({ userId, awardType: 'calibration', awardKey: 's5' })
		).toBeUndefined();
	});

	test('the rolling hourly cap blocks a burst of correct claims', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		mockEngine();
		const userId = await createTestUser();

		await engageUser(userId);
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms)
			 select $1, 'calibration', 'burst_' || g, $2, 'paid', 1 from generate_series(1, 6) g`,
			[userId, parseVxp(20).toString()]
		);

		const result = await claimCalibrationReward({ userId, seriesId: 's6', chosenSide: 'YES' });

		expect(result.correct).toBe(true);
		expect(result.paidNow).toBe(false);
		expect(result.reason).toBe('rate_limited_hourly');
	});

	test('a wrong call locks the market: the other side then pays nothing', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		mockEngine({ priceValue: BigInt(0) });
		const userId = await createTestUser();

		await engageUser(userId);

		const wrong = await claimCalibrationReward({ userId, seriesId: 's7', chosenSide: 'YES' });

		expect(wrong).toEqual({ correct: false, paidNow: false, alreadyClaimed: false });

		const flipped = await claimCalibrationReward({ userId, seriesId: 's7', chosenSide: 'NO' });

		expect(flipped).toEqual({
			correct: false,
			paidNow: false,
			alreadyClaimed: false,
			reason: 'already_called'
		});
		expect(calibrationTransfers(stub)).toHaveLength(0);
		expect(
			await readAwardRow({ userId, awardType: 'calibration', awardKey: 's7' })
		).toBeUndefined();
	});

	test('a correct call held by a cap pays when called again on the same side', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		mockEngine();
		const userId = await createTestUser();

		await engageUser(userId);
		await seedCalibrationAwards({ userId, count: CALIBRATION_HOURLY_CAP, ageHours: 0 });

		const held = await claimCalibrationReward({ userId, seriesId: 's8', chosenSide: 'YES' });

		expect(held.reason).toBe('rate_limited_hourly');

		await query(
			`update vxp_awards set created_at = now() - interval '2 hours'
			 where user_id = $1 and award_type = 'calibration'`,
			[userId]
		);

		const retried = await claimCalibrationReward({ userId, seriesId: 's8', chosenSide: 'YES' });

		expect(retried.paidNow).toBe(true);
	});
});

/** Calibration awards already held, created ageHours ago, on keys no claim
 * in these suites uses. */
const seedCalibrationAwards = async ({
	userId,
	count,
	ageHours
}: {
	userId: string;
	count: number;
	ageHours: number;
}): Promise<void> => {
	await query(
		`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, created_at)
		 select $1, 'calibration', 'seed_' || g, $2, 'paid', 1, now() - make_interval(hours => $4::int)
		 from generate_series(1, $3::int) g`,
		[userId, parseVxp(20).toString(), count, ageHours]
	);
};

/** Claims RACERS distinct markets at once, one slot below a cap. */
const RACERS = 4;

/** A recovering balance read that holds every racer until all of them have
 * passed the earlier gates, so the claims really reach the cap together
 * instead of one finishing before the next starts. */
const racingBalance = (): (() => Promise<bigint>) => {
	let arrived = 0;
	let release: () => void = () => undefined;
	const allArrived = new Promise<void>((resolve) => {
		release = resolve;
	});

	return async () => {
		arrived += 1;

		if (arrived >= RACERS) {
			release();
		}

		await allArrived;

		return parseVxp(10);
	};
};

const raceCalibrationClaims = async (userId: string): Promise<CalibrationRewardResult[]> =>
	await Promise.all(
		Array.from(
			{ length: RACERS },
			async (_, i) =>
				await claimCalibrationReward({ userId, seriesId: `race_${i}`, chosenSide: 'YES' })
		)
	);

describe('calibration caps under concurrent claims', () => {
	test('the hourly cap pays exactly the one remaining slot', async () => {
		stub = stubVxpLedger({ balance: racingBalance() });
		mockEngine();
		const userId = await createTestUser();

		await engageUser(userId);
		await seedCalibrationAwards({ userId, count: CALIBRATION_HOURLY_CAP - 1, ageHours: 0 });

		const results = await raceCalibrationClaims(userId);

		expect(results.filter((r) => r.paidNow)).toHaveLength(1);
		expect(results.filter((r) => r.reason === 'rate_limited_hourly')).toHaveLength(RACERS - 1);
		expect(calibrationTransfers(stub)).toHaveLength(1);
	});

	test('the daily cap pays exactly the one remaining slot', async () => {
		stub = stubVxpLedger({ balance: racingBalance() });
		mockEngine();
		const userId = await createTestUser();

		await engageUser(userId);
		// Outside the hourly window, inside the daily one.
		await seedCalibrationAwards({ userId, count: CALIBRATION_DAILY_CAP - 1, ageHours: 2 });

		const results = await raceCalibrationClaims(userId);

		expect(results.filter((r) => r.paidNow)).toHaveLength(1);
		expect(results.filter((r) => r.reason === 'rate_limited_daily')).toHaveLength(RACERS - 1);
		expect(calibrationTransfers(stub)).toHaveLength(1);
	});
});

describe('league founder cap', () => {
	test('one reward per league, capped per account', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		expect(await grantLeagueFounderAward({ userId, leagueId: 'lg-a' })).toBe('paid');
		expect(await grantLeagueFounderAward({ userId, leagueId: 'lg-a' })).toBe('already');
		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(100));

		// Fill the account up to the cap; the next league pays nothing.
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms)
			 select $1, 'league_founder', 'seed_' || g, $2, 'paid', 1 from generate_series(1, $3::int) g`,
			[userId, parseVxp(100).toString(), VXP_LEAGUE_FOUNDER_MAX_AWARDS]
		);

		expect(await grantLeagueFounderAward({ userId, leagueId: 'lg-b' })).toBe('capped');
		expect(stub.transfers).toHaveLength(1);
	});

	test('concurrent creates at the cap boundary pay exactly the one remaining slot', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms)
			 select $1, 'league_founder', 'seed_' || g, $2, 'paid', 1 from generate_series(1, $3::int) g`,
			[userId, parseVxp(100).toString(), VXP_LEAGUE_FOUNDER_MAX_AWARDS - 1]
		);

		const outcomes = await Promise.all(
			Array.from(
				{ length: RACERS },
				async (_, i) => await grantLeagueFounderAward({ userId, leagueId: `lg-race-${i}` })
			)
		);

		expect(outcomes.filter((o) => o === 'paid')).toHaveLength(1);
		expect(outcomes.filter((o) => o === 'capped')).toHaveLength(RACERS - 1);
		expect(stub.transfers).toHaveLength(1);
	});
});
