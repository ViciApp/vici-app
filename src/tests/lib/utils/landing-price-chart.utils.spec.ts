import {
	buildPriceChartSeries,
	isEvenOddsTick,
	nearestPointIndex,
	priceChartChange,
	priceChartPath,
	priceChartScale,
	priceChartTicks,
	priceChartYFraction
} from '#lib/utils/landing-price-chart.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('landing-price-chart.utils', () => {
	describe('buildPriceChartSeries', () => {
		it('draws a flat line at the live price when the window has no trades', () => {
			assert.deepEqual(buildPriceChartSeries({ yes: [], xs: [], livePercent: 42 }), {
				values: [42, 42],
				xs: [0, 1]
			});
		});

		it('has nothing to draw with no trades and no live price', () => {
			assert.equal(buildPriceChartSeries({ yes: [], xs: [] }), undefined);
		});

		it('extends the line to now at the live price', () => {
			assert.deepEqual(buildPriceChartSeries({ yes: [40, 45], xs: [0, 0.5], livePercent: 47 }), {
				values: [40, 45, 47],
				xs: [0, 0.5, 1]
			});
		});

		it('extends to now at the last trade when the live price is unknown', () => {
			assert.deepEqual(buildPriceChartSeries({ yes: [40, 45], xs: [0.2, 0.6] }), {
				values: [40, 45, 45],
				xs: [0.2, 0.6, 1]
			});
		});

		it('leaves a series that already ends at now untouched', () => {
			assert.deepEqual(buildPriceChartSeries({ yes: [40, 45], xs: [0, 1], livePercent: 60 }), {
				values: [40, 45],
				xs: [0, 1]
			});
		});

		it('widens a single point at now into a flat line', () => {
			assert.deepEqual(buildPriceChartSeries({ yes: [33], xs: [1] }), {
				values: [33, 33],
				xs: [0, 1]
			});
		});
	});

	describe('priceChartScale', () => {
		it('rounds out to whole tens with headroom', () => {
			assert.deepEqual(priceChartScale([41, 58]), { lo: 30, hi: 70 });
		});

		it('keeps at least a 20-point span', () => {
			assert.deepEqual(priceChartScale([50, 51]), { lo: 40, hi: 60 });
		});

		it('clamps to 0–100 and keeps the span at the edges', () => {
			assert.deepEqual(priceChartScale([2, 3]), { lo: 0, hi: 20 });
			assert.deepEqual(priceChartScale([97, 99]), { lo: 80, hi: 100 });
		});
	});

	describe('priceChartTicks', () => {
		it('steps by 10 inside a narrow scale', () => {
			assert.deepEqual(priceChartTicks({ lo: 20, hi: 50 }), [30, 40]);
		});

		it('steps by 20 on a tall scale and adds the even-odds line', () => {
			assert.deepEqual(priceChartTicks({ lo: 10, hi: 70 }), [30, 50]);
			assert.deepEqual(priceChartTicks({ lo: 0, hi: 60 }), [20, 40, 50]);
		});

		it('flags only 50 as even odds', () => {
			assert.equal(isEvenOddsTick(50), true);
			assert.equal(isEvenOddsTick(40), false);
		});
	});

	describe('geometry', () => {
		it('maps values top-down inside the scale', () => {
			const scale = { lo: 20, hi: 60 };

			assert.equal(priceChartYFraction({ value: 60, scale }), 0);
			assert.equal(priceChartYFraction({ value: 20, scale }), 1);
			assert.equal(priceChartYFraction({ value: 40, scale }), 0.5);
		});

		it('builds the SVG path in the 320 × 120 box', () => {
			assert.equal(
				priceChartPath({
					series: { values: [60, 40, 20], xs: [0, 0.5, 1] },
					scale: { lo: 20, hi: 60 }
				}),
				'M0.0,0.0 L160.0,60.0 L320.0,120.0'
			);
		});

		it('finds the point nearest the pointer, clamped to the plot', () => {
			const xs = [0, 0.3, 0.8, 1];

			assert.equal(nearestPointIndex({ xs, x: 0.5 }), 1);
			assert.equal(nearestPointIndex({ xs, x: 0.6 }), 2);
			assert.equal(nearestPointIndex({ xs, x: -1 }), 0);
			assert.equal(nearestPointIndex({ xs, x: 2 }), 3);
		});

		it('measures the change across the window', () => {
			assert.equal(priceChartChange([40, 47, 44]), 4);
			assert.equal(priceChartChange([40]), 0);
		});
	});
});
