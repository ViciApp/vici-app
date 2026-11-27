// League battle scoring from settled history: each side is the members who
// joined before kickoff, for the live score and the resolved one alike, and
// a linked principal that does not parse never fails either.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
	readBattleLiveScore,
	resolveBattleFromSettlements
} from '../src/leagues/battle-resolution';
import { acceptLeagueBattle, proposeBattle } from '../src/leagues/battles';
import { createLeague } from '../src/leagues/leagues';
import { joinLeagueByInvite } from '../src/leagues/members';
import { DAY_IN_MS } from '../src/lib/time';
import { createTestUser, ensureMigrated, linkUnparseablePrincipal } from './helpers/auth';
import { stubSettledHistory } from './helpers/settlements';
import { dbAvailable } from './helpers/setup';

const uniqueId = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;

const seedLeague = async (): Promise<{ ownerId: string; leagueId: string; inviteCode: string }> => {
	const ownerId = await createTestUser();
	const league = await createLeague({
		id: uniqueId('lg'),
		name: 'Scored League',
		ownerUserId: ownerId,
		privacy: 'open'
	});

	return { ownerId, leagueId: league.id, inviteCode: league.inviteCode };
};

describe.if(dbAvailable)('league battle scoring from settled history', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('a member who joins after kickoff never lifts the side', async () => {
		const settled = stubSettledHistory();

		try {
			const a = await seedLeague();
			const b = await seedLeague();
			const nowMs = Date.now();
			const proposed = await proposeBattle({
				id: uniqueId('bt'),
				kind: 'league',
				sideA: a.leagueId,
				sideB: b.leagueId,
				proposerUserId: a.ownerId,
				kickoffMs: nowMs + DAY_IN_MS,
				settleMs: nowMs + 3 * DAY_IN_MS,
				nowMs
			});
			const kickoffMs = nowMs + 60_000;
			const battle = await acceptLeagueBattle({
				battleId: proposed.id,
				callerId: b.ownerId,
				nowMs: kickoffMs
			});
			const lateJoiner = await createTestUser();

			await joinLeagueByInvite({
				inviteCode: a.inviteCode,
				userId: lateJoiner,
				nowMs: kickoffMs + DAY_IN_MS
			});

			settled.settle({ userId: a.ownerId, atMs: kickoffMs + 1_000, calls: 10, wins: 5 });
			settled.settle({ userId: b.ownerId, atMs: kickoffMs + 1_000, calls: 10, wins: 6 });
			settled.settle({ userId: lateJoiner, atMs: kickoffMs + 2_000, calls: 50, wins: 50 });

			const live = await readBattleLiveScore({
				battleId: battle.id,
				callerId: a.ownerId,
				nowMs: kickoffMs + 2 * DAY_IN_MS
			});

			expect(live).toMatchObject({ callsA: 10, callsB: 10, leader: 'B' });

			const resolved = await resolveBattleFromSettlements({
				battleId: battle.id,
				callerId: a.ownerId,
				nowMs: battle.settleMs
			});

			expect(resolved).toMatchObject({ callsA: 10, callsB: 10, winner: 'B' });
		} finally {
			settled.restore();
		}
	});

	test('a member with a linked principal that does not parse is scored on the rest', async () => {
		const settled = stubSettledHistory();

		try {
			const a = await seedLeague();
			const b = await seedLeague();
			const nowMs = Date.now();
			const proposed = await proposeBattle({
				id: uniqueId('bt'),
				kind: 'league',
				sideA: a.leagueId,
				sideB: b.leagueId,
				proposerUserId: a.ownerId,
				kickoffMs: nowMs + DAY_IN_MS,
				settleMs: nowMs + 3 * DAY_IN_MS,
				nowMs
			});
			const kickoffMs = nowMs + 60_000;
			const battle = await acceptLeagueBattle({
				battleId: proposed.id,
				callerId: b.ownerId,
				nowMs: kickoffMs
			});

			await linkUnparseablePrincipal(a.ownerId);
			settled.settle({ userId: a.ownerId, atMs: kickoffMs + 1_000, calls: 10, wins: 7 });
			settled.settle({ userId: b.ownerId, atMs: kickoffMs + 1_000, calls: 10, wins: 6 });

			const live = await readBattleLiveScore({
				battleId: battle.id,
				callerId: a.ownerId,
				nowMs: kickoffMs + 2 * DAY_IN_MS
			});

			expect(live).toMatchObject({ callsA: 10, callsB: 10, leader: 'A' });

			const resolved = await resolveBattleFromSettlements({
				battleId: battle.id,
				callerId: a.ownerId,
				nowMs: battle.settleMs
			});

			expect(resolved).toMatchObject({ callsA: 10, callsB: 10, winner: 'A' });
		} finally {
			settled.restore();
		}
	});
});
