import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import { formatPriceMove24h, priceMove24h } from '#lib/utils/market-price-move.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('market-price-move.utils', () => {
	describe('priceMove24h', () => {
		const week = 7 * DAY_IN_MS;

		it('compares the current price with the last trade at least a day old', () => {
			assert.equal(
				priceMove24h({
					yes: [30, 40, 55],
					xs: [0.1, 0.5, 0.95],
					windowMs: week,
					currentPercent: 52
				}),
				12
			);
		});

		it('falls back to the first trade when every trade is younger than a day', () => {
			assert.equal(priceMove24h({ yes: [48, 50], xs: [0.9, 0.99], windowMs: week }), 2);
		});

		it('reads a 24-hour window from its first trade', () => {
			assert.equal(
				priceMove24h({
					yes: [51, 53, 52],
					xs: [0, 0.4, 0.8],
					windowMs: DAY_IN_MS,
					currentPercent: 54
				}),
				3
			);
			assert.equal(
				priceMove24h({ yes: [60], xs: [0.5], windowMs: DAY_IN_MS, currentPercent: 54 }),
				-6
			);
		});

		it('rounds to whole points', () => {
			assert.equal(
				priceMove24h({ yes: [40.4], xs: [0.2], windowMs: DAY_IN_MS, currentPercent: 42 }),
				2
			);
		});

		it('says nothing when the window holds no trade', () => {
			assert.equal(
				priceMove24h({ yes: [], xs: [], windowMs: week, currentPercent: 50 }),
				undefined
			);
		});
	});

	describe('formatPriceMove24h', () => {
		it('signs the move and names the 24h window', () => {
			assert.equal(formatPriceMove24h({ move: 4, locale: 'en' }), '+4 in 24h');
			assert.equal(formatPriceMove24h({ move: -3, locale: 'en' }), '-3 in 24h');
			assert.equal(formatPriceMove24h({ move: 0, locale: 'en' }), '0 in 24h');
		});
	});
});
