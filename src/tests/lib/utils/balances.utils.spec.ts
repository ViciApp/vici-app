import { ZERO } from '#lib/constants/app.constants.ts';
import { CKUSDC_TOKEN, ICP_TOKEN, VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { mergeReadBalances } from '#lib/utils/balances.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { id: ICP } = ICP_TOKEN;
const { id: VXP } = VXP_TOKEN;
const { id: CKUSDC } = CKUSDC_TOKEN;

describe('balances.utils', () => {
	describe('mergeReadBalances', () => {
		it('replaces every token that was read', () => {
			assert.deepEqual(
				mergeReadBalances({
					previous: { [ICP]: 1n, [VXP]: 2n },
					read: { [ICP]: 10n, [VXP]: ZERO }
				}),
				{ [ICP]: 10n, [VXP]: ZERO }
			);
		});

		it('keeps the last known value of a token that could not be read', () => {
			assert.deepEqual(
				mergeReadBalances({
					previous: { [ICP]: 1n, [VXP]: 2n, [CKUSDC]: 3n },
					read: { [VXP]: 5n }
				}),
				{ [ICP]: 1n, [VXP]: 5n, [CKUSDC]: 3n }
			);
		});

		it('keeps every last known value when nothing could be read', () => {
			assert.deepEqual(mergeReadBalances({ previous: { [ICP]: 1n, [VXP]: 2n }, read: {} }), {
				[ICP]: 1n,
				[VXP]: 2n
			});
		});

		it('stays unknown instead of zero when nothing is known and nothing was read', () => {
			assert.equal(mergeReadBalances({ previous: undefined, read: {} }), undefined);
		});

		it('starts from the read tokens when nothing is known yet', () => {
			assert.deepEqual(mergeReadBalances({ previous: undefined, read: { [VXP]: 7n } }), {
				[VXP]: 7n
			});
		});
	});
});
