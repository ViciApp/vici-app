import {
	LANDING_CALLS_MAX,
	LANDING_CALLS_TTL_MS,
	LANDING_FLOAT_LAND_RADIUS_PX
} from '#lib/constants/landing-page.constants.ts';
import type { LandingCall } from '#lib/types/landing-call.ts';
import {
	keepRecentLandingCalls,
	landingFloatLanding,
	parseLandingCalls
} from '#lib/utils/landing-page.utils.ts';
import { uniqueSeriesIdWithPrefix } from '#lib/utils/market-slug.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NOW_MS = 1_800_000_000_000;

const call = (overrides: Partial<LandingCall> = {}): LandingCall => ({
	seriesId: 'a1c4dcc0728d7e36',
	side: 'yes',
	pricePercent: 55,
	atMs: NOW_MS,
	...overrides
});

describe('landing-page.utils', () => {
	describe('parseLandingCalls', () => {
		it('reads stored calls, with and without a size', () => {
			const stored = [call(), call({ side: 'no', amountVxp: 50 })];

			assert.deepEqual(parseLandingCalls(stored), stored);
		});

		it('drops what is not a call', () => {
			assert.deepEqual(
				parseLandingCalls([
					call(),
					null,
					'yes',
					{ seriesId: 'x', side: 'maybe', pricePercent: 50, atMs: NOW_MS },
					{ seriesId: 'x', side: 'yes', pricePercent: '50', atMs: NOW_MS },
					{ seriesId: 'x', side: 'yes', pricePercent: 50, atMs: Number.NaN }
				]),
				[call()]
			);
		});

		it('reads anything that is not a list as no calls', () => {
			assert.deepEqual(parseLandingCalls(undefined), []);
			assert.deepEqual(parseLandingCalls({ calls: [call()] }), []);
		});
	});

	describe('keepRecentLandingCalls', () => {
		it('keeps the latest calls, in order', () => {
			const calls = Array.from({ length: LANDING_CALLS_MAX + 3 }, (_, index) =>
				call({ seriesId: `series-${index}` })
			);

			const kept = keepRecentLandingCalls({ calls, nowMs: NOW_MS });

			assert.equal(kept.length, LANDING_CALLS_MAX);
			assert.equal(kept[0].seriesId, 'series-3');
			assert.equal(kept.at(-1)?.seriesId, `series-${LANDING_CALLS_MAX + 2}`);
		});

		it('forgets a call once it is a week old', () => {
			const fresh = call({ atMs: NOW_MS - LANDING_CALLS_TTL_MS + 1 });
			const old = call({ atMs: NOW_MS - LANDING_CALLS_TTL_MS });

			assert.deepEqual(keepRecentLandingCalls({ calls: [old, fresh], nowMs: NOW_MS }), [fresh]);
		});
	});

	describe('landingFloatLanding', () => {
		const viewport = { width: 1440, height: 900 };

		it('scales the card to cover the target and clips it to the target', () => {
			const target = { left: 132, top: 228, width: 520, height: 420 };
			const { scale, insetX, insetY, radius } = landingFloatLanding({ viewport, target });

			assert.equal(scale, 420 / 900);
			// Unscaled, the visible window is exactly the target's size.
			assert.ok(Math.abs((viewport.width - 2 * insetX) * scale - target.width) < 1e-9);
			assert.ok(Math.abs((viewport.height - 2 * insetY) * scale - target.height) < 1e-9);
			assert.equal(radius, LANDING_FLOAT_LAND_RADIUS_PX / scale);
		});

		it('lands the card centre on the target centre, given the origin below the centre', () => {
			const target = { left: 132, top: 228, width: 520, height: 420 };
			const { dx, dy, scale } = landingFloatLanding({ viewport, target });

			// A point at the card's centre sits 10% of the height above the 60% origin.
			const centreX = viewport.width / 2 + dx;
			const centreY = 0.6 * viewport.height + dy - 0.1 * viewport.height * scale;

			assert.ok(Math.abs(centreX - (target.left + target.width / 2)) < 1e-9);
			assert.ok(Math.abs(centreY - (target.top + target.height / 2)) < 1e-9);
		});

		it('never clips by a negative amount', () => {
			const { insetX, insetY } = landingFloatLanding({
				viewport,
				target: { left: 0, top: 0, width: 1440, height: 900 }
			});

			assert.equal(insetX, 0);
			assert.equal(insetY, 0);
		});
	});
});

describe('uniqueSeriesIdWithPrefix', () => {
	const seriesIds = ['3fa9c21b77e04d1e', '3fa9c21bffff0000', '9bd0aa11c2e34f5a'];

	it('names the one series a prefix belongs to', () => {
		assert.equal(uniqueSeriesIdWithPrefix({ seriesIds, prefix: '9bd0aa11' }), '9bd0aa11c2e34f5a');
	});

	it('names a whole id', () => {
		assert.equal(
			uniqueSeriesIdWithPrefix({ seriesIds, prefix: '3fa9c21b77e04d1e' }),
			'3fa9c21b77e04d1e'
		);
	});

	it('names none when the prefix is shared or unknown', () => {
		assert.equal(uniqueSeriesIdWithPrefix({ seriesIds, prefix: '3fa9c21b' }), undefined);
		assert.equal(uniqueSeriesIdWithPrefix({ seriesIds, prefix: 'deadbeef' }), undefined);
	});
});
