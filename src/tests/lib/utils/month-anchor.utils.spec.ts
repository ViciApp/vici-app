import { monthAnchorFromMs, previousMonthAnchor } from '#lib/utils/month-anchor.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Anchors are the stored ids of monthly docs, so the format and the UTC
// boundaries must never change.

describe('monthAnchorFromMs', () => {
	it('pads single-digit months', () => {
		assert.equal(monthAnchorFromMs(Date.UTC(2026, 0, 15)), '2026-01');
	});

	it('keeps two-digit months', () => {
		assert.equal(monthAnchorFromMs(Date.UTC(2026, 11, 31, 23, 59, 59, 999)), '2026-12');
	});

	it('anchors on the UTC month, not the local one', () => {
		assert.equal(monthAnchorFromMs(Date.UTC(2026, 5, 1)), '2026-06');
		assert.equal(monthAnchorFromMs(Date.UTC(2026, 5, 1) - 1), '2026-05');
	});
});

describe('previousMonthAnchor', () => {
	it('returns the month before', () => {
		assert.equal(previousMonthAnchor(Date.UTC(2026, 6, 15)), '2026-06');
	});

	it('crosses the year boundary', () => {
		assert.equal(previousMonthAnchor(Date.UTC(2026, 0, 1)), '2025-12');
	});

	it('is not thrown off by month lengths', () => {
		assert.equal(previousMonthAnchor(Date.UTC(2026, 2, 31, 23, 59, 59, 999)), '2026-02');
	});
});
