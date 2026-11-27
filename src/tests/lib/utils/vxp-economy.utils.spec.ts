import {
	VXP_CALL_SIZE_STEP,
	VXP_DEFAULT_CALL_SIZE,
	VXP_MAX_CALL_SIZE,
	VXP_MIN_CALL_SIZE,
	VXP_P_WIN_FLOOR
} from '#lib/constants/vxp-economy.constants.ts';
import {
	assertViciXpHumanPremium,
	callSizeStopIndex,
	callSizeStops,
	clampVxpCallSize,
	vxpNetWin
} from '#lib/utils/vxp-economy.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('clampVxpCallSize', () => {
	it('opens at the default when no size is stored or the value is not usable', () => {
		for (const value of [Number('0'), Number(''), Number.NaN, Number.POSITIVE_INFINITY, -20]) {
			assert.equal(clampVxpCallSize({ value }), VXP_DEFAULT_CALL_SIZE, `${value}`);
		}
	});

	it('restores a size stored above the maximum at the maximum', () => {
		assert.equal(clampVxpCallSize({ value: 300 }), VXP_MAX_CALL_SIZE);
		assert.equal(clampVxpCallSize({ value: 500 }), VXP_MAX_CALL_SIZE);
	});

	it('raises a positive size below the minimum to the minimum', () => {
		assert.equal(clampVxpCallSize({ value: 1 }), VXP_MIN_CALL_SIZE);
		assert.equal(clampVxpCallSize({ value: VXP_MIN_CALL_SIZE / 2 }), VXP_MIN_CALL_SIZE);
	});

	it('rounds a size between two steps to the nearest step', () => {
		const base = VXP_DEFAULT_CALL_SIZE;

		assert.equal(clampVxpCallSize({ value: base + VXP_CALL_SIZE_STEP * 0.4 }), base);
		assert.equal(
			clampVxpCallSize({ value: base + VXP_CALL_SIZE_STEP * 0.6 }),
			base + VXP_CALL_SIZE_STEP
		);
	});

	it('keeps every valid size as it is', () => {
		for (let size = VXP_MIN_CALL_SIZE; size <= VXP_MAX_CALL_SIZE; size += VXP_CALL_SIZE_STEP) {
			assert.equal(clampVxpCallSize({ value: size }), size);
		}
	});
});

describe('vxpNetWin', () => {
	it('floors the win probability, so a long shot pays a bounded multiple', () => {
		const multiple = 1 / VXP_P_WIN_FLOOR - 1;

		for (const amount of [VXP_MIN_CALL_SIZE, VXP_MAX_CALL_SIZE]) {
			assert.equal(vxpNetWin({ amount, pWin: VXP_P_WIN_FLOOR / 5 }), amount * multiple);
			assert.equal(
				vxpNetWin({ amount, pWin: VXP_P_WIN_FLOOR / 5 }),
				vxpNetWin({ amount, pWin: VXP_P_WIN_FLOOR })
			);
		}
	});

	it('pays the raw net above the floor, below one VXP on a heavy favourite', () => {
		assert.equal(vxpNetWin({ amount: VXP_MAX_CALL_SIZE, pWin: 0.5 }), VXP_MAX_CALL_SIZE);
		assert.ok(vxpNetWin({ amount: VXP_MIN_CALL_SIZE, pWin: 0.99 }) < 1);
	});
});

describe('assertViciXpHumanPremium', () => {
	it('passes every valid call size, as typed or padded', () => {
		for (let size = VXP_MIN_CALL_SIZE; size <= VXP_MAX_CALL_SIZE; size += VXP_CALL_SIZE_STEP) {
			assert.doesNotThrow(() => assertViciXpHumanPremium({ amountStr: String(size) }));
		}

		assert.doesNotThrow(() =>
			assertViciXpHumanPremium({ amountStr: ` ${VXP_DEFAULT_CALL_SIZE} ` })
		);
	});

	it('throws outside the range, off the step, for a fraction and for no amount', () => {
		for (const amountStr of [
			String(VXP_MIN_CALL_SIZE - VXP_CALL_SIZE_STEP),
			String(VXP_MAX_CALL_SIZE + VXP_CALL_SIZE_STEP),
			String(VXP_MIN_CALL_SIZE + 1),
			`${VXP_DEFAULT_CALL_SIZE}.5`,
			'300',
			'500',
			'0',
			'',
			'abc'
		]) {
			assert.throws(() => assertViciXpHumanPremium({ amountStr }), Error, amountStr);
		}
	});
});

describe('vxp-economy.utils call-size stops', () => {
	it('reads every valid size of the range as a stop, smallest first', () => {
		const stops = callSizeStops();

		assert.equal(stops[0], VXP_MIN_CALL_SIZE);
		assert.equal(stops[stops.length - 1], VXP_MAX_CALL_SIZE);
		stops.slice(1).forEach((value, index) => {
			assert.equal(value - stops[index], VXP_CALL_SIZE_STEP);
		});
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

	it('snaps an off-range value to the nearest stop', () => {
		const stops = callSizeStops();
		const last = stops.length - 1;

		assert.equal(callSizeStopIndex({ value: stops[last] * 10 }), last);
		assert.equal(callSizeStopIndex({ value: 1 }), 0);
		assert.equal(
			callSizeStopIndex({ value: Number.NaN }),
			callSizeStopIndex({ value: VXP_DEFAULT_CALL_SIZE })
		);
	});
});
