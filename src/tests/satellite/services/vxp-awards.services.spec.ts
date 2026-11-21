import { Collection } from '#lib/constants/collections.constants.ts';
import type { AnalyticsEventDoc } from '#lib/types/analytics-event.ts';
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
	updateAward
} from '#satellite/services/vxp-awards.services.ts';
import { nonNullish } from '@dfinity/utils';
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

describe('updateAward', () => {
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

	const events = (): AnalyticsEventDoc[] =>
		host
			.keys(Collection.EVENTS)
			.map((key) => host.readDoc<AnalyticsEventDoc>({ collection: Collection.EVENTS, key }))
			.filter(nonNullish);

	const pay = () =>
		updateAward({
			recipient: recipientText,
			awardType,
			awardKey,
			patch: { status: 'paid', paidAtMs: 1_700_000_001_000, blockIndex: '42' }
		});

	beforeEach(() => {
		host = installSatelliteHost({ asserts: { set: assertSetVxpAward } });
		persistAward({ recipient: recipientText, awardType, awardKey, doc: pending });
	});

	afterEach(() => host.restore());

	it('captures the payout and the streak milestone when the award is paid', () => {
		pay();

		assert.deepEqual(
			events().map(({ name, principal, props }) => ({ name, principal, props })),
			[
				{ name: 'vxp_awarded', principal: recipientText, props: { value: 50, label: 'streak' } },
				{ name: 'streak_milestone', principal: recipientText, props: { step: 7 } }
			]
		);
	});

	it('captures nothing when the payout fails', () => {
		updateAward({
			recipient: recipientText,
			awardType,
			awardKey,
			patch: { status: 'failed', errorMessage: 'ledger down' }
		});

		assert.deepEqual(events(), []);
	});
});
