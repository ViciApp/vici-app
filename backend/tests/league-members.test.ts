// League membership key discipline: who can write / change / remove a
// membership row, the reserved owner role, and the atomic ownership
// transfer.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
	createLeague,
	deleteLeague,
	getLeague,
	listLeagueMembers,
	listMyLeagues,
	lookupLeagueByInvite,
	transferLeagueOwnership
} from '../src/leagues/leagues';
import {
	getLeagueMember,
	joinLeagueByInvite,
	removeLeagueMember,
	upsertLeagueMember
} from '../src/leagues/members';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueLeagueId = (): string => `lg-${randomBytes(6).toString('hex')}`;

const seedLeague = async (
	overrides: { privacy?: 'open' | 'private' } = {}
): Promise<{ ownerId: string; leagueId: string; inviteCode: string }> => {
	const ownerId = await createTestUser();
	const league = await createLeague({
		id: uniqueLeagueId(),
		name: 'Test League',
		ownerUserId: ownerId,
		privacy: overrides.privacy
	});

	return { ownerId, leagueId: league.id, inviteCode: league.inviteCode };
};

describe.if(dbAvailable)('league creation', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('creates the league with an owner membership row and a valid invite code', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();

		expect(inviteCode).toMatch(/^[A-Z0-9]{6}$/);

		const member = await getLeagueMember({ leagueId, memberUserId: ownerId });

		expect(member?.role).toBe('owner');

		const mine = await listMyLeagues(ownerId);

		expect(mine.some(({ league }) => league.id === leagueId)).toBe(true);
	});

	test('rejects out-of-bounds names and unknown emblems', async () => {
		const ownerId = await createTestUser();

		expect(
			createLeague({ id: uniqueLeagueId(), name: 'ab', ownerUserId: ownerId })
		).rejects.toThrow('name');

		expect(
			createLeague({ id: uniqueLeagueId(), name: 'Valid Name', ownerUserId: ownerId, emblem: 'x' })
		).rejects.toThrow('emblem');
	});

	test('resolves the league by invite code', async () => {
		const { leagueId, inviteCode } = await seedLeague();

		expect((await lookupLeagueByInvite(inviteCode))?.id).toBe(leagueId);
		expect(await lookupLeagueByInvite('ZZZZZ0')).toBeUndefined();
	});
});

describe.if(dbAvailable)('membership key discipline', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('self-join by invite code; re-join is idempotent and keeps joinedAtMs', async () => {
		const { leagueId, inviteCode } = await seedLeague();
		const userId = await createTestUser();

		const joined = await joinLeagueByInvite({ inviteCode, userId, nowMs: 1000 });

		expect(joined.role).toBe('member');
		expect(joined.joinedAtMs).toBe(1000);

		const rejoined = await joinLeagueByInvite({ inviteCode, userId, nowMs: 2000 });

		expect(rejoined.joinedAtMs).toBe(1000);
		expect((await listLeagueMembers(leagueId)).length).toBe(2);
	});

	test("a stranger cannot write another user's membership row", async () => {
		const { leagueId } = await seedLeague();
		const stranger = await createTestUser();
		const target = await createTestUser();

		expect(
			upsertLeagueMember({ leagueId, callerId: stranger, memberUserId: target, role: 'member' })
		).rejects.toThrow('member themselves or the league owner');
	});

	test('a non-member cannot write their own row without the invite code', async () => {
		const { leagueId } = await seedLeague({ privacy: 'private' });
		const outsider = await createTestUser();

		for (const role of ['admin', 'member'] as const) {
			expect(
				upsertLeagueMember({ leagueId, callerId: outsider, memberUserId: outsider, role })
			).rejects.toThrow('invite code or the league owner');
		}

		expect(await getLeagueMember({ leagueId, memberUserId: outsider })).toBeUndefined();
	});

	test('the owner can add a new member row directly', async () => {
		const { ownerId, leagueId } = await seedLeague();
		const userId = await createTestUser();

		const added = await upsertLeagueMember({
			leagueId,
			callerId: ownerId,
			memberUserId: userId,
			role: 'member'
		});

		expect(added.role).toBe('member');
	});

	test('the owner role is reserved for the league owner', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();
		const userId = await createTestUser();

		await joinLeagueByInvite({ inviteCode, userId });

		expect(
			upsertLeagueMember({ leagueId, callerId: ownerId, memberUserId: userId, role: 'owner' })
		).rejects.toThrow('reserved');
	});

	test('role changes require the owner; a member cannot promote themselves', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();
		const userId = await createTestUser();

		await joinLeagueByInvite({ inviteCode, userId });

		expect(
			upsertLeagueMember({ leagueId, callerId: userId, memberUserId: userId, role: 'admin' })
		).rejects.toThrow('require the league owner');

		const promoted = await upsertLeagueMember({
			leagueId,
			callerId: ownerId,
			memberUserId: userId,
			role: 'admin'
		});

		expect(promoted.role).toBe('admin');
	});

	test('owner row cannot be deleted; self-leave and owner-kick work; admins cannot kick', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();
		const admin = await createTestUser();
		const memberA = await createTestUser();
		const memberB = await createTestUser();

		await joinLeagueByInvite({ inviteCode, userId: admin });
		await joinLeagueByInvite({ inviteCode, userId: memberA });
		await joinLeagueByInvite({ inviteCode, userId: memberB });
		await upsertLeagueMember({ leagueId, callerId: ownerId, memberUserId: admin, role: 'admin' });

		expect(
			removeLeagueMember({ leagueId, callerId: ownerId, memberUserId: ownerId })
		).rejects.toThrow('owner row cannot be deleted');

		expect(
			removeLeagueMember({ leagueId, callerId: admin, memberUserId: memberA })
		).rejects.toThrow('member themselves or the league owner');

		await removeLeagueMember({ leagueId, callerId: memberA, memberUserId: memberA });
		await removeLeagueMember({ leagueId, callerId: ownerId, memberUserId: memberB });

		const roster = await listLeagueMembers(leagueId);

		expect(roster.map((m) => m.memberUserId).sort()).toEqual([admin, ownerId].sort());
	});
});

describe.if(dbAvailable)('ownership transfer', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('flips the owner, promotes the new owner row and demotes the old one atomically', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();
		const newOwner = await createTestUser();

		await joinLeagueByInvite({ inviteCode, userId: newOwner });

		const result = await transferLeagueOwnership({
			leagueId,
			callerId: ownerId,
			newOwnerUserId: newOwner
		});

		expect(result.ok).toBe(true);
		expect((await getLeague(leagueId))?.ownerUserId).toBe(newOwner);
		expect((await getLeagueMember({ leagueId, memberUserId: newOwner }))?.role).toBe('owner');
		expect((await getLeagueMember({ leagueId, memberUserId: ownerId }))?.role).toBe('admin');
	});

	test('refuses non-owners, non-members and self-transfer', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();
		const outsider = await createTestUser();
		const member = await createTestUser();

		await joinLeagueByInvite({ inviteCode, userId: member });

		expect(
			(await transferLeagueOwnership({ leagueId, callerId: ownerId, newOwnerUserId: ownerId }))
				.reason
		).toBe('new_owner_is_caller');
		expect(
			(await transferLeagueOwnership({ leagueId, callerId: member, newOwnerUserId: member })).reason
		).toBe('new_owner_is_caller');
		expect(
			(await transferLeagueOwnership({ leagueId, callerId: outsider, newOwnerUserId: member }))
				.reason
		).toBe('not_owner');
		expect(
			(await transferLeagueOwnership({ leagueId, callerId: ownerId, newOwnerUserId: outsider }))
				.reason
		).toBe('new_owner_not_member');
	});

	test('disband drops the league and every membership row; only the owner can', async () => {
		const { ownerId, leagueId, inviteCode } = await seedLeague();
		const member = await createTestUser();

		await joinLeagueByInvite({ inviteCode, userId: member });

		expect((await deleteLeague({ leagueId, callerId: member })).reason).toBe('not_owner');

		const result = await deleteLeague({ leagueId, callerId: ownerId });

		expect(result.ok).toBe(true);
		expect(await getLeague(leagueId)).toBeUndefined();
		expect(await listLeagueMembers(leagueId)).toEqual([]);

		// Idempotent: disbanding an already-gone league is a clean success.
		expect((await deleteLeague({ leagueId, callerId: ownerId })).ok).toBe(true);
	});
});
