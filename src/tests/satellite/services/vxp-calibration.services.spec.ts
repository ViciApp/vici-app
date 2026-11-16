import { Collection } from '#lib/constants/collections.constants.ts';
import { calibrationAttemptKey } from '#lib/types/calibration.ts';
import {
	hostNowMs,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { judgeCalibrationCall } from '#satellite/services/vxp-calibration.services.ts';
import { Principal } from '@icp-sdk/core/principal';
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
