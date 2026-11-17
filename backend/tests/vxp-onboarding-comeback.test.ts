// Onboarding registration grant and the comeback restore: the one-time
// 1,500 VXP starter, the absence-gap math, the balance-floor gate and the
// once-ever restore bound.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { daysBetween } from '../src/lib/time';
import { runComebackRestoreTrigger } from '../src/vxp/comeback';
import { parseVxp } from '../src/vxp/constants';
import { runOnboardingProfileTrigger } from '../src/vxp/onboarding';
import { createTestUser, ensureMigrated } from './helpers/auth';
import {
	accountStateWithEquity,
	readAwardRow,
	stubVxpLedger,
	type LedgerStub
} from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreEngine: (() => void) | undefined;
let depositedEquity = BigInt(0);

beforeAll(async () => {
	await ensureMigrated();
});

beforeEach(() => {
	depositedEquity = BigInt(0);
	restoreEngine = setEngineActorProvider({
		clearing: () =>
			Promise.resolve({
				get_account_state: () => Promise.resolve(accountStateWithEquity(depositedEquity))
			} as unknown as ClearingService),
		registry: () => Promise.resolve({} as unknown as RegistryService)
	});
});

afterEach(() => {
	stub?.restore();
	stub = undefined;
	restoreEngine?.();
	restoreEngine = undefined;
});

describe('onboarding registration grant', () => {
	test('m1 pays the full 1,500 VXP starter once; every later write collides', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		await runOnboardingProfileTrigger({ userId });
		await runOnboardingProfileTrigger({ userId });

		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(1500));
		expect(stub.transfers[0]?.memo).toBe('vxp:new-user:m1');

		const row = await readAwardRow({ userId, awardType: 'onboarding', awardKey: 'm1' });

		expect(row?.status).toBe('paid');
	});
});

describe('absence-gap math', () => {
	test('whole days between day keys, undefined for negative or malformed spans', () => {
		expect(daysBetween({ fromDay: '2026-08-01', toDay: '2026-08-08' })).toBe(7);
		expect(daysBetween({ fromDay: '2026-08-01', toDay: '2026-08-02' })).toBe(1);
		expect(daysBetween({ fromDay: '2026-08-08', toDay: '2026-08-01' })).toBeUndefined();
		expect(daysBetween({ fromDay: 'not-a-day', toDay: '2026-08-01' })).toBeUndefined();
	});
});

describe('comeback restore', () => {
	test('a returning depleted user is topped up to the target, once ever', async () => {
		// 40 VXP on the ledger: below the 100 VXP floor, so the restore tops up
		// the 210 VXP difference to the 250 target.
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(40)) });
		const userId = await createTestUser();

		await runComebackRestoreTrigger({
			userId,
			previousActiveDay: '2026-08-01',
			activeDay: '2026-08-10'
		});

		expect(stub.transfers).toHaveLength(1);
		expect(stub.transfers[0]?.amount).toBe(parseVxp(210));

		const row = await readAwardRow({ userId, awardType: 'comeback', awardKey: 'restore' });

		expect(row?.status).toBe('paid');
		expect(row?.amount_base_units).toBe(parseVxp(210).toString());

		// A later qualifying return must not restore again.
		await runComebackRestoreTrigger({
			userId,
			previousActiveDay: '2026-09-01',
			activeDay: '2026-09-20'
		});

		expect(stub.transfers).toHaveLength(1);
	});

	test('a short absence or a healthy balance grants nothing', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(40)) });
		const shortGapUser = await createTestUser();

		await runComebackRestoreTrigger({
			userId: shortGapUser,
			previousActiveDay: '2026-08-01',
			activeDay: '2026-08-05'
		});

		expect(stub.transfers).toHaveLength(0);

		stub.restore();

		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(500)) });
		const healthyUser = await createTestUser();

		await runComebackRestoreTrigger({
			userId: healthyUser,
			previousActiveDay: '2026-08-01',
			activeDay: '2026-08-20'
		});

		expect(stub.transfers).toHaveLength(0);
	});

	test('VXP deposited in clearing counts toward the floor and the top-up', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(0)) });
		depositedEquity = parseVxp(5000);
		const funded = await createTestUser();

		await runComebackRestoreTrigger({
			userId: funded,
			previousActiveDay: '2026-08-01',
			activeDay: '2026-08-20'
		});

		expect(stub.transfers).toHaveLength(0);

		// 10 VXP in the wallet and 30 deposited: 40 held, topped up by 210.
		stub.restore();
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(10)) });
		depositedEquity = parseVxp(30);
		const depleted = await createTestUser();

		await runComebackRestoreTrigger({
			userId: depleted,
			previousActiveDay: '2026-08-01',
			activeDay: '2026-08-20'
		});

		expect(stub.transfers.map(({ amount }) => amount)).toEqual([parseVxp(210)]);
	});

	test('a first-ever active day can never be a return', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(0)) });
		const userId = await createTestUser();

		await runComebackRestoreTrigger({
			userId,
			previousActiveDay: undefined,
			activeDay: '2026-08-10'
		});

		expect(stub.transfers).toHaveLength(0);
	});
});
