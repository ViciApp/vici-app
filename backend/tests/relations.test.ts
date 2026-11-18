// Friendship state machine: every transition of the request lifecycle,
// the crossing-request auto-accept, the rejected-sender cooldown, and the
// follow edges.

import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import {
	acceptFriendRequest,
	cancelFriendRequest,
	checkFriendship,
	followUser,
	FRIEND_REQUEST_REJECTED_COOLDOWN_MS,
	friendRelationKey,
	listFollowers,
	listFollowing,
	listFriendRequests,
	listFriends,
	listSentFriendRequests,
	rejectFriendRequest,
	sendFriendRequest,
	unfollowUser,
	unfriendUser
} from '../src/social/relations';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

describe.if(dbAvailable)('friendship state machine', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('send creates a pending request visible to both sides', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();

		const outcome = await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(outcome).toEqual({ status: 'sent' });

		const incoming = await listFriendRequests(bob);
		const sent = await listSentFriendRequests(alice);
		const key = friendRelationKey(alice, bob);

		expect(incoming.some((r) => r.key === key)).toBe(true);
		expect(sent.some((r) => r.key === key)).toBe(true);
		expect(await checkFriendship({ userA: alice, userB: bob })).toBe(false);
	});

	test('a duplicate send reports already_pending', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();

		await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(await sendFriendRequest({ senderId: alice, targetId: bob })).toEqual({
			status: 'already_pending'
		});
	});

	test('a crossing request auto-accepts instead of erroring', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();

		await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(await sendFriendRequest({ senderId: bob, targetId: alice })).toEqual({
			status: 'auto_accepted'
		});
		expect(await checkFriendship({ userA: alice, userB: bob })).toBe(true);
	});

	test('accept activates the friendship; only the recipient may accept', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const key = friendRelationKey(alice, bob);

		await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(acceptFriendRequest({ relationId: key, callerId: alice })).rejects.toThrow(
			'Only the recipient'
		);

		await acceptFriendRequest({ relationId: key, callerId: bob });

		expect(await checkFriendship({ userA: alice, userB: bob })).toBe(true);
		expect((await listFriends(alice)).some((r) => r.key === key)).toBe(true);
		expect((await listFriends(bob)).some((r) => r.key === key)).toBe(true);

		expect(await sendFriendRequest({ senderId: alice, targetId: bob })).toEqual({
			status: 'already_friends'
		});
	});

	test('reject blocks the rejected sender behind the cooldown', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const key = friendRelationKey(alice, bob);

		await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(rejectFriendRequest({ relationId: key, callerId: alice })).rejects.toThrow(
			'Only the recipient'
		);

		await rejectFriendRequest({ relationId: key, callerId: bob });

		const retry = await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(retry.status).toBe('rejected_cooldown');

		if (retry.status === 'rejected_cooldown') {
			const expected = Date.now() + FRIEND_REQUEST_REJECTED_COOLDOWN_MS;

			expect(Math.abs(retry.retryAtMs - expected)).toBeLessThan(60_000);
		}
	});

	test('the rejecter may re-initiate immediately', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const key = friendRelationKey(alice, bob);

		await sendFriendRequest({ senderId: alice, targetId: bob });
		await rejectFriendRequest({ relationId: key, callerId: bob });

		expect(await sendFriendRequest({ senderId: bob, targetId: alice })).toEqual({
			status: 'sent'
		});
		expect((await listFriendRequests(alice)).some((r) => r.key === key)).toBe(true);
	});

	test('the rejected sender may retry after the cooldown', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const key = friendRelationKey(alice, bob);

		await sendFriendRequest({ senderId: alice, targetId: bob });
		await rejectFriendRequest({ relationId: key, callerId: bob });

		// Age the rejection past the window.
		await query(`update relations set updated_at = now() - interval '8 days' where key = $1`, [
			key
		]);

		expect(await sendFriendRequest({ senderId: alice, targetId: bob })).toEqual({
			status: 'sent'
		});
	});

	test('cancel removes a pending request; guarded by sender and state', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const key = friendRelationKey(alice, bob);

		await sendFriendRequest({ senderId: alice, targetId: bob });

		expect(cancelFriendRequest({ relationId: key, callerId: bob })).rejects.toThrow(
			'Only the sender'
		);

		await cancelFriendRequest({ relationId: key, callerId: alice });

		expect((await listSentFriendRequests(alice)).some((r) => r.key === key)).toBe(false);

		// After an accept there is nothing pending left to cancel.
		await sendFriendRequest({ senderId: alice, targetId: bob });
		await acceptFriendRequest({ relationId: key, callerId: bob });

		expect(cancelFriendRequest({ relationId: key, callerId: alice })).rejects.toThrow(
			'Cannot cancel a request in state "ACTIVE"'
		);
	});

	test('cancel of a missing relation errors', async () => {
		const alice = await createTestUser();

		expect(cancelFriendRequest({ relationId: 'missing#missing', callerId: alice })).rejects.toThrow(
			'Relation does not exist'
		);
	});

	test('sending to yourself is rejected', async () => {
		const alice = await createTestUser();

		expect(sendFriendRequest({ senderId: alice, targetId: alice })).rejects.toThrow('yourself');
	});

	test('unfriend removes the active friendship', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const key = friendRelationKey(alice, bob);

		await sendFriendRequest({ senderId: alice, targetId: bob });
		await acceptFriendRequest({ relationId: key, callerId: bob });
		await unfriendUser({ callerId: bob, targetId: alice });

		expect(await checkFriendship({ userA: alice, userB: bob })).toBe(false);
	});
});

describe.if(dbAvailable)('follow edges', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('follow is directed and idempotent; unfollow removes the edge', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();

		await followUser({ senderId: alice, targetId: bob });
		await followUser({ senderId: alice, targetId: bob });

		const following = await listFollowing(alice);
		const followers = await listFollowers(bob);

		expect(following.filter((r) => r.participants[1] === bob)).toHaveLength(1);
		expect(followers.filter((r) => r.participants[0] === alice)).toHaveLength(1);

		// The reverse direction is a separate edge.
		expect((await listFollowing(bob)).some((r) => r.participants[1] === alice)).toBe(false);

		await unfollowUser({ senderId: alice, targetId: bob });

		expect((await listFollowing(alice)).some((r) => r.participants[1] === bob)).toBe(false);
	});

	test('only the follower can remove their edge', async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();

		await followUser({ senderId: alice, targetId: bob });

		expect(unfollowUser({ senderId: bob, targetId: alice })).rejects.toThrow(
			'Relation does not exist'
		);
	});
});
