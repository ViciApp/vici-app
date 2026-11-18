import type { Market } from '#lib/types/market.ts';
import { filterRevealedMarkets, isMarketRevealed } from '#lib/utils/market-reveal.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NOW_MS = 1_800_000_000_000;

const market = ({ id, startDate }: { id: string; startDate?: bigint }): Market =>
	({ id, startDate }) as unknown as Market;

describe('market-reveal.utils', () => {
	describe('isMarketRevealed', () => {
		it('reveals a market with no start', () => {
			assert.equal(isMarketRevealed({ startDate: undefined, now: NOW_MS }), true);
		});

		it('reveals a market at its start instant, inclusive', () => {
			assert.equal(isMarketRevealed({ startDate: BigInt(NOW_MS), now: NOW_MS }), true);
		});

		it('withholds a market whose start is still ahead', () => {
			assert.equal(isMarketRevealed({ startDate: BigInt(NOW_MS + 1), now: NOW_MS }), false);
		});
	});

	describe('filterRevealedMarkets', () => {
		it('keeps live and started markets in order and drops scheduled ones', () => {
			const markets = [
				market({ id: 'live' }),
				market({ id: 'scheduled', startDate: BigInt(NOW_MS + 60_000) }),
				market({ id: 'started', startDate: BigInt(NOW_MS - 60_000) })
			];

			assert.deepEqual(
				filterRevealedMarkets({ markets, now: NOW_MS }).map(({ id }) => id),
				['live', 'started']
			);
		});
	});
});
