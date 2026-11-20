import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	assertDeleteVxpAward,
	assertSetVxpAward,
	persistAward,
	reclaimAward,
	updateAward
} from '#satellite/services/vxp-awards.services.ts';
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

describe('reclaimAward', () => {
	let host: SatelliteHost;

	const pending: VxpAwardDoc = {
		recipient: recipient.toText(),
		awardType: 'streak',
		awardKey: 'streak_7',
		amountBaseUnits: '500000',
		status: 'pending',
		earnedAtMs: 1_700_000_000_000
	};
	const { recipient: recipientText, awardType, awardKey } = pending;
	const key = vxpAwardKey(pending);

	const stored = (): VxpAwardDoc | undefined =>
		host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key });

	const settle = (patch: Partial<VxpAwardDoc> & Pick<VxpAwardDoc, 'status'>) =>
		updateAward({ recipient: recipientText, awardType, awardKey, patch });

	beforeEach(() => {
		host = installSatelliteHost({ asserts: { set: assertSetVxpAward } });
	});

	afterEach(() => host.restore());

	it('leaves a key with no award free for a first payout', () => {
		assert.deepEqual(reclaimAward({ recipient: recipientText, awardType, awardKey }), {
			kind: 'free'
		});
	});

	it('holds a pending award, whose transfer may have landed', () => {
		persistAward({ recipient: recipientText, awardType, awardKey, doc: pending });

		assert.deepEqual(reclaimAward({ recipient: recipientText, awardType, awardKey }), {
			kind: 'held'
		});
		assert.deepEqual(stored(), pending);
	});

	it('holds a paid award', () => {
		persistAward({ recipient: recipientText, awardType, awardKey, doc: pending });
		settle({ status: 'paid', paidAtMs: 1_700_000_001_000, blockIndex: '42' });

		assert.deepEqual(reclaimAward({ recipient: recipientText, awardType, awardKey }), {
			kind: 'held'
		});
		assert.equal(stored()?.status, 'paid');
	});

	it('moves a failed award back to pending at its recorded amount', () => {
		persistAward({ recipient: recipientText, awardType, awardKey, doc: pending });
		settle({ status: 'failed', errorMessage: 'InsufficientFunds(balance=0)' });

		assert.deepEqual(reclaimAward({ recipient: recipientText, awardType, awardKey }), {
			kind: 'retry',
			doc: pending
		});
		assert.deepEqual(stored(), pending);
	});

	it('lets only one of two retries claim a failed award', () => {
		persistAward({ recipient: recipientText, awardType, awardKey, doc: pending });
		settle({ status: 'failed', errorMessage: 'InsufficientFunds(balance=0)' });

		assert.equal(reclaimAward({ recipient: recipientText, awardType, awardKey }).kind, 'retry');
		assert.equal(reclaimAward({ recipient: recipientText, awardType, awardKey }).kind, 'held');
	});
});

describe('assertSetVxpAward', () => {
	let host: SatelliteHost;

	const pending: VxpAwardDoc = {
		recipient: recipient.toText(),
		awardType: 'streak',
		awardKey: 'streak_7',
		amountBaseUnits: '500000',
		status: 'pending',
		earnedAtMs: 1_700_000_000_000
	};
	const key = vxpAwardKey(pending);

	const write = ({
		caller,
		proposed,
		current
	}: {
		caller: Principal;
		proposed: VxpAwardDoc;
		current?: VxpAwardDoc;
	}) =>
		assertSetVxpAward(
			setContext({
				caller,
				collection: Collection.VXP_AWARDS,
				key: vxpAwardKey(proposed),
				proposed,
				current,
				currentOwner: controller
			})
		);

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	it('rejects the recipient creating an award doc for themselves', () => {
		assert.throws(
			() => write({ caller: recipient, proposed: { ...pending, amountBaseUnits: '999999999' } }),
			/only the satellite writes/
		);
	});

	it('rejects the recipient marking their pending award paid', () => {
		assert.throws(
			() =>
				write({
					caller: recipient,
					current: pending,
					proposed: { ...pending, status: 'paid', paidAtMs: 1, blockIndex: '123456' }
				}),
			/only the satellite writes/
		);
	});

	it('rejects the recipient failing their own in-flight award', () => {
		assert.throws(
			() =>
				write({
					caller: recipient,
					current: pending,
					proposed: { ...pending, status: 'failed', errorMessage: 'nope' }
				}),
			/only the satellite writes/
		);
	});

	it('lets a satellite controller create a pending award and settle it', () => {
		assert.doesNotThrow(() => write({ caller: controller, proposed: pending }));
		assert.doesNotThrow(() =>
			write({
				caller: controller,
				current: pending,
				proposed: { ...pending, status: 'paid', paidAtMs: 1, blockIndex: '1' }
			})
		);
	});

	it('lets a satellite controller move a failed award back to pending, and nowhere else', () => {
		const failed: VxpAwardDoc = { ...pending, status: 'failed', errorMessage: 'x' };

		assert.doesNotThrow(() => write({ caller: controller, current: failed, proposed: pending }));
		assert.throws(
			() =>
				write({
					caller: controller,
					current: failed,
					proposed: { ...pending, status: 'paid', paidAtMs: 1, blockIndex: '1' }
				}),
			/failed → pending/
		);
		assert.throws(
			() =>
				write({ caller: controller, current: failed, proposed: { ...pending, blockIndex: '1' } }),
			/failed → pending/
		);
	});

	it('still holds a controller to the key shape and the lifecycle', () => {
		assert.throws(
			() =>
				assertSetVxpAward(
					setContext({
						caller: controller,
						collection: Collection.VXP_AWARDS,
						key: `${key}x`,
						proposed: pending
					})
				),
			/key mismatch/
		);
		assert.throws(
			() => write({ caller: controller, proposed: { ...pending, status: 'paid' } }),
			/start with status="pending"/
		);
		assert.throws(
			() =>
				write({
					caller: controller,
					current: { ...pending, status: 'paid', paidAtMs: 1, blockIndex: '1' },
					proposed: { ...pending, status: 'failed', errorMessage: 'x' }
				}),
			/terminal/
		);
	});
});
