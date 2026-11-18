import { formatProbability, probabilityToPercent } from '#lib/utils/format.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('format.utils', () => {
	describe('probabilityToPercent', () => {
		it('rounds a 0..1 probability to a whole percent', () => {
			assert.equal(probabilityToPercent(0), 0);
			assert.equal(probabilityToPercent(0.5), 50);
			assert.equal(probabilityToPercent(0.284), 28);
			assert.equal(probabilityToPercent(1), 100);
		});

		it('rounds a half percent up', () => {
			assert.equal(probabilityToPercent(0.005), 1);
			assert.equal(probabilityToPercent(0.125), 13);
		});
	});

	describe('formatProbability', () => {
		it('renders a whole percent with a percent sign', () => {
			assert.equal(formatProbability(0.5), '50%');
			assert.equal(formatProbability(0.995), '100%');
			assert.equal(formatProbability(0.001), '0%');
		});

		it('renders a non-finite input verbatim', () => {
			assert.equal(formatProbability(Number.NaN), 'NaN%');
		});
	});
});
