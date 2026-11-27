import {
	VXP_CALL_SIZE_LADDER,
	VXP_DEFAULT_CALL_SIZE
} from '#lib/constants/vxp-economy.constants.ts';
import { callSizeStopIndex, callSizeStops } from '#lib/utils/vxp-economy.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('vxp-economy.utils call-size stops', () => {
	it('reads the stops from the economy ladder, smallest first', () => {
		assert.deepEqual(callSizeStops(), VXP_CALL_SIZE_LADDER);
		assert.deepEqual(
			[...callSizeStops()].sort((a, b) => a - b),
			[...callSizeStops()]
		);
	});

	it('places every stop at its own index', () => {
		callSizeStops().forEach((value, index) => {
			assert.equal(callSizeStopIndex({ value }), index);
		});
	});

	it('places the default call size on a stop', () => {
		assert.equal(
			callSizeStops()[callSizeStopIndex({ value: VXP_DEFAULT_CALL_SIZE })],
			VXP_DEFAULT_CALL_SIZE
		);
	});

	it('snaps an off-ladder value to the nearest stop', () => {
		const stops = callSizeStops();
		const last = stops.length - 1;

		assert.equal(callSizeStopIndex({ value: stops[last] * 10 }), last);
		assert.equal(callSizeStopIndex({ value: -1 }), 0);
		assert.equal(
			callSizeStopIndex({ value: Number.NaN }),
			callSizeStopIndex({ value: VXP_DEFAULT_CALL_SIZE })
		);
	});
});
