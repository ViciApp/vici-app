import { referrerCreditedBaseUnits } from '#lib/constants/referral.constants.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('referrerCreditedBaseUnits', () => {
	it('sums the amount of every armed referrer side and skips unarmed ones', () => {
		assert.equal(
			referrerCreditedBaseUnits([
				{ status: 'paid', amountBaseUnits: vxpBaseUnits(500).toString(), blockIndex: '1' },
				{ status: 'none', amountBaseUnits: '0' },
				{ status: 'owed', amountBaseUnits: vxpBaseUnits(250).toString() },
				{ status: 'processing', amountBaseUnits: vxpBaseUnits(100).toString() }
			]),
			vxpBaseUnits(850)
		);
	});

	it('ignores an amount that is not a number', () => {
		assert.equal(
			referrerCreditedBaseUnits([{ status: 'paid', amountBaseUnits: 'lots' }]),
			vxpBaseUnits(0)
		);
	});
});
