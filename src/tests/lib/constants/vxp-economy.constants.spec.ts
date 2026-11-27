import {
	isVxpCallSize,
	VXP_CALL_SIZE_STEP,
	VXP_DEFAULT_CALL_SIZE,
	VXP_MAX_CALL_SIZE,
	VXP_MIN_CALL_SIZE
} from '#lib/constants/vxp-economy.constants.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('VXP call-size range', () => {
	it('puts the minimum, the default and the maximum on the step, in order', () => {
		for (const bound of [VXP_MIN_CALL_SIZE, VXP_DEFAULT_CALL_SIZE, VXP_MAX_CALL_SIZE]) {
			assert.ok(Number.isInteger(bound), `${bound} is a whole amount`);
			assert.equal(bound % VXP_CALL_SIZE_STEP, 0, `${bound} sits on the step`);
		}

		assert.ok(VXP_MIN_CALL_SIZE > 0);
		assert.ok(VXP_MIN_CALL_SIZE <= VXP_DEFAULT_CALL_SIZE);
		assert.ok(VXP_DEFAULT_CALL_SIZE <= VXP_MAX_CALL_SIZE);
	});
});

describe('isVxpCallSize', () => {
	it('accepts every multiple of the step from the minimum to the maximum', () => {
		for (let size = VXP_MIN_CALL_SIZE; size <= VXP_MAX_CALL_SIZE; size += VXP_CALL_SIZE_STEP) {
			assert.equal(isVxpCallSize(size), true, `${size}`);
		}

		assert.equal(isVxpCallSize(VXP_DEFAULT_CALL_SIZE), true);
	});

	it('rejects sizes outside the range, off the step, fractional or not finite', () => {
		for (const size of [
			VXP_MIN_CALL_SIZE - VXP_CALL_SIZE_STEP,
			VXP_MAX_CALL_SIZE + VXP_CALL_SIZE_STEP,
			VXP_MIN_CALL_SIZE + 1,
			VXP_DEFAULT_CALL_SIZE + 0.5,
			0,
			-VXP_DEFAULT_CALL_SIZE,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			300,
			500
		]) {
			assert.equal(isVxpCallSize(size), false, `${size}`);
		}
	});
});
