// League stats fanout: profile trade/win deltas and user_stats category
// deltas land on every league the writer belongs to, in the same transaction
// as the source write; hibernated accounts and first writes never move the
// shared counters.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import { createLeague } from '../src/leagues/leagues';
import { joinLeagueByInvite } from '../src/leagues/members';
import { getLeagueStats, leagueStatsBucket } from '../src/leagues/stats';
import { PG_INT_MAX } from '../src/lib/constants';
import { ProfileValidationError } from '../src/profiles/profile';
import { MAX_PROFILE_COUNTER, upsertMyProfile } from '../src/profiles/profile-write';
import { upsertUserStats } from '../src/profiles/stats';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { hibernateProfile, uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const uniqueLeagueId = (): string => `lg-${randomBytes(6).toString('hex')}`;

const seedLeagueWithMembers = async (
	count: number
): Promise<{ leagueId: string; userIds: string[] }> => {
	const ownerId = await createTestUser();
	const league = await createLeague({
		id: uniqueLeagueId(),
		name: 'Stats League',
		ownerUserId: ownerId
	});
	const userIds: string[] = [];

	for (let i = 0; i < count; i += 1) {
		const userId = await createTestUser();

		await joinLeagueByInvite({ inviteCode: league.inviteCode, userId });
		userIds.push(userId);
	}

	return { leagueId: league.id, userIds };
};

const seedLeagueWithMember = async (): Promise<{ leagueId: string; userId: string }> => {
	const {
		leagueId,
		userIds: [userId]
	} = await seedLeagueWithMembers(1);

	if (isNullish(userId)) {
		throw new Error('member missing');
	}

	return { leagueId, userId };
};

describe.if(dbAvailable)('profile aggregate fanout', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('an advance in totalTrades fans the delta out; the first write does not', async () => {
		const { leagueId, userId } = await seedLeagueWithMember();
		const nickname = uniqueNickname();

		// First write: 10 trades at 50% cannot be attributed (no before row).
		await upsertMyProfile({ userId, body: { nickname, totalTrades: 10, winRate: 50 } });

		expect((await getLeagueStats(leagueId))?.totalCalls ?? 0).toBe(0);

		// 10 -> 14 trades, wins 5 -> 7: delta (4 calls, 2 wins).
		await upsertMyProfile({ userId, body: { nickname, totalTrades: 14, winRate: 50 } });

		const stats = await getLeagueStats(leagueId);

		expect(stats?.totalCalls).toBe(4);
		expect(stats?.wins).toBe(2);

		// Identical re-write: zero delta, nothing moves.
		await upsertMyProfile({ userId, body: { nickname, totalTrades: 14, winRate: 50 } });

		expect((await getLeagueStats(leagueId))?.totalCalls).toBe(4);
	});

	test('a hibernated account never moves shared league counters', async () => {
		const { leagueId, userId } = await seedLeagueWithMember();
		const nickname = uniqueNickname();

		await upsertMyProfile({ userId, body: { nickname, totalTrades: 10, winRate: 50 } });
		await hibernateProfile(userId);
		await upsertMyProfile({ userId, body: { nickname, totalTrades: 20, winRate: 50 } });

		expect((await getLeagueStats(leagueId))?.totalCalls ?? 0).toBe(0);
	});

	test('a drop and a rise back count once: only a new high moves the league', async () => {
		const { leagueId, userId } = await seedLeagueWithMember();
		const nickname = uniqueNickname();

		await upsertMyProfile({ userId, body: { nickname, totalTrades: 0, winRate: 0 } });

		for (const totalTrades of [500, 0, 500, 0, 520]) {
			await upsertMyProfile({ userId, body: { nickname, totalTrades, winRate: 100 } });
		}

		const stats = await getLeagueStats(leagueId);

		expect(stats?.totalCalls).toBe(520);
		expect(stats?.wins).toBe(520);
	});

	test('a counter past the ceiling is refused, so one member cannot fill the league row', async () => {
		const {
			leagueId,
			userIds: [pusher, other]
		} = await seedLeagueWithMembers(2);

		if (isNullish(pusher) || isNullish(other)) {
			throw new Error('members missing');
		}

		const pusherNickname = uniqueNickname();
		const otherNickname = uniqueNickname();

		await upsertMyProfile({ userId: pusher, body: { nickname: pusherNickname } });
		await upsertMyProfile({ userId: other, body: { nickname: otherNickname } });

		expect(
			upsertMyProfile({
				userId: pusher,
				body: { nickname: pusherNickname, totalTrades: PG_INT_MAX - 10 }
			})
		).rejects.toBeInstanceOf(ProfileValidationError);
		expect(
			upsertMyProfile({
				userId: pusher,
				body: { nickname: pusherNickname, totalTrades: MAX_PROFILE_COUNTER + 1 }
			})
		).rejects.toBeInstanceOf(ProfileValidationError);

		await upsertMyProfile({ userId: other, body: { nickname: otherNickname, totalTrades: 100 } });

		expect((await getLeagueStats(leagueId))?.totalCalls).toBe(100);
	});

	test('a league row already at the int ceiling saturates instead of failing a member save', async () => {
		const { leagueId, userId } = await seedLeagueWithMember();
		const nickname = uniqueNickname();

		await upsertMyProfile({ userId, body: { nickname, totalTrades: 0 } });
		await upsertMyProfile({ userId, body: { nickname, totalTrades: 1 } });
		await query(`update league_stats set total_calls = $2, wins = $2 where league_id = $1`, [
			leagueId,
			PG_INT_MAX - 5
		]);

		await upsertMyProfile({ userId, body: { nickname, totalTrades: 100, winRate: 100 } });

		const stats = await getLeagueStats(leagueId);

		expect(stats?.totalCalls).toBe(PG_INT_MAX);
		expect(stats?.wins).toBe(PG_INT_MAX);
	});
});

describe.if(dbAvailable)('category fanout', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('categoryStats deltas seed and grow the per-league buckets, clamped to wins <= calls', async () => {
		const { leagueId, userId } = await seedLeagueWithMember();

		await upsertMyProfile({ userId, body: { nickname: uniqueNickname() } });

		// First stats write seeds the buckets from the full categoryStats.
		await upsertUserStats({
			userId,
			categoryStats: { sports: { calls: 5, wins: 3 } },
			recentSettlements: [],
			computedAtMs: Date.now()
		});

		let stats = await getLeagueStats(leagueId);

		expect(leagueStatsBucket({ stats, scope: 'sports' })).toEqual({ calls: 5, wins: 3 });

		// Growth: 5->8 calls, 3->4 wins adds (3, 1).
		await upsertUserStats({
			userId,
			categoryStats: { sports: { calls: 8, wins: 4 } },
			recentSettlements: [],
			computedAtMs: Date.now()
		});

		stats = await getLeagueStats(leagueId);

		expect(leagueStatsBucket({ stats, scope: 'sports' })).toEqual({ calls: 8, wins: 4 });

		// The aggregate counters stay owned by the profile fanout.
		expect(stats?.totalCalls).toBe(0);
	});
});
