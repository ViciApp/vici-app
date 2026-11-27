import { DAY_IN_MS, HOUR_IN_MS, MINUTE_IN_MS } from '#lib/constants/time.constants.ts';
import {
	formatSettleDate,
	formatSettlesIn,
	formatSettlesOn
} from '#lib/utils/market-settle.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NOW_MS = 1_800_000_000_000;

describe('market-settle.utils', () => {
	describe('formatSettlesIn', () => {
		const settles = (leftMs: number): string =>
			formatSettlesIn({ expiryMs: NOW_MS + leftMs, nowMs: NOW_MS, locale: 'en' });

		it('counts whole days, with a singular for one day', () => {
			assert.equal(settles(12 * DAY_IN_MS), 'Settles in 12 days');
			assert.equal(settles(11.6 * DAY_IN_MS), 'Settles in 12 days');
			assert.equal(settles(DAY_IN_MS), 'Settles in 1 day');
			assert.equal(settles(1.4 * DAY_IN_MS), 'Settles in 1 day');
		});

		it('counts hours under a day, with a singular for one hour', () => {
			assert.equal(settles(5 * HOUR_IN_MS), 'Settles in 5 hours');
			assert.equal(settles(HOUR_IN_MS), 'Settles in 1 hour');
			assert.equal(settles(DAY_IN_MS - MINUTE_IN_MS), 'Settles in 23 hours');
		});

		it('says within the hour under an hour', () => {
			assert.equal(settles(20 * MINUTE_IN_MS), 'Settles within the hour');
		});

		it('switches to months from two months out', () => {
			assert.equal(settles(59 * DAY_IN_MS), 'Settles in 59 days');
			assert.equal(settles(120 * DAY_IN_MS), 'Settles in 4 months');
		});

		it('never counts into the past', () => {
			assert.equal(settles(0), 'Settling now');
			assert.equal(settles(-3 * DAY_IN_MS), 'Settling now');
		});
	});

	describe('formatSettlesOn', () => {
		// Midday in the runner's own time zone: the date is formatted in local
		// time, so a UTC fixture would land on another day east of UTC+12.
		const expiryMs = new Date(2026, 11, 31, 12).getTime();

		it('always writes the year', () => {
			assert.equal(formatSettleDate({ expiryMs, locale: 'en' }), 'Dec 31, 2026');
			assert.equal(formatSettlesOn({ expiryMs, locale: 'en' }), 'Settles on Dec 31, 2026');
		});

		it('follows the locale for the order of day, month and year', () => {
			assert.equal(formatSettleDate({ expiryMs, locale: 'it' }), '31 dic 2026');
			assert.equal(formatSettleDate({ expiryMs, locale: 'de' }), '31. Dez. 2026');
		});
	});
});
