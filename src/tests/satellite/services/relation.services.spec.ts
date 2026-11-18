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
import { assertDeleteRelation, assertSetRelation } from '#satellite/services/relation.services.ts';
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
});
