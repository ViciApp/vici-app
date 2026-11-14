import {
	MONTH_ANCHOR_RE,
	monthAnchorFromMs,
	previousMonthAnchor
} from '#lib/utils/month-anchor.utils.ts';
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

describe('MONTH_ANCHOR_RE', () => {
	it('accepts every month from 01 to 12', () => {
		for (let month = 1; month <= 12; month++) {
			const anchor = `2026-${month.toString().padStart(2, '0')}`;

			assert.ok(MONTH_ANCHOR_RE.test(anchor), anchor);
		}
	});

	it('accepts what monthAnchorFromMs produces', () => {
		assert.ok(MONTH_ANCHOR_RE.test(monthAnchorFromMs(Date.UTC(2026, 11, 31))));
	});

	it('rejects month 00 and months past 12', () => {
		for (const anchor of ['2026-00', '2026-13', '2026-19', '2026-99']) {
			assert.equal(MONTH_ANCHOR_RE.test(anchor), false, anchor);
		}
	});

	it('rejects other shapes', () => {
		for (const anchor of ['2026-1', '26-01', '2026-001', '2026/01', ' 2026-01', '2026-01 ', '']) {
			assert.equal(MONTH_ANCHOR_RE.test(anchor), false, anchor);
		}
	});
});
