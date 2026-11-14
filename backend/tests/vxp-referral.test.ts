// Referral payout semantics: the diminishing referrer curve, the
// first-prediction settlement gate (engine fills, never posted activities),
// both-sides idempotent settlement, redemption-order tier determinism, the
// trade-activity trigger composition, and the settle endpoint's caller
// scoping.

import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { hardDeleteAccount } from '../src/account/lifecycle';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import type { ClearingDid, ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { app } from '../src/index';
import { userIcPrincipalText } from '../src/lib/keys';
import { createActivity } from '../src/social/activities';
import { parseVxp, referrerRewardBaseUnits } from '../src/vxp/constants';
import { countExecutedPredictions } from '../src/vxp/predictions';
import { recordReferralRedemption, settleReferralPayout } from '../src/vxp/referral';
import { runTradeActivityTriggers } from '../src/vxp/triggers';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { readAwardRow, stubVxpLedger, type LedgerStub } from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreEngine: (() => void) | undefined;

// The fake engine's per-principal trade history: what `get_trade_history`
// answers for the caller's custodial identity.
const fills = new Map<string, ClearingDid.Event[]>();
let nextEventId = 1;

beforeAll(async () => {
	await ensureMigrated();
});

beforeEach(() => {
	restoreEngine = setEngineActorProvider({
		clearing: (identity) => {
			const history = fills.get(identity.getPrincipal().toText()) ?? [];

			return Promise.resolve({
				get_trade_history: () => Promise.resolve(history)
			} as unknown as ClearingService);
		},
		registry: () => Promise.resolve({} as unknown as RegistryService)
	});
});

afterEach(() => {
	stub?.restore();
	stub = undefined;
	restoreEngine?.();
	restoreEngine = undefined;
});

const engineEvent = ({
	userId,
	eventType,
	qty
}: {
	userId: string;
	eventType: ClearingDid.EventType;
	qty: bigint;
}): void => {
	const owner = userIcPrincipalText(userId);
	const event: ClearingDid.Event = {
		event_id: BigInt(nextEventId),
		series_id: 'series-referral-test',
		user: Principal.fromText(owner),
		clearing_id: Principal.anonymous(),
		qty,
		timestamp: BigInt(Date.now()) * BigInt(1_000_000),
		price: { timestamp: [], oracle_id: [], decimal: { value: BigInt(50), decimals: 2 } },
		event_type: eventType
	};

	nextEventId += 1;
	fills.set(owner, [...(fills.get(owner) ?? []), event]);
};

/** A real prediction: the engine records an executed fill for the user's
 * custodial principal, then the client posts its trade activity. */
const recordTrade = async (userId: string): Promise<void> => {
	engineEvent({ userId, eventType: { Executed: null }, qty: BigInt(10) });
	await createActivity({
		userId,
		type: 'trade',
		title: 'Prediction placed',
		timestamp: Date.now()
	});
};

/** A trade activity posted through the API with no fill behind it. */
const postTradeActivity = async ({
	token,
	timestamp
}: {
	token: string;
	timestamp: number;
}): Promise<Response> =>
	await app.handle(
		new Request('http://localhost/api/v1/social/activities', {
			method: 'POST',
			headers: { cookie: `vici_session=${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'trade', title: 'Predicted 10 on YES @ 50%', timestamp })
		})
	);

describe('referrer reward curve', () => {
	test('the tier table pays 500 / 250 / 100 / 50 and zero past the cap', () => {
		expect(referrerRewardBaseUnits(0)).toBe(parseVxp(500));
		expect(referrerRewardBaseUnits(4)).toBe(parseVxp(500));
		expect(referrerRewardBaseUnits(5)).toBe(parseVxp(250));
		expect(referrerRewardBaseUnits(9)).toBe(parseVxp(250));
		expect(referrerRewardBaseUnits(10)).toBe(parseVxp(100));
		expect(referrerRewardBaseUnits(19)).toBe(parseVxp(100));
		expect(referrerRewardBaseUnits(20)).toBe(parseVxp(50));
		expect(referrerRewardBaseUnits(999)).toBe(parseVxp(50));
		expect(referrerRewardBaseUnits(1000)).toBe(BigInt(0));
	});
});

describe('settlement gates', () => {
	test('no referral row settles nothing', async () => {
		stub = stubVxpLedger();
		const userId = await createTestUser();

		expect(await settleReferralPayout({ refereeUserId: userId })).toEqual({
			settled: false,
			reason: 'no_referral'
		});
	});

	test('a redemption alone never pays: the referee must trade first', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0001'
		});

		expect(await settleReferralPayout({ refereeUserId: referee })).toEqual({
			settled: false,
			reason: 'not_traded_yet'
		});
		expect(stub.transfers).toHaveLength(0);
	});

	test('posted trade activities without an engine fill never settle the referral', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();
		const token = await createSession(referee);

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0FAK'
		});

		const base = Date.now();

		for (let i = 0; i < 5; i++) {
			expect((await postTradeActivity({ token, timestamp: base + i })).status).toBe(201);
		}

		expect(await settleReferralPayout({ refereeUserId: referee })).toEqual({
			settled: false,
			reason: 'not_traded_yet'
		});
		expect(
			await readAwardRow({ userId: referee, awardType: 'referral', awardKey: referee })
		).toBeUndefined();
		expect(
			await readAwardRow({ userId: referrer, awardType: 'referral', awardKey: referee })
		).toBeUndefined();
		expect(stub.transfers).toHaveLength(0);
	});

	test('order placements, settlements and empty fills are not predictions', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0NOF'
		});
		engineEvent({ userId: referee, eventType: { OrderPlaced: null }, qty: BigInt(10) });
		engineEvent({ userId: referee, eventType: { Settled: null }, qty: BigInt(10) });
		engineEvent({ userId: referee, eventType: { Executed: null }, qty: BigInt(0) });

		expect(await settleReferralPayout({ refereeUserId: referee })).toEqual({
			settled: false,
			reason: 'not_traded_yet'
		});
		expect(stub.transfers).toHaveLength(0);
	});
});

describe('prediction count (onboarding call-count milestones)', () => {
	test('counts executed fills on either side, not posted trade activities', async () => {
		const userId = await createTestUser();
		const token = await createSession(userId);
		const base = Date.now();

		for (let i = 0; i < 5; i++) {
			expect((await postTradeActivity({ token, timestamp: base + i })).status).toBe(201);
		}

		expect(await countExecutedPredictions({ userId })).toBe(0);

		engineEvent({ userId, eventType: { Executed: null }, qty: BigInt(10) });
		engineEvent({ userId, eventType: { Executed: null }, qty: BigInt(-4) });

		expect(await countExecutedPredictions({ userId })).toBe(2);
	});
});

describe('both-sides settlement', () => {
	test('the first prediction settles the flat referee bonus and the tier-1 referrer reward, idempotently', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0002'
		});
		await recordTrade(referee);

		expect(await settleReferralPayout({ refereeUserId: referee })).toEqual({ settled: true });

		const refereeAward = await readAwardRow({
			userId: referee,
			awardType: 'referral',
			awardKey: referee
		});
		const referrerAward = await readAwardRow({
			userId: referrer,
			awardType: 'referral',
			awardKey: referee
		});

		expect(refereeAward?.status).toBe('paid');
		expect(refereeAward?.amount_base_units).toBe(parseVxp(500).toString());
		expect(referrerAward?.status).toBe('paid');
		expect(referrerAward?.amount_base_units).toBe(parseVxp(500).toString());
		expect(stub.transfers).toHaveLength(2);

		// A retried settlement collides on both award keys.
		expect(await settleReferralPayout({ refereeUserId: referee })).toEqual({ settled: true });
		expect(stub.transfers).toHaveLength(2);
	});

	test('tiers follow redemption order even when settlements run out of order', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referees: string[] = [];

		for (let i = 0; i < 6; i++) {
			const referee = await createTestUser();

			referees.push(referee);
			await recordReferralRedemption({
				refereeUserId: referee,
				referrerUserId: referrer,
				code: 'CODE0005',
				redeemedAtMs: 2000 + i
			});
			await recordTrade(referee);
		}

		// Settle newest-first, the reverse of redemption order: the sixth
		// redemption must still land in tier 2 even though nothing else has
		// settled yet.
		for (const referee of [...referees].reverse()) {
			await settleReferralPayout({ refereeUserId: referee });
		}

		const amounts: (string | undefined)[] = [];

		for (const referee of referees) {
			amounts.push(
				(await readAwardRow({ userId: referrer, awardType: 'referral', awardKey: referee }))
					?.amount_base_units
			);
		}

		expect(amounts).toEqual([
			parseVxp(500).toString(),
			parseVxp(500).toString(),
			parseVxp(500).toString(),
			parseVxp(500).toString(),
			parseVxp(500).toString(),
			parseVxp(250).toString()
		]);
	});

	test('the referrer curve steps down with prior credited redemptions', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();

		// Five credited redemptions exhaust tier 1; the sixth pays 250.
		for (let i = 0; i < 6; i++) {
			const referee = await createTestUser();

			await recordReferralRedemption({
				refereeUserId: referee,
				referrerUserId: referrer,
				code: 'CODE0003',
				redeemedAtMs: 1000 + i
			});
			await recordTrade(referee);
			await settleReferralPayout({ refereeUserId: referee });
		}

		const referrerTransfers = stub.transfers.filter(
			({ owner }) => owner === userIcPrincipalText(referrer)
		);

		expect(referrerTransfers.map(({ amount }) => amount)).toEqual([
			parseVxp(500),
			parseVxp(500),
			parseVxp(500),
			parseVxp(500),
			parseVxp(500),
			parseVxp(250)
		]);
	});
});

describe('same-millisecond referrer awards', () => {
	afterEach(() => {
		setSystemTime();
	});

	test('two same-amount referrer awards stamped in one millisecond are two transfers', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referees = [await createTestUser(), await createTestUser()];

		for (const [i, referee] of referees.entries()) {
			await recordReferralRedemption({
				refereeUserId: referee,
				referrerUserId: referrer,
				code: 'CODE0MS1',
				redeemedAtMs: 3000 + i
			});
			await recordTrade(referee);
		}

		// Both settlements stamp their transfers in the same millisecond.
		setSystemTime(new Date(Date.now()));

		for (const referee of referees) {
			await settleReferralPayout({ refereeUserId: referee });
		}

		const referrerLanded = stub.landed.filter(
			({ owner }) => owner === userIcPrincipalText(referrer)
		);

		expect(referrerLanded.map(({ amount }) => amount)).toEqual([parseVxp(500), parseVxp(500)]);

		const blocks: (string | null | undefined)[] = [];

		for (const referee of referees) {
			const row = await readAwardRow({
				userId: referrer,
				awardType: 'referral',
				awardKey: referee
			});

			expect(row?.status).toBe('paid');

			blocks.push(row?.block_index);
		}

		expect(new Set(blocks).size).toBe(2);
		expect(blocks.sort()).toEqual(
			referrerLanded.map(({ blockIndex }) => blockIndex.toString()).sort()
		);
	});
});

const settleRequest = ({ token, body }: { token: string; body?: object }): Request =>
	new Request('http://localhost/api/v1/vxp/referral/settle', {
		method: 'POST',
		headers: { cookie: `vici_session=${token}`, 'content-type': 'application/json' },
		body: JSON.stringify(body ?? {})
	});

describe('settle endpoint scoping', () => {
	test('a non-admin may only settle their own referee row', async () => {
		stub = stubVxpLedger();
		const caller = await createTestUser();
		const other = await createTestUser();
		const token = await createSession(caller);

		const rejected = await app.handle(settleRequest({ token, body: { refereeUserId: other } }));

		expect(rejected.status).toBe(403);
		expect(await rejected.json()).toEqual({ error: 'forbidden' });

		const defaulted = await app.handle(settleRequest({ token }));

		expect(defaulted.status).toBe(200);
		expect(await defaulted.json()).toEqual({ settled: false, reason: 'no_referral' });

		const explicitSelf = await app.handle(
			settleRequest({ token, body: { refereeUserId: caller } })
		);

		expect(explicitSelf.status).toBe(200);
	});

	test('an admin may target any referee row', async () => {
		stub = stubVxpLedger();
		const adminToken = await createSession(await createTestUser('admin'));
		const other = await createTestUser();

		const res = await app.handle(
			settleRequest({ token: adminToken, body: { refereeUserId: other } })
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ settled: false, reason: 'no_referral' });
	});
});

describe('trade-activity trigger', () => {
	test('a trade activity drives the settlement; onboarding m2/m3 mint nothing at zero amounts', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0004'
		});
		await recordTrade(referee);
		await runTradeActivityTriggers({ userId: referee });

		expect(
			(await readAwardRow({ userId: referee, awardType: 'referral', awardKey: referee }))?.status
		).toBe('paid');

		// m2 is owed at the first trade but its configured amount is zero, so no
		// award row exists.
		expect(
			await readAwardRow({ userId: referee, awardType: 'onboarding', awardKey: 'm2' })
		).toBeUndefined();
	});

	test('the activity route pays nothing for a trade activity without a fill, then pays once the fill exists', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();
		const token = await createSession(referee);

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0RTE'
		});

		const base = Date.now();

		expect((await postTradeActivity({ token, timestamp: base })).status).toBe(201);
		expect(
			await readAwardRow({ userId: referee, awardType: 'referral', awardKey: referee })
		).toBeUndefined();
		expect(stub.transfers).toHaveLength(0);

		engineEvent({ userId: referee, eventType: { Executed: null }, qty: BigInt(10) });

		expect((await postTradeActivity({ token, timestamp: base + 1 })).status).toBe(201);
		expect(
			(await readAwardRow({ userId: referee, awardType: 'referral', awardKey: referee }))?.status
		).toBe('paid');
		expect(
			(await readAwardRow({ userId: referrer, awardType: 'referral', awardKey: referee }))?.status
		).toBe('paid');
		expect(stub.transfers).toHaveLength(2);

		// Another activity on the same fill converges: nothing pays twice.
		expect((await postTradeActivity({ token, timestamp: base + 2 })).status).toBe(201);
		expect(stub.transfers).toHaveLength(2);
	});
});

describe('hard-deleted referrer', () => {
	test('settlement still pays the referee and decides the cap slot, but never the dead referrer', async () => {
		stub = stubVxpLedger();
		const referrer = await createTestUser();
		const referee = await createTestUser();

		await recordReferralRedemption({
			refereeUserId: referee,
			referrerUserId: referrer,
			code: 'CODE0DEL'
		});
		await recordTrade(referee);
		await hardDeleteAccount(referrer);

		expect(await settleReferralPayout({ refereeUserId: referee })).toEqual({ settled: true });

		const refereeAward = await readAwardRow({
			userId: referee,
			awardType: 'referral',
			awardKey: referee
		});
		const referrerAward = await readAwardRow({
			userId: referrer,
			awardType: 'referral',
			awardKey: referee
		});
		const capRows = await query<{ within_referrer_cap: boolean | null }>(
			`select within_referrer_cap from referrals where referee_user_id = $1`,
			[referee]
		);

		expect(refereeAward?.status).toBe('paid');
		expect(referrerAward).toBeUndefined();
		expect(capRows[0]?.within_referrer_cap).toBeTrue();
		expect(stub.transfers).toHaveLength(1);
	});
});
