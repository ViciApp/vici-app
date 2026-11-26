import { ZERO } from '#lib/constants/app.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { Market } from '#lib/types/market.ts';
import {
	callableMarkets,
	compareBySoonest,
	dailyMoveCopy,
	formatSettleCountdown,
	matchesSearchQuery,
	normalizeSearchText,
	pickTrendingMarket,
	sidePercents
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
});
