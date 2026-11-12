import { consensusLean } from '#lib/utils/market.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('market.utils', () => {
	describe('consensusLean', () => {
		it('points straight down at an all-NO market', () => {
			assert.deepEqual(consensusLean(0), { isYes: false, angle: 90, leadingPct: 100 });
		});

		it('reads level at 50/50 and counts it as YES', () => {
			const { isYes, angle, leadingPct } = consensusLean(50);

			assert.equal(isYes, true);
			// `===` so the `-0` the formula yields still counts as level: it renders as `rotate(0 ...)`.
			assert.ok(angle === 0);
			assert.equal(leadingPct, 50);
		});

		it('points straight up at an all-YES market', () => {
			assert.deepEqual(consensusLean(100), { isYes: true, angle: -90, leadingPct: 100 });
		});

		it('rotates linearly with the distance from 50/50', () => {
			assert.deepEqual(consensusLean(25), { isYes: false, angle: 45, leadingPct: 75 });
			assert.deepEqual(consensusLean(33), { isYes: false, angle: 30.6, leadingPct: 67 });
			assert.deepEqual(consensusLean(49), { isYes: false, angle: 1.8, leadingPct: 51 });
			assert.deepEqual(consensusLean(51), { isYes: true, angle: -1.8, leadingPct: 51 });
			assert.deepEqual(consensusLean(75), { isYes: true, angle: -45, leadingPct: 75 });
		});

		it('clamps a percentage outside 0..100 to the nearest extreme', () => {
			assert.deepEqual(consensusLean(120), consensusLean(100));
			assert.deepEqual(consensusLean(-20), consensusLean(0));
		});
	});
});
