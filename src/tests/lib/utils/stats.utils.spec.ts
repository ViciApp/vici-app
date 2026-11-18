import { median } from '#lib/utils/stats.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('median', () => {
	it('returns 0 for an empty array', () => {
		assert.equal(median([]), 0);
	});

	it('returns the middle value of an odd-length array, whatever the order', () => {
		assert.equal(median([0.3]), 0.3);
		assert.equal(median([0.9, 0.1, 0.5]), 0.5);
	});

	it('averages the two middle values of an even-length array', () => {
		assert.equal(median([0.1, 0.5]), 0.3);
		assert.equal(median([4, 1, 3, 2]), 2.5);
	});

	it('leaves the input untouched', () => {
		const values = [3, 1, 2];

		median(values);

		assert.deepEqual(values, [3, 1, 2]);
	});
});
