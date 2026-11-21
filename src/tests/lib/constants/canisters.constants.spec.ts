import {
	VXP_LEDGER_CANISTER_ID_DEFAULT,
	vxpLedgerCanisterIdFor
} from '#lib/constants/canisters.constants.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('vxpLedgerCanisterIdFor', () => {
	it('takes the VITE_VXP_LEDGER_CANISTER_ID override of the env it is given', () => {
		assert.equal(vxpLedgerCanisterIdFor({ VITE_VXP_LEDGER_CANISTER_ID: 'aaaaa-aa' }), 'aaaaa-aa');
	});

	it('falls back to the default ledger when the env has no override', () => {
		assert.equal(vxpLedgerCanisterIdFor({}), VXP_LEDGER_CANISTER_ID_DEFAULT);
		assert.equal(vxpLedgerCanisterIdFor(undefined), VXP_LEDGER_CANISTER_ID_DEFAULT);
	});
});
