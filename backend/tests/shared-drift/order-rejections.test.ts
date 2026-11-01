import { nonNullish } from '@dfinity/utils';
import { describe, expect, test } from 'bun:test';
import { ORDER_REJECTIONS } from '../../src/engine/order-rejections';
import { extractBlock, readRepoSource } from '../helpers/repo-source';

// A code the app has no message for would fall back to the generic failure,
// which is the bug these codes exist to fix, and nothing else would flag it.
describe('shared drift: order rejection codes', () => {
	const block = extractBlock({
		source: readRepoSource('src/lib/canisters/clearing.errors.ts'),
		marker: 'ORDER_REJECTION_KEYS',
		open: '{',
		close: '}'
	});
	const appCodes = [...block.matchAll(/^\s*([a-z_]+):/gm)].map((match) => match[1]);

	test('the app maps exactly the codes the API answers', () => {
		const apiCodes = Object.values(ORDER_REJECTIONS)
			.filter(nonNullish)
			.map(({ code }) => code);

		expect(appCodes.sort()).toEqual(apiCodes.sort());
	});
});
