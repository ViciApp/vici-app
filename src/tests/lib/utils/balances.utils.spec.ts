import { ZERO } from '#lib/constants/app.constants.ts';
import { CKUSDC_TOKEN, ICP_TOKEN, VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { mergeReadBalances } from '#lib/utils/balances.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { id: ICP } = ICP_TOKEN;
const { id: VXP } = VXP_TOKEN;
const { id: CKUSDC } = CKUSDC_TOKEN;

const ALICE = 'alice';
const BOB = 'bob';

describe('balances.utils', () => {
	describe('mergeReadBalances', () => {
		it('replaces every token that was read', () => {
			assert.deepEqual(
				mergeReadBalances({
					previous: { owner: ALICE, balances: { [ICP]: 1n, [VXP]: 2n } },
					read: { owner: ALICE, balances: { [ICP]: 10n, [VXP]: ZERO } }
				}),
				{ owner: ALICE, balances: { [ICP]: 10n, [VXP]: ZERO } }
			);
		});

		it('keeps the last known value of a token that could not be read', () => {
			assert.deepEqual(
				mergeReadBalances({
					previous: { owner: ALICE, balances: { [ICP]: 1n, [VXP]: 2n, [CKUSDC]: 3n } },
					read: { owner: ALICE, balances: { [VXP]: 5n } }
				}),
				{ owner: ALICE, balances: { [ICP]: 1n, [VXP]: 5n, [CKUSDC]: 3n } }
			);
		});

		it('keeps every last known value when nothing could be read', () => {
			assert.deepEqual(
				mergeReadBalances({
					previous: { owner: ALICE, balances: { [ICP]: 1n, [VXP]: 2n } },
					read: { owner: ALICE, balances: {} }
				}),
				{ owner: ALICE, balances: { [ICP]: 1n, [VXP]: 2n } }
			);
		});

		it('stays unknown instead of zero when nothing is known and nothing was read', () => {
			assert.equal(
				mergeReadBalances({ previous: undefined, read: { owner: ALICE, balances: {} } }),
				undefined
			);
		});

		it('starts from the read tokens when nothing is known yet', () => {
			assert.deepEqual(
				mergeReadBalances({ previous: undefined, read: { owner: ALICE, balances: { [VXP]: 7n } } }),
				{ owner: ALICE, balances: { [VXP]: 7n } }
			);
		});

		it('never carries balances over to another account', () => {
			const previous = { owner: ALICE, balances: { [ICP]: 1n, [VXP]: 2n } };

			assert.equal(mergeReadBalances({ previous, read: { owner: BOB, balances: {} } }), undefined);
			assert.deepEqual(
				mergeReadBalances({ previous, read: { owner: BOB, balances: { [VXP]: 9n } } }),
				{ owner: BOB, balances: { [VXP]: 9n } }
			);
		});

		it('drops every balance when nobody is signed in', () => {
			assert.equal(
				mergeReadBalances({
					previous: { owner: ALICE, balances: { [ICP]: 1n } },
					read: { balances: {} }
				}),
				undefined
			);
		});
	});
});
