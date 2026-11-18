import { ZERO } from '#lib/constants/app.constants.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('vxpBaseUnits', () => {
	it('scales whole VXP by the 4 ledger decimals', () => {
		assert.equal(vxpBaseUnits(0), ZERO);
		assert.equal(vxpBaseUnits(1), 10_000n);
		assert.equal(vxpBaseUnits(400), 4_000_000n);
		assert.equal(vxpBaseUnits(1500), 15_000_000n);
	});

	it('reads a whole-VXP string the same as the number', () => {
		assert.equal(vxpBaseUnits('250'), vxpBaseUnits(250));
	});
});
