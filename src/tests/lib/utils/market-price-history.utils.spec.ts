import type { ClearingDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import { DAY_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import { deriveMarketPriceSeries } from '#lib/utils/market-price-history.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const HOUR_IN_NANOSECONDS = DAY_IN_NANOSECONDS / 24n;
const WINDOW_END_NS = 100n * DAY_IN_NANOSECONDS;
const WINDOW_START_NS = WINDOW_END_NS - 7n * DAY_IN_NANOSECONDS;

const price = (value: bigint): ClearingDid.Price => ({
	timestamp: [],
	oracle_id: [],
	decimal: { value, decimals: 2 }
});

const candle = ({
	bucketStartNs,
	close,
	tradeCount
}: {
	bucketStartNs: bigint;
	close: bigint;
	tradeCount: bigint;
}): ClearingDid.SeriesPriceCandle => ({
	open: price(close),
	high: price(close),
	low: price(close),
	close: price(close),
	volume: ZERO,
	trade_count: tradeCount,
	bucket_start_ns: bucketStartNs
});

describe('market-price-history.utils', () => {
	describe('deriveMarketPriceSeries', () => {
		it('counts only the trades in candles that start within the last day', () => {
			const { tradesLastDay } = deriveMarketPriceSeries({
				candles: [
					candle({
						bucketStartNs: WINDOW_END_NS - 3n * DAY_IN_NANOSECONDS,
						close: 40n,
						tradeCount: 9n
					}),
					candle({ bucketStartNs: WINDOW_END_NS - DAY_IN_NANOSECONDS, close: 45n, tradeCount: 2n }),
					candle({ bucketStartNs: WINDOW_END_NS - HOUR_IN_NANOSECONDS, close: 50n, tradeCount: 3n })
				],
				windowStartNs: WINDOW_START_NS,
				windowEndNs: WINDOW_END_NS
			});

			assert.equal(tradesLastDay, 5);
		});

		it('reports zero trades and no points for an untraded window', () => {
			assert.deepEqual(
				deriveMarketPriceSeries({
					candles: [],
					windowStartNs: WINDOW_START_NS,
					windowEndNs: WINDOW_END_NS
				}),
				{ yes: [], xs: [], tradesLastDay: 0 }
			);
		});

		it('plots each close as a YES percentage on the time axis', () => {
			const { yes, xs } = deriveMarketPriceSeries({
				candles: [candle({ bucketStartNs: WINDOW_START_NS, close: 62n, tradeCount: 1n })],
				windowStartNs: WINDOW_START_NS,
				windowEndNs: WINDOW_END_NS
			});

			assert.deepEqual(yes, [62]);
			assert.deepEqual(xs, [0]);
		});
	});
});
