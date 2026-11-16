import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { assertDeleteVxpAward } from '#satellite/services/vxp-awards.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext } from '@junobuild/functions';
import type { AccessKeys } from '@junobuild/functions/sdk';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const controller = Principal.fromUint8Array(new Uint8Array([1, 1, 1]));
const recipient = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const stranger = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const award: VxpAwardDoc = {
	recipient: recipient.toText(),
	awardType: 'streak',
	awardKey: 'streak_7',
	amountBaseUnits: '500000',
	status: 'paid',
	earnedAtMs: 1_700_000_000_000,
	paidAtMs: 1_700_000_001_000,
	blockIndex: '42'
};

const deleteContext = ({
	caller,
	collection = Collection.VXP_AWARDS
}: {
	caller: Principal;
	collection?: string;
}): AssertDeleteDocContext => ({
	caller: caller.toUint8Array(),
	data: {
		collection,
		key: vxpAwardKey({
			recipient: award.recipient,
			awardType: award.awardType,
			awardKey: award.awardKey
		}),
		data: {
			current: {
				owner: recipient.toUint8Array(),
				data: new TextEncoder().encode(JSON.stringify(award)),
				created_at: 1n,
				updated_at: 1n,
				version: 1n
			},
			proposed: { version: 1n }
		}
	}
});

// The satellite host binding `getAdminAccessKeys()` reads; Node has no host.
const hostGlobal = '__juno_satellite_get_admin_access_keys';

describe('vxp-awards.services', () => {
	beforeEach(() => {
		const accessKeys: AccessKeys = [
			[controller.toUint8Array(), { metadata: [], created_at: 1n, updated_at: 1n, scope: 'admin' }]
		];

		Object.defineProperty(globalThis, hostGlobal, {
			value: () => accessKeys,
			configurable: true,
			writable: true
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, hostGlobal);
	});

	describe('assertDeleteVxpAward', () => {
		it('rejects the recipient deleting their own award doc', () => {
			assert.throws(
				() => assertDeleteVxpAward(deleteContext({ caller: recipient })),
				/cannot be deleted/
			);
		});

		it('rejects any other user deleting an award doc', () => {
			assert.throws(
				() => assertDeleteVxpAward(deleteContext({ caller: stranger })),
				/cannot be deleted/
			);
		});

		it('lets a satellite controller delete an award doc', () => {
			assert.doesNotThrow(() => assertDeleteVxpAward(deleteContext({ caller: controller })));
		});

		it('ignores other collections', () => {
			assert.doesNotThrow(() =>
				assertDeleteVxpAward(
					deleteContext({ caller: recipient, collection: Collection.LEAGUE_MEMBERS })
				)
			);
		});
	});
});
