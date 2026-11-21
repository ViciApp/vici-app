import { USD_DECIMALS } from '#lib/constants/app.constants.ts';
import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('playground-display.utils', () => {
	describe('formatVxpBalance', () => {
		it('renders whole VXP with grouping', () => {
			assert.equal(formatVxpBalance({ value: vxpBaseUnits(24_000) }), '24,000');
			assert.equal(formatVxpBalance({ value: vxpBaseUnits(0) }), '0');
		});

		it('never rounds a fractional balance up', () => {
			assert.equal(formatVxpBalance({ value: vxpBaseUnits('49.6') }), '49');
			assert.equal(formatVxpBalance({ value: vxpBaseUnits('49.9999') }), '49');
			assert.equal(formatVxpBalance({ value: vxpBaseUnits('0.5') }), '0');
			assert.equal(formatVxpBalance({ value: vxpBaseUnits('1499.5') }), '1,499');
		});

		it('rounds toward zero for a value in clearing margin units', () => {
			// Clearing margin shares the 4-decimal scale of the VXP ledger.
			assert.equal(formatVxpBalance({ value: vxpBaseUnits('49.6'), decimals: USD_DECIMALS }), '49');
		});
	});
});
