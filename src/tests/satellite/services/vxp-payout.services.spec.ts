import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import {
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { persistAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import { settleProfileAwardsFn } from '#satellite/services/vxp-payout.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl, type IcrcLedgerDid } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const recipient = user.toText();

describe('settleProfileAwardsFn', () => {
	let host: SatelliteHost;
	let memos: string[];

	const earn = ({
		awardType,
		awardKey,
		failed
	}: {
		awardType: VxpAwardType;
		awardKey: string;
		failed: boolean;
	}) => {
		persistAward({
			recipient,
			awardType,
			awardKey,
			doc: {
				recipient,
				awardType,
				awardKey,
				amountBaseUnits: '500000',
				status: 'pending',
				earnedAtMs: 1
			}
		});

		if (failed) {
			updateAward({
				recipient,
				awardType,
				awardKey,
				patch: { status: 'failed', errorMessage: 'InsufficientFunds(balance=0)' }
			});
		}
	};

	const status = ({ awardType, awardKey }: { awardType: VxpAwardType; awardKey: string }) =>
		host.readDoc<VxpAwardDoc>({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey({ recipient, awardType, awardKey })
		})?.status;

	beforeEach(() => {
		memos = [];
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.setCaller(user);
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: (args) => {
				const [{ memo }] = args as [IcrcLedgerDid.TransferArg];
				memos.push(new TextDecoder().decode(Uint8Array.from(memo[0] ?? [])));

				return { Ok: BigInt(5) };
			}
		});
	});

	afterEach(() => host.restore());

	it('sends failed achievement and Flow milestone payouts again, a few per call', async () => {
		earn({ awardType: 'achievement', awardKey: 'oracle', failed: true });
		earn({ awardType: 'achievement', awardKey: 'sharp', failed: true });
		earn({ awardType: 'flow_milestone', awardKey: '10', failed: true });

		assert.equal(await settleProfileAwardsFn(), 2);
		assert.equal(await settleProfileAwardsFn(), 1);
		assert.equal(await settleProfileAwardsFn(), 0);

		assert.equal(status({ awardType: 'achievement', awardKey: 'oracle' }), 'paid');
		assert.equal(status({ awardType: 'achievement', awardKey: 'sharp' }), 'paid');
		assert.equal(status({ awardType: 'flow_milestone', awardKey: '10' }), 'paid');
		assert.deepEqual(memos.sort(), [
			'vxp:achievement:oracle',
			'vxp:achievement:sharp',
			'vxp:flow_milestone:10'
		]);
	});

	it('never sends a pending payout or another type again, and pays no anonymous caller', async () => {
		earn({ awardType: 'achievement', awardKey: 'oracle', failed: false });
		earn({ awardType: 'streak', awardKey: 'streak_3', failed: true });

		assert.equal(await settleProfileAwardsFn(), 0);
		assert.deepEqual(host.calls(), []);
		assert.equal(status({ awardType: 'achievement', awardKey: 'oracle' }), 'pending');
		assert.equal(status({ awardType: 'streak', awardKey: 'streak_3' }), 'failed');

		host.setCaller(Principal.anonymous());

		assert.equal(await settleProfileAwardsFn(), 0);
	});
});
