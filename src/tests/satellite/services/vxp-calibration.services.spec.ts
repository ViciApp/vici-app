import { Collection } from '#lib/constants/collections.constants.ts';
import { calibrationAttemptKey } from '#lib/types/calibration.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import {
	hostNowMs,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { persistAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import {
	claimCalibrationRewardFn,
	judgeCalibrationCall
} from '#satellite/services/vxp-calibration.services.ts';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const caller = Principal.fromUint8Array(new Uint8Array([2, 2, 2])).toText();
const seriesId = 'series-1';

describe('vxp-calibration.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('judgeCalibrationCall', () => {
		const judge = (chosenSide: 'YES' | 'NO') =>
			judgeCalibrationCall({ recipient: caller, seriesId, chosenSide, winningSide: 'YES' });

		it('records a miss on the first, wrong call', () => {
			assert.equal(judge('NO'), 'miss');
			assert.deepEqual(
				host.readDoc({
					collection: Collection.CALIBRATION_ATTEMPTS,
					key: calibrationAttemptKey({ recipient: caller, seriesId })
				}),
				{ chosenSide: 'NO', calledAtMs: hostNowMs }
			);
		});

		it('refuses a call on the other side after a miss', () => {
			judge('NO');

			assert.equal(judge('YES'), 'already_called');
		});

		it('keeps judging the side on record', () => {
			judge('NO');

			assert.equal(judge('NO'), 'miss');
		});

		it('judges a correct first call, and the same call again', () => {
			assert.equal(judge('YES'), 'correct');
			assert.equal(judge('YES'), 'correct');
		});
	});
});

describe('claimCalibrationRewardFn', () => {
	let host: SatelliteHost;

	const award: VxpAwardDoc = {
		recipient: caller,
		awardType: 'calibration',
		awardKey: seriesId,
		amountBaseUnits: '250000',
		status: 'pending',
		earnedAtMs: hostNowMs
	};
	const key = vxpAwardKey(award);

	const earn = () =>
		persistAward({ recipient: caller, awardType: 'calibration', awardKey: seriesId, doc: award });

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.setCaller(Principal.fromText(caller));
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(11) })
		});
		host.onCall({
			method: 'icrc1_balance_of',
			argTypes: [IcrcLedgerIdl.Account],
			result: IDL.Nat,
			handler: () => BigInt(250_000)
		});
	});

	afterEach(() => host.restore());

	it('sends a failed reward again at its recorded amount', async () => {
		earn();
		updateAward({
			recipient: caller,
			awardType: 'calibration',
			awardKey: seriesId,
			patch: { status: 'failed', errorMessage: 'InsufficientFunds(balance=0)' }
		});

		const result = await claimCalibrationRewardFn({ seriesId, chosenSide: 'YES' });

		assert.equal(result.paidNow, true);
		assert.equal(result.rewardBaseUnits, '250000');
		assert.deepEqual(host.calls(), ['icrc1_transfer', 'icrc1_balance_of']);
		assert.equal(
			host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key })?.status,
			'paid'
		);
	});

	it('never sends a pending reward again', async () => {
		earn();

		const result = await claimCalibrationRewardFn({ seriesId, chosenSide: 'YES' });

		assert.deepEqual(result, { correct: true, paidNow: false, alreadyClaimed: true });
		assert.deepEqual(host.calls(), []);
		assert.equal(
			host.readDoc<VxpAwardDoc>({ collection: Collection.VXP_AWARDS, key })?.status,
			'pending'
		);
	});
});
