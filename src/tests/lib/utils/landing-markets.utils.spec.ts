import { ZERO } from '#lib/constants/app.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { Market } from '#lib/types/market.ts';
import {
	callableMarkets,
	compareBySoonest,
	dailyMoveCopy,
	formatSettleCountdown,
	groupBySettlement,
	matchesSearchQuery,
	normalizeSearchText,
	pickMovers,
	pickTrendingMarket,
	settleGroupOf,
	sidePercents,
	sparklinePolyline
} from '#lib/utils/landing-markets.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NOW_MS = 1_800_000_000_000;

const market = ({
	id,
	status = 'Open',
	expiryDate = BigInt(NOW_MS + 1_000_000),
	totalVolume = ZERO,
	startDate
}: {
	id: string;
	status?: Market['status'];
	expiryDate?: bigint;
	totalVolume?: bigint;
	startDate?: bigint;
}): Market => ({ id, status, expiryDate, totalVolume, startDate }) as unknown as Market;

describe('landing-markets.utils', () => {
	describe('callableMarkets', () => {
		it('keeps open, released, unexpired markets only', () => {
			const markets = [
				market({ id: 'open' }),
				market({ id: 'resolved', status: 'Resolved' }),
				market({ id: 'expired-status', status: 'Expired' }),
				market({ id: 'past-expiry', expiryDate: BigInt(NOW_MS - 1) }),
				market({ id: 'scheduled', startDate: BigInt(NOW_MS + 60_000) })
			];

			assert.deepEqual(
				callableMarkets({ markets, nowMs: NOW_MS }).map(({ id }) => id),
				['open']
			);
		});
	});

	describe('ordering', () => {
		it('sorts soonest to settle first, id breaking ties', () => {
			const sorted = [
				market({ id: 'b', expiryDate: 20n }),
				market({ id: 'c', expiryDate: 10n }),
				market({ id: 'a', expiryDate: 20n })
			].sort(compareBySoonest);

			assert.deepEqual(
				sorted.map(({ id }) => id),
				['c', 'a', 'b']
			);
		});

		it('picks the most traded market as trending', () => {
			const trending = pickTrendingMarket([
				market({ id: 'quiet', totalVolume: 5n, expiryDate: 1n }),
				market({ id: 'busy', totalVolume: 90n, expiryDate: 50n })
			]);

			assert.equal(trending?.id, 'busy');
		});

		it('breaks a volume tie by the soonest to settle', () => {
			const trending = pickTrendingMarket([
				market({ id: 'later', expiryDate: 50n }),
				market({ id: 'sooner', expiryDate: 10n })
			]);

			assert.equal(trending?.id, 'sooner');
		});

		it('has no trending market in an empty set', () => {
			assert.equal(pickTrendingMarket([]), undefined);
		});
	});

	describe('search', () => {
		it('folds case, accents and spacing', () => {
			assert.equal(normalizeSearchText('  Barça   TOP '), 'barca top');
		});

		it('matches any searchable text', () => {
			const texts = ['Will Barça be top of La Liga?', 'Sport'];

			assert.equal(matchesSearchQuery({ texts, query: 'barca' }), true);
			assert.equal(matchesSearchQuery({ texts, query: 'SPORT' }), true);
			assert.equal(matchesSearchQuery({ texts, query: 'bitcoin' }), false);
		});

		it('matches everything on an empty query', () => {
			assert.equal(matchesSearchQuery({ texts: ['anything'], query: '   ' }), true);
		});
	});

	describe('sidePercents', () => {
		it('rounds YES and derives NO so they sum to 100', () => {
			assert.deepEqual(sidePercents(0.546), { yes: 55, no: 45 });
		});

		it('is unknown while the price is unknown', () => {
			assert.equal(sidePercents(undefined), undefined);
		});
	});

	describe('formatSettleCountdown', () => {
		const settle = (days: number): string =>
			formatSettleCountdown({ expiryMs: NOW_MS + days * DAY_IN_MS, nowMs: NOW_MS, locale: 'en' });

		it('reads today and tomorrow in words', () => {
			assert.equal(settle(0), 'today');
			assert.equal(settle(1), 'tomorrow');
		});

		it('counts whole days, rounding a part day up', () => {
			assert.equal(settle(35), 'in 35 days');
			assert.equal(settle(34.2), 'in 35 days');
		});

		it('switches to months from two months out', () => {
			assert.equal(settle(59), 'in 59 days');
			assert.equal(settle(120), 'in 4 months');
		});

		it('never counts into the past', () => {
			assert.equal(settle(-3), 'today');
		});
	});

	describe('dailyMoveCopy', () => {
		it('names the direction and the size of the move', () => {
			assert.deepEqual(dailyMoveCopy(4), { key: 'landing.markets.move.up', points: 4 });
			assert.deepEqual(dailyMoveCopy(-3), { key: 'landing.markets.move.down', points: 3 });
			assert.deepEqual(dailyMoveCopy(0), { key: 'landing.markets.move.flat', points: 0 });
		});
	});

	describe('settlement sections', () => {
		// Mid-November, local time: the sections hang off the visitor's own calendar.
		const now = new Date(2026, 10, 15, 12).getTime();
		const at = ({ year, month, day }: { year: number; month: number; day: number }): number =>
			new Date(year, month, day, 12).getTime();

		it('places a market in this year, early next year, later next year or beyond', () => {
			assert.deepEqual(
				settleGroupOf({ expiryMs: at({ year: 2026, month: 11, day: 31 }), nowMs: now }),
				{
					key: 'this_year'
				}
			);
			assert.deepEqual(
				settleGroupOf({ expiryMs: at({ year: 2027, month: 2, day: 31 }), nowMs: now }),
				{
					key: 'early_next',
					year: 2027
				}
			);
			assert.deepEqual(
				settleGroupOf({ expiryMs: at({ year: 2027, month: 3, day: 1 }), nowMs: now }),
				{
					key: 'later_next',
					year: 2027
				}
			);
			assert.deepEqual(
				settleGroupOf({ expiryMs: at({ year: 2028, month: 0, day: 2 }), nowMs: now }),
				{
					key: 'beyond',
					year: 2028
				}
			);
		});

		it('moves with the calendar rather than fixed years', () => {
			const nextJanuary = new Date(2027, 0, 10).getTime();

			assert.deepEqual(
				settleGroupOf({ expiryMs: at({ year: 2027, month: 11, day: 1 }), nowMs: nextJanuary }),
				{
					key: 'this_year'
				}
			);
			assert.deepEqual(
				settleGroupOf({ expiryMs: at({ year: 2028, month: 1, day: 1 }), nowMs: nextJanuary }),
				{
					key: 'early_next',
					year: 2028
				}
			);
		});

		it('groups in time order, soonest first, leaving empty sections out', () => {
			const sections = groupBySettlement({
				nowMs: now,
				markets: [
					market({ id: 'beyond', expiryDate: BigInt(at({ year: 2029, month: 5, day: 1 })) }),
					market({ id: 'dec-31', expiryDate: BigInt(at({ year: 2026, month: 11, day: 31 })) }),
					market({ id: 'dec-1', expiryDate: BigInt(at({ year: 2026, month: 11, day: 1 })) })
				]
			});

			const ids = (markets: Market[]): string[] => markets.map(({ id }) => id);

			assert.deepEqual(
				sections.map(({ group, markets }) => [group.key, ids(markets)]),
				[
					['this_year', ['dec-1', 'dec-31']],
					['beyond', ['beyond']]
				]
			);
		});
	});

	describe('pickMovers', () => {
		it('keeps markets that moved, biggest move first, up to the limit', () => {
			const movers = pickMovers({
				limit: 2,
				candidates: [
					{ id: 'flat', move: 0 },
					{ id: 'untraded', move: undefined },
					{ id: 'small', move: 2 },
					{ id: 'drop', move: -7 },
					{ id: 'rise', move: 5 }
				]
			});

			assert.deepEqual(
				movers.map(({ id }) => id),
				['drop', 'rise']
			);
		});

		it('is empty when nothing moved', () => {
			assert.deepEqual(
				pickMovers({ limit: 4, candidates: [{ move: 0 }, { move: undefined }] }),
				[]
			);
		});
	});

	describe('sparklinePolyline', () => {
		it('spans the box with 2px of room top and bottom', () => {
			assert.equal(
				sparklinePolyline({ values: [10, 20, 30], width: 72, height: 22 }),
				'0.0,20.0 36.0,11.0 72.0,2.0'
			);
		});

		it('keeps a near-flat line near-flat', () => {
			assert.equal(
				sparklinePolyline({ values: [50, 51], width: 72, height: 22 }),
				'0.0,20.0 72.0,11.0'
			);
		});

		it('draws nothing from fewer than two points', () => {
			assert.equal(sparklinePolyline({ values: [50], width: 72, height: 22 }), '');
		});
	});
});
