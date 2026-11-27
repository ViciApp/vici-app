import type { ClearingDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import { levelShareCostUsd, shareCostUsd, walkMarketOrder } from '#lib/utils/market-order.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const USD = 10_000n;

const levelOf = ({
	id,
	price,
	qty,
	side = { Sell: null }
}: {
	id: string;
	price: bigint;
	qty: bigint;
	side?: ClearingDid.Side;
}): ClearingDid.LimitOrder => ({
	qty,
	creator: Principal.anonymous(),
	outcome_id: [],
	blocked_margin_usd: ZERO,
	series_id: 'series',
	side,
	order_id: id,
	price: { decimal: { value: price, decimals: 2 }, timestamp: [], oracle_id: [] },
	balance_domain: { ViciXp: null }
});

/** A book that shrinks as the walk takes from it, read best level first. */
const bookOf = (levels: ClearingDid.LimitOrder[]) => {
	const book = levels.map((level) => ({ ...level }));
	const takes: { id: string; qty: bigint }[] = [];

	return {
		takes,
		readBook: () => Promise.resolve(book.filter(({ qty }) => qty > ZERO)),
		takeLevel: ({ level, qty }: { level: ClearingDid.LimitOrder; qty: bigint }) => {
			takes.push({ id: level.order_id, qty });

			const resting = book.find(({ order_id }) => order_id === level.order_id);

			if (nonNullish(resting)) {
				resting.qty -= qty;
			}

			return Promise.resolve();
		}
	};
};

describe('market-order.utils', () => {
	describe('shareCostUsd', () => {
		it('costs a resting buy its price and a resting sell the complement', () => {
			// A NO call at 0.70 rests as a YES sell at 0.30 and costs 0.70 a share.
			assert.equal(shareCostUsd({ price: { value: 30n, decimals: 2 }, side: 'SELL' }), 7_000n);
			assert.equal(shareCostUsd({ price: { value: 30n, decimals: 2 }, side: 'BUY' }), 3_000n);
		});

		it('rounds a finer price up to the clearing USD scale', () => {
			assert.equal(shareCostUsd({ price: { value: 123_456n, decimals: 6 }, side: 'BUY' }), 1_235n);
		});
	});

	describe('levelShareCostUsd', () => {
		it('costs the level price when buying from an ask', () => {
			assert.equal(
				levelShareCostUsd({ level: levelOf({ id: 'a', price: 37n, qty: 1n }), takerSide: 'BUY' }),
				3_700n
			);
		});

		it('costs the complement when selling into a bid (buying NO)', () => {
			assert.equal(
				levelShareCostUsd({
					level: levelOf({ id: 'b', price: 37n, qty: 1n, side: { Buy: null } }),
					takerSide: 'SELL'
				}),
				6_300n
			);
		});
	});

	describe('walkMarketOrder', () => {
		it('stops at the call size on a thin book instead of filling worse levels for more', async () => {
			// 50 VXP at a 0.5 best ask sizes 100 shares; the book holds 10 @ 0.5 then 90 @ 0.9.
			const book = bookOf([
				levelOf({ id: 'best', price: 50n, qty: 10n }),
				levelOf({ id: 'worse', price: 90n, qty: 90n })
			]);

			const fill = await walkMarketOrder({
				qty: 100n,
				maxSpendUsd: 50n * USD,
				takerSide: 'BUY',
				...book
			});

			assert.deepEqual(book.takes, [
				{ id: 'best', qty: 10n },
				{ id: 'worse', qty: 50n }
			]);
			assert.deepEqual(fill, { filledQty: 60n, spentUsd: 50n * USD });
		});

		it('fills the whole request when the best level covers it', async () => {
			const book = bookOf([levelOf({ id: 'best', price: 50n, qty: 500n })]);

			const fill = await walkMarketOrder({
				qty: 100n,
				maxSpendUsd: 50n * USD,
				takerSide: 'BUY',
				...book
			});

			assert.deepEqual(fill, { filledQty: 100n, spentUsd: 50n * USD });
		});

		it('caps a NO call by the complement of the bids it sells into', async () => {
			// 50 VXP on NO at 0.4 (best YES bid 0.6) sizes 125 shares.
			const book = bookOf([
				levelOf({ id: 'best', price: 60n, qty: 25n, side: { Buy: null } }),
				levelOf({ id: 'worse', price: 20n, qty: 200n, side: { Buy: null } })
			]);

			const fill = await walkMarketOrder({
				qty: 125n,
				maxSpendUsd: 50n * USD,
				takerSide: 'SELL',
				...book
			});

			// 25 @ 0.4 = 10 VXP, then 40 VXP buys 50 shares @ 0.8.
			assert.deepEqual(fill, { filledQty: 75n, spentUsd: 50n * USD });
		});

		it('refuses when the call size cannot buy one share at the best level', async () => {
			const book = bookOf([levelOf({ id: 'best', price: 90n, qty: 10n })]);

			await assert.rejects(
				walkMarketOrder({ qty: 1n, maxSpendUsd: 5_000n, takerSide: 'BUY', ...book }),
				/No matching liquidity/
			);
			assert.deepEqual(book.takes, []);
		});

		it('refuses an empty book', async () => {
			await assert.rejects(
				walkMarketOrder({
					qty: 1n,
					maxSpendUsd: USD,
					takerSide: 'BUY',
					...bookOf([])
				}),
				/No matching liquidity/
			);
		});

		it('keeps a partial fill when a later take fails', async () => {
			const book = bookOf([
				levelOf({ id: 'best', price: 50n, qty: 10n }),
				levelOf({ id: 'next', price: 60n, qty: 90n })
			]);

			const takeLevel = async (params: { level: ClearingDid.LimitOrder; qty: bigint }) => {
				if (params.level.order_id === 'next') {
					throw new Error('rejected');
				}

				await book.takeLevel(params);
			};

			const originalWarn = console.warn;
			console.warn = () => undefined;

			try {
				const fill = await walkMarketOrder({
					qty: 100n,
					maxSpendUsd: 50n * USD,
					takerSide: 'BUY',
					readBook: book.readBook,
					takeLevel
				});

				assert.deepEqual(fill, { filledQty: 10n, spentUsd: 5n * USD });
			} finally {
				console.warn = originalWarn;
			}
		});
	});
});
