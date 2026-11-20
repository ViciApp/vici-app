import type { CollateralStoreData } from '#lib/stores/collaterals.store.ts';
import { holdingsSnapshotOwner, ownedCollaterals } from '#lib/utils/vxp-holdings.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const ACCOUNT_A = 'aaaaa-aa';
const ACCOUNT_B = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

const collateralsOf = (owner: string): CollateralStoreData => ({
	owner,
	balances: {},
	accountState: undefined,
	assetsConfig: {}
});

describe('vxp-holdings.utils', () => {
	describe('ownedCollaterals', () => {
		it('returns the figures loaded for the signed-in owner', () => {
			const collaterals = collateralsOf(ACCOUNT_A);

			assert.equal(ownedCollaterals({ collaterals, owner: ACCOUNT_A }), collaterals);
		});

		it('hides figures loaded for the previous account', () => {
			assert.equal(
				ownedCollaterals({ collaterals: collateralsOf(ACCOUNT_A), owner: ACCOUNT_B }),
				undefined
			);
		});

		it('hides figures while signed out', () => {
			assert.equal(
				ownedCollaterals({ collaterals: collateralsOf(ACCOUNT_A), owner: undefined }),
				undefined
			);
		});
	});

	describe('holdingsSnapshotOwner', () => {
		it('keys the snapshot to the owner the figures were loaded for', () => {
			assert.equal(
				holdingsSnapshotOwner({
					collaterals: collateralsOf(ACCOUNT_A),
					balances: {},
					owner: ACCOUNT_A
				}),
				ACCOUNT_A
			);
		});

		it('writes nothing for the next account while the previous account figures are loaded', () => {
			assert.equal(
				holdingsSnapshotOwner({
					collaterals: collateralsOf(ACCOUNT_A),
					balances: {},
					owner: ACCOUNT_B
				}),
				undefined
			);
		});

		it('writes nothing until the ledger balances are loaded', () => {
			assert.equal(
				holdingsSnapshotOwner({
					collaterals: collateralsOf(ACCOUNT_A),
					balances: undefined,
					owner: ACCOUNT_A
				}),
				undefined
			);
		});
	});
});
