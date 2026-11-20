import { Collection } from '#lib/constants/collections.constants.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import type { Relation } from '#lib/types/relation.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	acceptFriendRequest,
	assertDeleteRelation,
	assertSetRelation,
	followUser,
	rejectFriendRequest,
	sendFriendRequest
} from '#satellite/services/relation.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const sender = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const recipient = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const stranger = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const relationId = [sender.toText(), recipient.toText()].sort().join('#');

const relation = (state: RelationState): Relation => ({
	category: RelationCategory.FRIEND,
	state,
	participants: [sender.toText(), recipient.toText()]
});

describe('relation.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertSetRelation', () => {
		const forceFriendship = (caller: Principal) =>
			setContext({
				caller,
				collection: Collection.RELATIONS,
				key: relationId,
				proposed: relation(RelationState.ACTIVE)
			});

		it('rejects a client writing a friendship directly', () => {
			assert.throws(() => assertSetRelation(forceFriendship(sender)), /only the satellite writes/);
		});

		it('lets a satellite controller write a relation', () => {
			assert.doesNotThrow(() => assertSetRelation(forceFriendship(controller)));
		});
	});

	describe('assertDeleteRelation', () => {
		const remove = ({ caller, state }: { caller: Principal; state: RelationState }) =>
			deleteContext({
				caller,
				collection: Collection.RELATIONS,
				key: relationId,
				current: relation(state),
				currentOwner: sender
			});

		it('rejects a non-participant deleting a relation', () => {
			assert.throws(
				() => assertDeleteRelation(remove({ caller: stranger, state: RelationState.ACTIVE })),
				/relations/
			);
		});

		it('lets either participant end an active relation', () => {
			assert.doesNotThrow(() =>
				assertDeleteRelation(remove({ caller: sender, state: RelationState.ACTIVE }))
			);
			assert.doesNotThrow(() =>
				assertDeleteRelation(remove({ caller: recipient, state: RelationState.ACTIVE }))
			);
		});

		it('lets only the sender withdraw a pending request', () => {
			assert.doesNotThrow(() =>
				assertDeleteRelation(remove({ caller: sender, state: RelationState.PENDING }))
			);
			assert.throws(
				() => assertDeleteRelation(remove({ caller: recipient, state: RelationState.PENDING })),
				/relations/
			);
		});

		it('keeps a rejection or a block out of reach of the participants', () => {
			for (const state of [RelationState.REJECTED, RelationState.BLOCKED]) {
				assert.throws(() => assertDeleteRelation(remove({ caller: sender, state })), /relations/);
				assert.throws(
					() => assertDeleteRelation(remove({ caller: recipient, state })),
					/relations/
				);
			}
		});

		it('lets a satellite controller delete any relation', () => {
			assert.doesNotThrow(() =>
				assertDeleteRelation(remove({ caller: controller, state: RelationState.BLOCKED }))
			);
		});
	});

	describe('relation endpoints', () => {
		const followId = `follow#${sender.toText()}#${recipient.toText()}`;

		const follow: Relation = {
			category: RelationCategory.FOLLOW,
			state: RelationState.ACTIVE,
			participants: [sender.toText(), recipient.toText()]
		};

		const seed = ({ key, data }: { key: string; data: Relation }) =>
			host.putDoc({ collection: Collection.RELATIONS, key, data, owner: controller });

		const stored = (key: string) =>
			host.readDoc<Relation>({ collection: Collection.RELATIONS, key });

		it('lets the recipient accept a pending friend request', () => {
			seed({ key: relationId, data: relation(RelationState.PENDING) });
			host.setCaller(recipient);

			acceptFriendRequest({ relationId });

			assert.equal(stored(relationId)?.state, RelationState.ACTIVE);
		});

		it('lets the recipient reject a pending friend request', () => {
			seed({ key: relationId, data: relation(RelationState.PENDING) });
			host.setCaller(recipient);

			rejectFriendRequest({ relationId });

			assert.equal(stored(relationId)?.state, RelationState.REJECTED);
		});

		it('refuses to reject or accept a follow', () => {
			seed({ key: followId, data: follow });
			host.setCaller(recipient);

			assert.throws(() => rejectFriendRequest({ relationId: followId }), /pending friend request/);
			assert.throws(() => acceptFriendRequest({ relationId: followId }), /pending friend request/);
			assert.deepEqual(stored(followId), follow);
		});

		it('refuses to turn an active friendship into a rejection', () => {
			seed({ key: relationId, data: relation(RelationState.ACTIVE) });
			host.setCaller(recipient);

			assert.throws(() => rejectFriendRequest({ relationId }), /pending friend request/);
			assert.equal(stored(relationId)?.state, RelationState.ACTIVE);
		});

		it('refuses to accept a rejected request', () => {
			seed({ key: relationId, data: relation(RelationState.REJECTED) });
			host.setCaller(recipient);

			assert.throws(() => acceptFriendRequest({ relationId }), /pending friend request/);
			assert.equal(stored(relationId)?.state, RelationState.REJECTED);
		});

		it('refuses a friend request or a follow to oneself or the anonymous principal', () => {
			host.setCaller(sender);

			for (const target of [sender.toText(), Principal.anonymous().toText()]) {
				assert.throws(() => sendFriendRequest({ target }), /another account/);
				assert.throws(() => followUser({ target }), /another account/);
			}

			assert.deepEqual(host.keys(Collection.RELATIONS), []);
		});

		it('refuses an anonymous caller', () => {
			host.setCaller(Principal.anonymous());

			assert.throws(() => sendFriendRequest({ target: recipient.toText() }), /Sign in/);
			assert.throws(() => followUser({ target: recipient.toText() }), /Sign in/);
			assert.deepEqual(host.keys(Collection.RELATIONS), []);
		});
	});
});
