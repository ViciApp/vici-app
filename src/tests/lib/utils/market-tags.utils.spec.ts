import { SUPPORTED_LOCALES } from '#lib/constants/locale.constants.ts';
import { MICRO_IDS } from '#lib/constants/market-taxonomy.constants.ts';
import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('categoryLabel', () => {
	// The portfolio row chips render the short label of a market's primary
	// micro; it must stay the upper-cased id in every locale.
	it('short variant is the upper-cased micro id in every locale', () => {
		for (const { id: locale } of SUPPORTED_LOCALES) {
			for (const micro of MICRO_IDS) {
				assert.equal(
					categoryLabel({ category: micro, variant: 'short', locale }),
					micro.toUpperCase()
				);
			}
		}
	});
});
