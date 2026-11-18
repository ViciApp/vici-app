import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { onProfileSetForStreakAward } from '#satellite/services/vxp-streak-awards.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const profileWrite = ({ prev, next }: { prev: number; next: number }): OnSetDocContext => {
	const doc = (dailyStreak: number) => ({
		owner: user.toUint8Array(),
		data: docBytes({ dailyStreak }),
		created_at: 1n,
		updated_at: 1n,
		version: 1n
	});

	return {
		caller: user.toUint8Array(),
		data: {
			collection: Collection.PROFILES,
			key: user.toText(),
			data: { before: doc(prev), after: doc(next) }
		}
	};
};

describe('onProfileSetForStreakAward', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});
	});

	afterEach(() => host.restore());

	it('records a crossed milestone as paid through the vxp_awards assert', async () => {
		await onProfileSetForStreakAward(profileWrite({ prev: 2, next: 3 }));

		const key = vxpAwardKey({
			recipient: user.toText(),
			awardType: 'streak',
			awardKey: 'streak_3'
		});
		const award = host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key });

		assert.deepEqual(host.calls(), ['icrc1_transfer']);
		assert.equal(award?.status, 'paid');
		assert.equal(award?.blockIndex, '7');
	});
});
