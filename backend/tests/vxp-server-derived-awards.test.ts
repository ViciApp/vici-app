// The streak, call-count, achievement and comeback awards are minted from
// server-side truth only: the engine's fills and settlements, the server's
// own record of Flow swipes, and the league rosters. A profile write that
// declares those figures mints nothing beyond the registration grant, and a
// user with the real activity behind them is paid each award exactly once.

import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import type { ClearingDid, ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { app } from '../src/index';
import { userIcPrincipalText } from '../src/lib/keys';
import { DAY_IN_MS } from '../src/lib/time';
import { ACHIEVEMENT_XP, parseVxp } from '../src/vxp/constants';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { uniqueNickname } from './helpers/profiles';
import { stubVxpLedger, type LedgerStub } from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreEngine: (() => void) | undefined;

// The fake engine's per-principal trade history.
const history = new Map<string, ClearingDid.Event[]>();
let nextEventId = 1;

beforeAll(async () => {
	await ensureMigrated();
});

beforeEach(() => {
	restoreEngine = setEngineActorProvider({
		clearing: (identity) => {
			const events = history.get(identity.getPrincipal().toText()) ?? [];

			return Promise.resolve({
				get_trade_history: () => Promise.resolve(events)
			} as unknown as ClearingService);
		},
		registry: () => Promise.resolve({} as unknown as RegistryService)
	});
});

afterEach(() => {
	setSystemTime();
	stub?.restore();
	stub = undefined;
	restoreEngine?.();
	restoreEngine = undefined;
});

const engineEvent = ({
	userId,
	eventType,
	qty,
	atMs,
	price = 0.5
}: {
	userId: string;
	eventType: ClearingDid.EventType;
	qty: bigint;
	atMs: number;
	price?: number;
}): void => {
	const owner = userIcPrincipalText(userId);

	history.set(owner, [
		...(history.get(owner) ?? []),
		{
			event_id: BigInt(nextEventId++),
			series_id: 'series-server-derived-awards',
			user: Principal.fromText(owner),
			clearing_id: Principal.anonymous(),
			qty,
			timestamp: BigInt(atMs) * BigInt(1_000_000),
			price: {
				timestamp: [],
				oracle_id: [],
				decimal: { value: BigInt(Math.round(price * 100)), decimals: 2 }
			},
			event_type: eventType
		}
	]);
};

const fill = ({ userId, atMs }: { userId: string; atMs: number }): void =>
	engineEvent({ userId, eventType: { Executed: null }, qty: BigInt(10), atMs });

const request = ({
	token,
	method,
	path,
	body
}: {
	token: string;
	method: 'PUT' | 'POST';
	path: string;
	body: Record<string, unknown>;
}): Promise<Response> =>
	app.handle(
		new Request(`http://localhost${path}`, {
			method,
			headers: { cookie: `vici_session=${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);

const putProfile = async ({
	token,
	body
}: {
	token: string;
	body: Record<string, unknown>;
}): Promise<void> => {
	const res = await request({ token, method: 'PUT', path: '/api/v1/profiles/me', body });

	expect(res.status).toBe(200);
};

const postTradeActivity = async ({ token }: { token: string }): Promise<void> => {
	const res = await request({
		token,
		method: 'POST',
		path: '/api/v1/social/activities',
		body: { type: 'trade', title: 'Predicted 10 on YES @ 50%', timestamp: Date.now() }
	});

	expect(res.status).toBe(201);
};

const swipe = async ({ token }: { token: string }): Promise<void> => {
	const res = await request({
		token,
		method: 'POST',
		path: '/api/v1/profiles/flow-swipe',
		body: { dayKey: new Date(Date.now()).toISOString().slice(0, 10) }
	});

	expect(res.status).toBe(200);
};

/** Every award row of the user as `type/key`, sorted. */
const awardKeys = async (userId: string): Promise<string[]> =>
	(
		await query<{ award_type: string; award_key: string }>(
			`select award_type, award_key from vxp_awards where user_id = $1`,
			[userId]
		)
	)
		.map(({ award_type, award_key }) => `${award_type}/${award_key}`)
		.sort();

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const newAccount = async (): Promise<{ userId: string; token: string; nickname: string }> => {
	const userId = await createTestUser();

	return { userId, token: await createSession(userId), nickname: uniqueNickname() };
};

describe('client-declared profile figures', () => {
	test('a profile write declaring a 30-day streak, 1000 calls, every achievement and a long absence mints only the registration grant', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(BigInt(0)) });
		const { userId, token, nickname } = await newAccount();
		const now = Date.now();

		await putProfile({ token, body: { nickname, lastActiveDay: dayKey(now - 30 * DAY_IN_MS) } });
		await putProfile({
			token,
			body: {
				nickname,
				dailyStreak: 30,
				longestStreak: 30,
				totalTrades: 1000,
				unlockedAchievements: Object.keys(ACHIEVEMENT_XP),
				lastActiveDay: dayKey(now)
			}
		});

		// A trade activity with no fill behind it changes nothing either.
		await postTradeActivity({ token });

		expect(await awardKeys(userId)).toEqual(['onboarding/m1']);
		expect(stub.transfers.map(({ amount }) => amount)).toEqual([parseVxp(1500)]);
	});
});

describe('server-recorded activity', () => {
	test('30 days of fills and 10 long-shot wins pay the matching streak, call-count and achievement awards exactly once', async () => {
		stub = stubVxpLedger();
		const { userId, token, nickname } = await newAccount();
		const now = Date.now();

		// One fill on each of the last 30 UTC days, 20 more today: 50 calls.
		for (let day = 29; day >= 0; day--) {
			fill({ userId, atMs: now - day * DAY_IN_MS });
		}

		for (let extra = 0; extra < 20; extra++) {
			fill({ userId, atMs: now - extra });
		}

		// Ten winning settlements, all taken at a 25% consensus.
		for (let win = 0; win < 10; win++) {
			engineEvent({
				userId,
				eventType: { Settled: null },
				qty: BigInt(10),
				atMs: now - win,
				price: 0.25
			});
		}

		// The profile claims nothing: the awards come from the engine.
		await putProfile({ token, body: { nickname } });
		await postTradeActivity({ token });

		expect(await awardKeys(userId)).toEqual([
			'achievement/contrarian',
			'achievement/first-call',
			'achievement/marathon',
			'achievement/on-fire',
			'achievement/oracle',
			'flow_milestone/10',
			'onboarding/m1',
			'streak/streak_14',
			'streak/streak_3',
			'streak/streak_30',
			'streak/streak_7'
		]);

		const paid = stub.transfers.length;
		const total = stub.transfers.reduce((sum, { amount }) => sum + amount, BigInt(0));

		expect(total).toBe(
			parseVxp(
				1500 + // registration
					50 +
					150 +
					400 +
					1000 + // streak 3 / 7 / 14 / 30
					50 + // 10 calls
					50 +
					800 +
					500 +
					200 +
					400 // first-call, marathon, oracle, on-fire, contrarian
			)
		);

		// Replays (another trade activity, another profile write) pay nothing.
		await postTradeActivity({ token });
		await putProfile({ token, body: { nickname } });

		expect(stub.transfers).toHaveLength(paid);
	});

	test('Flow swipes on consecutive server days build the streak', async () => {
		stub = stubVxpLedger();
		const { userId, token, nickname } = await newAccount();
		const start = Date.now();

		await putProfile({ token, body: { nickname } });

		// Past days only: a future-dated award would leave analytics rollups
		// ahead of today for the suites that read the latest day.
		for (let day = 2; day >= 0; day--) {
			setSystemTime(new Date(start - day * DAY_IN_MS));
			await swipe({ token });
			// A second swipe on the same day adds no day.
			await swipe({ token });
		}

		expect(await awardKeys(userId)).toEqual(['onboarding/m1', 'streak/streak_3']);
	});

	test('a Flow swipe after a real absence restores a depleted balance once', async () => {
		stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(40)) });
		const { userId, token, nickname } = await newAccount();
		const now = Date.now();

		await putProfile({ token, body: { nickname } });

		// The last fill was 10 days ago; the trade activity records that day.
		fill({ userId, atMs: now - 10 * DAY_IN_MS });
		await postTradeActivity({ token });

		expect(await awardKeys(userId)).not.toContain('comeback/restore');

		await swipe({ token });
		await swipe({ token });

		expect(await awardKeys(userId)).toContain('comeback/restore');
		expect(stub.transfers.filter(({ memo }) => memo === 'vxp:comeback:restore')).toHaveLength(1);
		expect(stub.transfers.find(({ memo }) => memo === 'vxp:comeback:restore')?.amount).toBe(
			parseVxp(210)
		);
	});

	test('owning a league of three members pays league-founder on the next trade', async () => {
		stub = stubVxpLedger();
		const { userId, token, nickname } = await newAccount();
		const leagueId = `league-${randomBytes(6).toString('hex')}`;
		const members = [userId, await createTestUser(), await createTestUser()];

		await putProfile({ token, body: { nickname } });
		await query(
			`insert into leagues (id, name, invite_code, owner_user_id, created_at_ms)
			 values ($1, 'Founders', $2, $3, $4)`,
			[leagueId, randomBytes(3).toString('hex').toUpperCase(), userId, Date.now()]
		);

		for (const [index, member] of members.entries()) {
			await query(
				`insert into league_members (league_id, member_user_id, joined_at_ms, role)
				 values ($1, $2, $3, $4)`,
				[leagueId, member, Date.now(), index === 0 ? 'owner' : 'member']
			);
		}

		fill({ userId, atMs: Date.now() });
		await postTradeActivity({ token });

		expect(await awardKeys(userId)).toContain('achievement/league-founder');
	});
});
