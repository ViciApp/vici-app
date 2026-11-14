// Battle state machine: proposal gates, the per-transition authorisation,
// window discipline on the league accept, decline/expire terminals, duel
// accept-then-kickoff, manual duel resolution with the derived winner, the
// baseline-less restart path, and the proposed-only retract.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import {
	acceptDuel,
	acceptLeagueBattle,
	BATTLE_RESPOND_BY_MS,
	declineBattle,
	expireBattle,
	getBattle,
	getMyBattleStats,
	kickoffBattle,
	listLeagueBattles,
	listMyBattles,
	proposeBattle,
	resolveDuel,
	restartBattle,
	retractBattle
} from '../src/leagues/battles';
import { createLeague } from '../src/leagues/leagues';
import { joinLeagueByInvite } from '../src/leagues/members';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueId = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;

const DAY_MS = 24 * 60 * 60 * 1000;

const seedLeague = async (
	privacy: 'open' | 'private' = 'open'
): Promise<{ ownerId: string; leagueId: string; inviteCode: string }> => {
	const ownerId = await createTestUser();
	const league = await createLeague({
		id: uniqueId('lg'),
		name: 'Battle League',
		ownerUserId: ownerId,
		privacy
	});

	return { ownerId, leagueId: league.id, inviteCode: league.inviteCode };
};

const setLeagueStats = async ({
	leagueId,
	totalCalls,
	wins
}: {
	leagueId: string;
	totalCalls: number;
	wins: number;
}): Promise<void> => {
	await query(
		`insert into league_stats (league_id, total_calls, wins, updated_at_ms)
		 values ($1, $2, $3, $4)
		 on conflict (league_id) do update set
		   total_calls = excluded.total_calls, wins = excluded.wins,
		   updated_at_ms = excluded.updated_at_ms`,
		[leagueId, totalCalls, wins, Date.now()]
	);
};

describe.if(dbAvailable)('battle proposal', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('league proposal stamps proposed state and the respond-by deadline', async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();

		const battle = await proposeBattle({
			id: uniqueId('bt'),
			kind: 'league',
			sideA: a.leagueId,
			sideB: b.leagueId,
			proposerUserId: a.ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 3 * DAY_MS,
			trashTalk: 'bring it',
			nowMs
		});

		expect(battle.state).toBe('proposed');
		expect(battle.respondByMs).toBe(nowMs + BATTLE_RESPOND_BY_MS);
		expect(battle.baselineA).toBeUndefined();
		expect(battle.winner).toBeUndefined();
	});

	test('rejects a proposer without sideA authority, a private sideB, and a bad window', async () => {
		const a = await seedLeague();
		const b = await seedLeague('private');
		const open = await seedLeague();
		const stranger = await createTestUser();
		const nowMs = Date.now();

		expect(
			proposeBattle({
				id: uniqueId('bt'),
				kind: 'league',
				sideA: a.leagueId,
				sideB: open.leagueId,
				proposerUserId: stranger,
				kickoffMs: nowMs + DAY_MS,
				settleMs: nowMs + 2 * DAY_MS
			})
		).rejects.toThrow('owner or admin of sideA');

		expect(
			proposeBattle({
				id: uniqueId('bt'),
				kind: 'league',
				sideA: a.leagueId,
				sideB: b.leagueId,
				proposerUserId: a.ownerId,
				kickoffMs: nowMs + DAY_MS,
				settleMs: nowMs + 2 * DAY_MS
			})
		).rejects.toThrow('OPEN league');

		expect(
			proposeBattle({
				id: uniqueId('bt'),
				kind: 'league',
				sideA: a.leagueId,
				sideB: open.leagueId,
				proposerUserId: a.ownerId,
				kickoffMs: nowMs + 2 * DAY_MS,
				settleMs: nowMs + DAY_MS
			})
		).rejects.toThrow('strictly before');
	});

	test('duel proposal binds sideA to the proposer', async () => {
		const userA = await createTestUser();
		const userB = await createTestUser();
		const nowMs = Date.now();

		expect(
			proposeBattle({
				id: uniqueId('bt'),
				kind: 'duel',
				sideA: userB,
				sideB: userA,
				proposerUserId: userA,
				kickoffMs: nowMs + DAY_MS,
				settleMs: nowMs + 2 * DAY_MS
			})
		).rejects.toThrow('sideA for kind="duel"');
	});

	test('stores the optional amount and rejects one out of bounds', async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();
		const id = uniqueId('bt');
		const proposal = {
			kind: 'league' as const,
			sideA: a.leagueId,
			sideB: b.leagueId,
			proposerUserId: a.ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS
		};

		expect((await proposeBattle({ ...proposal, id, amount: 200 })).amount).toBe(200);
		expect((await getBattle(id))?.amount).toBe(200);

		expect(proposeBattle({ ...proposal, id: uniqueId('bt'), amount: 501 })).rejects.toThrow(
			'amount must be within'
		);
	});

	test('the propose route reads the amount from the old `wager` field', async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();
		const id = uniqueId('bt');

		const res = await app.handle(
			new Request('http://localhost/api/v1/battles/', {
				method: 'POST',
				headers: {
					cookie: `vici_session=${await createSession(a.ownerId)}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					id,
					kind: 'league',
					sideA: a.leagueId,
					sideB: b.leagueId,
					kickoffMs: nowMs + DAY_MS,
					settleMs: nowMs + 2 * DAY_MS,
					wager: 300
				})
			})
		);

		expect(res.status).toBe(201);
		expect((await getBattle(id))?.amount).toBe(300);
	});
});

describe.if(dbAvailable)('league accept, decline and expire', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const seedProposal = async (): Promise<{
		battleId: string;
		a: Awaited<ReturnType<typeof seedLeague>>;
		b: Awaited<ReturnType<typeof seedLeague>>;
		nowMs: number;
	}> => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();
		const battle = await proposeBattle({
			id: uniqueId('bt'),
			kind: 'league',
			sideA: a.leagueId,
			sideB: b.leagueId,
			proposerUserId: a.ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 3 * DAY_MS,
			nowMs
		});

		return { battleId: battle.id, a, b, nowMs };
	};

	test('sideB owner accept fuses the kickoff: window from now, duration preserved, baselines stamped', async () => {
		const { battleId, a, b, nowMs } = await seedProposal();

		await setLeagueStats({ leagueId: a.leagueId, totalCalls: 40, wins: 30 });
		await setLeagueStats({ leagueId: b.leagueId, totalCalls: 10, wins: 5 });

		const acceptMs = nowMs + 60_000;
		const accepted = await acceptLeagueBattle({ battleId, callerId: b.ownerId, nowMs: acceptMs });

		expect(accepted.state).toBe('in_flight');
		expect(accepted.kickoffMs).toBe(acceptMs);
		expect(accepted.settleMs).toBe(acceptMs + 2 * DAY_MS);
		expect(accepted.respondedAtMs).toBe(acceptMs);
		expect(accepted.baselineA).toEqual({ calls: 40, wins: 30 });
		expect(accepted.baselineB).toEqual({ calls: 10, wins: 5 });
	});

	test('a non-sideB user cannot accept; a sideB admin can', async () => {
		const { battleId, b } = await seedProposal();
		const stranger = await createTestUser();
		const admin = await createTestUser();

		await joinLeagueByInvite({ inviteCode: b.inviteCode, userId: admin });
		await query(
			`update league_members set role = 'admin' where league_id = $1 and member_user_id = $2`,
			[b.leagueId, admin]
		);

		expect(acceptLeagueBattle({ battleId, callerId: stranger })).rejects.toThrow(
			'sideB owner or admin'
		);

		const accepted = await acceptLeagueBattle({ battleId, callerId: admin });

		expect(accepted.state).toBe('in_flight');
	});

	test('decline stamps respondedAtMs and is terminal', async () => {
		const { battleId, b, nowMs } = await seedProposal();

		const declined = await declineBattle({ battleId, callerId: b.ownerId, nowMs: nowMs + 500 });

		expect(declined.state).toBe('declined');
		expect(declined.respondedAtMs).toBe(nowMs + 500);

		expect(acceptLeagueBattle({ battleId, callerId: b.ownerId })).rejects.toThrow(
			'not a valid accept'
		);
	});

	test('expire refuses before respondByMs and lapses the proposal after it', async () => {
		const { battleId, a, nowMs } = await seedProposal();

		expect(
			expireBattle({ battleId, callerId: a.ownerId, nowMs: nowMs + BATTLE_RESPOND_BY_MS - 1000 })
		).rejects.toThrow('before respondByMs');

		const expired = await expireBattle({
			battleId,
			callerId: a.ownerId,
			nowMs: nowMs + BATTLE_RESPOND_BY_MS + 1000
		});

		expect(expired.state).toBe('expired');
		expect(expired.respondedAtMs).toBeUndefined();
	});
});

describe.if(dbAvailable)('duel lifecycle', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('accept -> kickoff -> resolve with the winner derived from the arithmetic', async () => {
		const userA = await createTestUser();
		const userB = await createTestUser();
		const nowMs = Date.now();

		const battle = await proposeBattle({
			id: uniqueId('bt'),
			kind: 'duel',
			sideA: userA,
			sideB: userB,
			proposerUserId: userA,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS,
			nowMs
		});

		expect(acceptDuel({ battleId: battle.id, callerId: userA })).rejects.toThrow('sideB owner');

		const accepted = await acceptDuel({ battleId: battle.id, callerId: userB });

		expect(accepted.state).toBe('accepted');

		expect(
			kickoffBattle({ battleId: battle.id, callerId: userA, nowMs: nowMs + 1000 })
		).rejects.toThrow('before kickoffMs');

		const inFlight = await kickoffBattle({
			battleId: battle.id,
			callerId: userA,
			nowMs: nowMs + DAY_MS + 1000
		});

		expect(inFlight.state).toBe('in_flight');
		expect(inFlight.baselineA).toBeUndefined();

		expect(
			resolveDuel({
				battleId: battle.id,
				callerId: userA,
				scoreA: 70,
				scoreB: 60,
				nowMs: nowMs + DAY_MS + 2000
			})
		).rejects.toThrow('before settleMs');

		const resolved = await resolveDuel({
			battleId: battle.id,
			callerId: userB,
			scoreA: 60,
			scoreB: 80,
			nowMs: nowMs + 2 * DAY_MS + 1000
		});

		expect(resolved.state).toBe('resolved');
		expect(resolved.winner).toBe('B');
		expect(resolved.callsA).toBeUndefined();

		const stats = await getMyBattleStats(userB);

		expect(stats.boutsWon).toBeGreaterThanOrEqual(1);
	});
});

describe.if(dbAvailable)('restart and retract', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a baseline-less in-flight league battle restarts its window with fresh baselines', async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();

		// An imported row that went in flight without a kickoff snapshot.
		const battleId = uniqueId('bt');

		await query(
			`insert into battles (id, kind, side_a, side_b, proposer_user_id, state, kickoff_ms, settle_ms)
			 values ($1, 'league', $2, $3, $4, 'in_flight', $5, $6)`,
			[battleId, a.leagueId, b.leagueId, a.ownerId, nowMs - 2 * DAY_MS, nowMs + DAY_MS]
		);

		await setLeagueStats({ leagueId: a.leagueId, totalCalls: 7, wins: 3 });

		const stranger = await createTestUser();

		expect(restartBattle({ battleId, callerId: stranger })).rejects.toThrow('member');

		const restartMs = nowMs + 1000;
		const restarted = await restartBattle({ battleId, callerId: a.ownerId, nowMs: restartMs });

		expect(restarted.kickoffMs).toBe(restartMs);
		expect(restarted.settleMs).toBe(restartMs + 3 * DAY_MS);
		expect(restarted.baselineA).toEqual({ calls: 7, wins: 3 });

		// Once baselines exist the restart path closes.
		expect(restartBattle({ battleId, callerId: a.ownerId })).rejects.toThrow('lacks baselines');
	});

	test('retract is proposer-only and proposed-only', async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();
		const battle = await proposeBattle({
			id: uniqueId('bt'),
			kind: 'league',
			sideA: a.leagueId,
			sideB: b.leagueId,
			proposerUserId: a.ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS,
			nowMs
		});

		expect(retractBattle({ battleId: battle.id, callerId: b.ownerId })).rejects.toThrow(
			'original proposer'
		);

		await declineBattle({ battleId: battle.id, callerId: b.ownerId });

		expect(retractBattle({ battleId: battle.id, callerId: a.ownerId })).rejects.toThrow(
			'immutable history'
		);
	});

	test("lists surface league battles and the caller's battles", async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();
		const battle = await proposeBattle({
			id: uniqueId('bt'),
			kind: 'league',
			sideA: a.leagueId,
			sideB: b.leagueId,
			proposerUserId: a.ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS,
			nowMs
		});

		expect((await listLeagueBattles(a.leagueId)).some((x) => x.id === battle.id)).toBe(true);
		expect((await listMyBattles(a.ownerId)).some((x) => x.id === battle.id)).toBe(true);
		expect((await listMyBattles(b.ownerId)).some((x) => x.id === battle.id)).toBe(true);
		expect(await getBattle(battle.id)).toBeDefined();
	});
});

// Migration 0021 keeps `wager` next to `amount` while machines of the previous
// release can still serve: they write and read only `wager`.
describe.if(dbAvailable)('battle amount alongside the old wager column', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	const insertLegacyRow = async (wager: number): Promise<string> => {
		const id = uniqueId('bt');
		const proposer = await createTestUser();

		await query(
			`insert into battles (id, kind, side_a, side_b, proposer_user_id, state, kickoff_ms,
			   settle_ms, wager)
			 values ($1, 'duel', $2, $3, $4, 'proposed', 1, 2, $5)`,
			[id, proposer, await createTestUser(), proposer, wager]
		);

		return id;
	};

	const columns = async (id: string): Promise<{ amount: number | null; wager: number | null }> => {
		const [row] = await query<{ amount: number | null; wager: number | null }>(
			`select amount, wager from battles where id = $1`,
			[id]
		);

		return { amount: row?.amount ?? null, wager: row?.wager ?? null };
	};

	test('an insert that sets only wager gets amount filled', async () => {
		const id = await insertLegacyRow(120);

		expect(await columns(id)).toEqual({ amount: 120, wager: 120 });
		expect((await getBattle(id))?.amount).toBe(120);
	});

	test('an update that changes only wager carries it into amount', async () => {
		const id = await insertLegacyRow(120);

		await query(`update battles set wager = 80 where id = $1`, [id]);

		expect(await columns(id)).toEqual({ amount: 80, wager: 80 });
	});

	test('a new proposal writes wager too, for machines that read only it', async () => {
		const a = await seedLeague();
		const b = await seedLeague();
		const nowMs = Date.now();
		const battle = await proposeBattle({
			id: uniqueId('bt'),
			kind: 'league',
			sideA: a.leagueId,
			sideB: b.leagueId,
			proposerUserId: a.ownerId,
			kickoffMs: nowMs + DAY_MS,
			settleMs: nowMs + 2 * DAY_MS,
			amount: 250
		});

		expect(await columns(battle.id)).toEqual({ amount: 250, wager: 250 });
	});

	test('running the migration again changes nothing', async () => {
		const id = await insertLegacyRow(60);
		const schemaShape = (): Promise<unknown[]> =>
			query(
				`select
				   (select count(*) from pg_constraint
				     where conrelid = 'battles'::regclass and conname = 'battles_amount_check')::int
				     as checks,
				   (select count(*) from pg_trigger
				     where tgrelid = 'battles'::regclass and tgname = 'battles_amount_from_wager')::int
				     as triggers,
				   (select count(*) from information_schema.columns
				     where table_name = 'battles' and column_name in ('amount', 'wager'))::int
				     as columns`
			);
		const before = { shape: await schemaShape(), row: await columns(id) };

		await query(
			readFileSync(join(import.meta.dir, '../src/db/migrations/0021_battle_amount.sql'), 'utf8')
		);

		expect({ shape: await schemaShape(), row: await columns(id) }).toEqual(before);
		expect(before.shape).toEqual([{ checks: 1, triggers: 1, columns: 2 }]);
	});
});
