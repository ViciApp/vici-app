import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	docBytes,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { persistAward } from '#satellite/services/vxp-awards.services.ts';
import { onProfileSetForStreakAward } from '#satellite/services/vxp-streak-awards.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerIdl, type IcrcLedgerDid } from '@junobuild/functions/canisters/ledger/icrc';
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

const streak3Key = vxpAwardKey({
	recipient: user.toText(),
	awardType: 'streak',
	awardKey: 'streak_3'
});

describe('onProfileSetForStreakAward', () => {
	let host: SatelliteHost;

	const streak3 = (): VxpAwardDoc | undefined =>
		host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key: streak3Key });

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

	it('sends a failed milestone again, with the same memo, once the ledger accepts it', async () => {
		const memos: string[] = [];
		let answer: IcrcLedgerDid.TransferResult = {
			Err: { InsufficientFunds: { balance: BigInt(0) } }
		};

		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: (args) => {
				const [{ memo }] = args as [IcrcLedgerDid.TransferArg];
				memos.push(new TextDecoder().decode(Uint8Array.from(memo[0] ?? [])));

				return answer;
			}
		});

		await onProfileSetForStreakAward(profileWrite({ prev: 2, next: 3 }));

		assert.equal(streak3()?.status, 'failed');

		answer = { Ok: BigInt(9) };

		// The streak broke and climbed back over the milestone.
		await onProfileSetForStreakAward(profileWrite({ prev: 2, next: 3 }));

		const award = streak3();

		assert.equal(award?.status, 'paid');
		assert.equal(award?.blockIndex, '9');
		assert.equal(award?.amountBaseUnits, '500000');
		assert.equal(award?.errorMessage, undefined);
		assert.deepEqual(memos, ['vxp:streak:streak_3', 'vxp:streak:streak_3']);
	});

	it('never sends a pending milestone again, since its transfer may have landed', async () => {
		persistAward({
			recipient: user.toText(),
			awardType: 'streak',
			awardKey: 'streak_3',
			doc: {
				recipient: user.toText(),
				awardType: 'streak',
				awardKey: 'streak_3',
				amountBaseUnits: '500000',
				status: 'pending',
				earnedAtMs: 1
			}
		});

		await onProfileSetForStreakAward(profileWrite({ prev: 2, next: 3 }));

		assert.deepEqual(host.calls(), []);
		assert.equal(streak3()?.status, 'pending');
	});
});
