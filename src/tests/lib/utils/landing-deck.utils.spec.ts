import { LANDING_DECK_MEDIA } from '#lib/constants/landing.constants.ts';
import { VXP_DEFAULT_CALL_SIZE, VXP_P_WIN_FLOOR } from '#lib/constants/vxp-economy.constants.ts';
import type { LandingDeckSeries } from '#lib/types/landing.ts';
import type { Market } from '#lib/types/market.ts';
import {
	curatedDeckStill,
	DECK_UNDER_REST_TRANSFORM,
	deckAttractAmplitude,
	deckCardFrame,
	deckCommitThreshold,
	deckDragX,
	deckPassThreshold,
	deckSeamStops,
	deckSidePercent,
	deckSparkline,
	deckStampThreshold,
	deckUnderFrame,
	focusY,
	hasDeckFilm,
	isDeckFlip3d,
	landingDeckSeries,
	resolveDeckRelease,
	toLandingDeckCard
} from '#lib/utils/landing-deck.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const PHONE = { width: 390, height: 760 };
const DESKTOP = { width: 1440, height: 900 };
const STILL = { x: 0, y: 0 };
const NOW_MS = 1_800_000_000_000;

const ENTRY: LandingDeckSeries = { seriesId: 'series-1', media: 'btc', category: 'economy' };

// Only the fields the deck reads; the rest of `Market` is irrelevant here.
const market = (overrides: Partial<Market>): Market =>
	({
		id: 'series-1',
		title: 'Question?',
		resolution: 'Resolves YES if.',
		status: 'Open',
		payoffType: 'Binary',
		yesProbability: 0.54,
		noProbability: 0.46,
		...overrides
	}) as Market;

describe('landing-deck.utils', () => {
	describe('thresholds', () => {
		it('scale with a phone and cap on a wide screen', () => {
			assert.equal(deckStampThreshold(390), 390 * 0.22);
			assert.equal(deckStampThreshold(1920), 160);
			assert.equal(deckCommitThreshold(390), 390 * 0.28);
			assert.equal(deckCommitThreshold(1920), 220);
			assert.equal(deckPassThreshold(640), 640 * 0.3);
			assert.equal(deckPassThreshold(1080), 260);
		});

		it('rocks the introduction past the stamp threshold at every width', () => {
			for (const width of [360, 390, 466, 768, 1024, 1440, 1920]) {
				assert.ok(deckAttractAmplitude(width) > deckStampThreshold(width), `width ${width}`);
			}
		});
	});

	describe('deckDragX', () => {
		it('follows the finger 1:1 inside the free range', () => {
			assert.equal(deckDragX({ rawX: 120, width: 390 }), 120);
			assert.equal(deckDragX({ rawX: -200, width: 390 }), -200);
		});

		it('resists past the free range, symmetrically', () => {
			const limit = 390 * 0.6;
			const right = deckDragX({ rawX: limit + 100, width: 390 });
			const left = deckDragX({ rawX: -(limit + 100), width: 390 });

			assert.ok(right > limit && right < limit + 100);
			assert.equal(left, -right);
		});
	});

	describe('resolveDeckRelease', () => {
		it('commits Yes past the threshold with no velocity', () => {
			const release = resolveDeckRelease({ x: 130, rawY: 0, velocity: STILL, viewport: PHONE });

			assert.deepEqual(release, { kind: 'call', side: 'yes', velocity: 900 });
		});

		it('commits No to the left, throwing at least at the minimum speed', () => {
			const release = resolveDeckRelease({
				x: -130,
				rawY: 0,
				velocity: { x: -200, y: 0 },
				viewport: PHONE
			});

			assert.deepEqual(release, { kind: 'call', side: 'no', velocity: -900 });
		});

		it('commits a short fast flick on its projected travel', () => {
			const release = resolveDeckRelease({
				x: 20,
				rawY: 0,
				velocity: { x: 1400, y: 0 },
				viewport: PHONE
			});

			assert.deepEqual(release, { kind: 'call', side: 'yes', velocity: 1400 });
		});

		it('follows the throw, not the position, when the two disagree', () => {
			const release = resolveDeckRelease({
				x: 130,
				rawY: 0,
				velocity: { x: -1500, y: 0 },
				viewport: PHONE
			});

			assert.equal(release.kind, 'call');
			assert.equal(release.kind === 'call' && release.side, 'no');
		});

		it('passes on an upward throw that is not sideways', () => {
			const release = resolveDeckRelease({
				x: 10,
				rawY: -260,
				velocity: { x: 0, y: -300 },
				viewport: PHONE
			});

			assert.deepEqual(release, { kind: 'pass', velocity: -1200 });
		});

		it('prefers the call when the throw is sideways and upward at once', () => {
			const release = resolveDeckRelease({
				x: 140,
				rawY: -400,
				velocity: { x: 0, y: -2000 },
				viewport: PHONE
			});

			assert.equal(release.kind, 'call');
		});

		it('settles without a bounce on a slow release', () => {
			const release = resolveDeckRelease({
				x: 40,
				rawY: 10,
				velocity: { x: 60, y: 20 },
				viewport: PHONE
			});

			assert.deepEqual(release, { kind: 'snap', damping: 1, velocity: { x: 60, y: 6 } });
		});

		it('bounces only when the release was flicked', () => {
			const release = resolveDeckRelease({
				x: -5,
				rawY: 0,
				velocity: { x: 300, y: 620 },
				viewport: DESKTOP
			});

			assert.equal(release.kind, 'snap');
			assert.equal(release.kind === 'snap' && release.damping, 0.78);
		});
	});

	describe('deckCardFrame', () => {
		it('is flat and unstamped at rest', () => {
			const frame = deckCardFrame({ x: 0, y: 0, flipDeg: 0, viewport: PHONE });

			assert.equal(frame.transform, 'translate3d(0px,0px,0) rotate(0deg)');
			assert.deepEqual(
				[frame.yesOpacity, frame.noOpacity, frame.passOpacity, frame.arm, frame.progress],
				[0, 0, 0, undefined, 0]
			);
		});

		it('fades the Yes stamp in with rightward travel and arms at the threshold', () => {
			const threshold = deckStampThreshold(PHONE.width);
			const half = deckCardFrame({ x: threshold / 2, y: 0, flipDeg: 0, viewport: PHONE });
			const full = deckCardFrame({ x: threshold, y: 0, flipDeg: 0, viewport: PHONE });

			assert.equal(half.yesOpacity, 0.5);
			assert.equal(half.noOpacity, 0);
			assert.equal(half.arm, undefined);
			assert.equal(full.yesOpacity, 1);
			assert.equal(full.arm, 'yes');
			assert.equal(full.progress, 1);
		});

		it('mirrors for No', () => {
			const frame = deckCardFrame({ x: -300, y: 0, flipDeg: 0, viewport: PHONE });

			assert.equal(frame.noOpacity, 1);
			assert.equal(frame.yesOpacity, 0);
			assert.equal(frame.arm, 'no');
		});

		it('tilts with travel, up to the full tilt at one screen width', () => {
			const frame = deckCardFrame({ x: 390, y: 12, flipDeg: 0, viewport: PHONE });

			assert.equal(frame.transform, 'translate3d(390px,12px,0) rotate(14deg)');
		});

		it('shows the pass stamp on upward travel near the centre only', () => {
			const up = deckCardFrame({ x: 0, y: -30, flipDeg: 0, viewport: PHONE });
			const upAndAside = deckCardFrame({ x: 80, y: -30, flipDeg: 0, viewport: PHONE });
			const down = deckCardFrame({ x: 0, y: 30, flipDeg: 0, viewport: PHONE });

			assert.ok(up.passOpacity > 0.5 && up.passOpacity <= 1);
			assert.equal(upAndAside.passOpacity, 0);
			assert.equal(down.passOpacity, 0);
		});

		it('adds perspective only while the card is visibly turned', () => {
			const flat = deckCardFrame({ x: 0, y: 0, flipDeg: 0.2, viewport: PHONE });
			const turned = deckCardFrame({ x: 0, y: 0, flipDeg: 120, viewport: PHONE });

			assert.ok(!flat.transform.includes('perspective'));
			assert.equal(
				turned.transform,
				'perspective(1400px) translate3d(0px,0px,0) rotate(0deg) rotateY(120deg)'
			);
		});
	});

	describe('deckUnderFrame', () => {
		it('rests small and shaded, and is full size and clear at full progress', () => {
			assert.deepEqual(deckUnderFrame(0), { transform: 'scale(0.96)', shade: 0.45 });
			assert.deepEqual(deckUnderFrame(1), { transform: 'scale(1)', shade: 0 });
			assert.equal(DECK_UNDER_REST_TRANSFORM, 'scale(0.96)');
		});
	});

	describe('isDeckFlip3d', () => {
		it('turns in 3D on small screens only, never under reduced motion', () => {
			assert.equal(isDeckFlip3d({ width: 390, reducedMotion: false }), true);
			assert.equal(isDeckFlip3d({ width: 760, reducedMotion: false }), true);
			assert.equal(isDeckFlip3d({ width: 761, reducedMotion: false }), false);
			assert.equal(isDeckFlip3d({ width: 390, reducedMotion: true }), false);
		});
	});

	describe('focusY', () => {
		it('reads the vertical share of an object-position', () => {
			assert.equal(focusY('50% 56%'), 0.56);
			assert.equal(focusY('  50%   0% '), 0);
		});

		it('falls back to the centre on anything else', () => {
			assert.equal(focusY('center'), 0.5);
			assert.equal(focusY(''), 0.5);
		});
	});

	describe('deckSeamStops', () => {
		const seam = 0.743;

		it('ends on the edge where the clip exactly fills the window', () => {
			const stops = deckSeamStops({
				viewport: { width: 720, height: 1280 },
				aspectRatio: 720 / 1280,
				focus: 0.5,
				seam
			});

			assert.equal(stops[stops.length - 1].offsetPx, Math.round(seam * 1280));
			assert.deepEqual(
				stops.map(({ alpha }) => alpha),
				[0, 0.3, 0.66, 0.9, 0.97]
			);
		});

		it('tracks the vertical crop when the window is wider than the clip', () => {
			// 1000 wide at 16:9-ish renders 1000 / (1920 / 1072) tall; the window
			// shows a 400px band of it, placed by the focus.
			const aspectRatio = 1920 / 1072;
			const rendered = 1000 / aspectRatio;
			const top = deckSeamStops({
				viewport: { width: 1000, height: 400 },
				aspectRatio,
				focus: 0,
				seam
			});
			const bottom = deckSeamStops({
				viewport: { width: 1000, height: 400 },
				aspectRatio,
				focus: 1,
				seam
			});

			assert.equal(top[4].offsetPx, Math.round(seam * rendered));
			assert.equal(bottom[4].offsetPx, Math.round(400 - rendered + seam * rendered));
		});

		it('feathers upward from the edge in rising opacity', () => {
			const stops = deckSeamStops({ viewport: PHONE, aspectRatio: 720 / 1280, focus: 0.5, seam });

			for (let i = 1; i < stops.length; i++) {
				assert.ok(stops[i].offsetPx > stops[i - 1].offsetPx);
				assert.ok(stops[i].alpha > stops[i - 1].alpha);
			}
		});
	});

	describe('deckSparkline', () => {
		it('needs two points', () => {
			assert.equal(deckSparkline([]), undefined);
			assert.equal(deckSparkline([50]), undefined);
		});

		it('spans the box left to right and ends on its last point', () => {
			const line = deckSparkline([40, 45, 50]);

			assert.equal(line?.points, '0,13 22,7 44,1');
			assert.deepEqual(line?.end, { x: 44, y: 1 });
			assert.equal(line?.trend, 'up');
		});

		it('reads its own direction', () => {
			assert.equal(deckSparkline([60, 58, 52])?.trend, 'down');
			assert.equal(deckSparkline([50, 55, 50])?.trend, 'flat');
		});

		it('keeps a near-flat series from filling the box', () => {
			const ys = deckSparkline([50, 50.4, 50])
				?.points.split(' ')
				.map((pair) => Number(pair.split(',')[1]));

			assert.ok(ys?.every((y) => y >= 10));
		});

		it('draws only the latest points', () => {
			const history = Array.from({ length: 40 }, (_, i) => i);

			assert.equal(deckSparkline(history)?.points.split(' ').length, 16);
		});
	});

	describe('toLandingDeckCard', () => {
		it('builds the card from a priced open market', () => {
			const card = toLandingDeckCard({
				entry: ENTRY,
				market: market({}),
				history: { yes: [50, 52], xs: [0, 0.5] },
				now: NOW_MS
			});

			assert.equal(card?.yesPercent, 54);
			assert.deepEqual(card?.history, { yes: [50, 52], xs: [0, 0.5] });
			assert.ok(
				Math.abs((card?.yesEarns ?? 0) - (VXP_DEFAULT_CALL_SIZE / 0.54 - VXP_DEFAULT_CALL_SIZE)) <
					1e-9
			);
			assert.ok(
				Math.abs((card?.noEarns ?? 0) - (VXP_DEFAULT_CALL_SIZE / 0.46 - VXP_DEFAULT_CALL_SIZE)) <
					1e-9
			);
		});

		it('prices the return off the book, not the consensus mid', () => {
			const card = toLandingDeckCard({
				entry: ENTRY,
				market: market({ bestAsk: 0.6, bestBid: 0.5 }),
				now: NOW_MS
			});

			assert.ok(
				Math.abs((card?.yesEarns ?? 0) - (VXP_DEFAULT_CALL_SIZE / 0.6 - VXP_DEFAULT_CALL_SIZE)) <
					1e-9
			);
			assert.ok(
				Math.abs((card?.noEarns ?? 0) - (VXP_DEFAULT_CALL_SIZE / 0.5 - VXP_DEFAULT_CALL_SIZE)) <
					1e-9
			);
		});

		it('caps a long shot at the payout floor', () => {
			const card = toLandingDeckCard({
				entry: ENTRY,
				market: market({ yesProbability: 0.01, noProbability: 0.99 }),
				now: NOW_MS
			});

			assert.ok(
				Math.abs(
					(card?.yesEarns ?? 0) - (VXP_DEFAULT_CALL_SIZE / VXP_P_WIN_FLOOR - VXP_DEFAULT_CALL_SIZE)
				) < 1e-9
			);
		});

		it('leaves out a series that did not load, is not open, or has no price', () => {
			assert.equal(toLandingDeckCard({ entry: ENTRY, market: undefined, now: NOW_MS }), undefined);
			assert.equal(
				toLandingDeckCard({ entry: ENTRY, market: market({ status: 'Resolved' }), now: NOW_MS }),
				undefined
			);
			assert.equal(
				toLandingDeckCard({
					entry: ENTRY,
					market: market({ yesProbability: undefined }),
					now: NOW_MS
				}),
				undefined
			);
			assert.equal(
				toLandingDeckCard({
					entry: ENTRY,
					market: market({ yesProbability: Number.NaN }),
					now: NOW_MS
				}),
				undefined
			);
		});

		it('leaves out a market that is not Yes/No', () => {
			for (const payoffType of ['Categorical', 'Call', 'Put'] as const) {
				assert.equal(
					toLandingDeckCard({ entry: ENTRY, market: market({ payoffType }), now: NOW_MS }),
					undefined,
					payoffType
				);
			}
		});

		it('holds a scheduled market back until its start, like every feed surface', () => {
			const startDate = BigInt(NOW_MS + 60_000);

			assert.equal(
				toLandingDeckCard({ entry: ENTRY, market: market({ startDate }), now: NOW_MS }),
				undefined
			);
			assert.ok(
				toLandingDeckCard({ entry: ENTRY, market: market({ startDate }), now: NOW_MS + 60_000 })
			);
			assert.ok(
				toLandingDeckCard({
					entry: ENTRY,
					market: market({ startDate: BigInt(NOW_MS - 1) }),
					now: NOW_MS
				})
			);
		});
	});

	describe('deckSidePercent', () => {
		it('is the price of the called side', () => {
			const card = toLandingDeckCard({ entry: ENTRY, market: market({}), now: NOW_MS });

			assert.ok(card);
			assert.equal(deckSidePercent({ card, side: 'yes' }), 54);
			assert.equal(deckSidePercent({ card, side: 'no' }), 46);
		});
	});

	describe('landingDeckSeries', () => {
		const curated: LandingDeckSeries[] = [
			{ seriesId: 'a', media: 'gta', category: 'gaming' },
			{ seriesId: 'b', media: 'btc', category: 'economy' },
			{ seriesId: 'c', media: 'barca', category: 'sports' }
		];
		const ids = (leadSeriesId?: string): string[] =>
			landingDeckSeries({ curated, leadSeriesId }).map(({ seriesId }) => seriesId);

		it('is the curated order without a lead', () => {
			assert.deepEqual(ids(), ['a', 'b', 'c']);
			assert.deepEqual(ids('  '), ['a', 'b', 'c']);
		});

		it('moves a curated lead to the front, keeping its footage, with no duplicate', () => {
			const series = landingDeckSeries({ curated, leadSeriesId: 'c' });

			assert.deepEqual(
				series.map(({ seriesId }) => seriesId),
				['c', 'a', 'b']
			);
			assert.equal(series[0].media, 'barca');
		});

		it('leads with a series outside the curated set, as a bare entry', () => {
			const series = landingDeckSeries({ curated, leadSeriesId: 'other' });

			assert.deepEqual(series[0], { seriesId: 'other' });
			assert.deepEqual(
				series.map(({ seriesId }) => seriesId),
				['other', 'a', 'b', 'c']
			);
			assert.equal(hasDeckFilm(series[0]), false);
			assert.equal(hasDeckFilm(series[1]), true);
		});

		it('does not mutate the curated list', () => {
			landingDeckSeries({ curated, leadSeriesId: 'c' });

			assert.equal(curated[0].seriesId, 'a');
		});
	});
});

describe('curatedDeckStill', () => {
	const curated: LandingDeckSeries[] = [
		{ seriesId: 'film', media: 'gta', wideFocus: '50% 56%' },
		{ seriesId: 'plain' }
	];

	it('gives a film card its wide still on a wide window, anchored as the deck anchors it', () => {
		assert.deepEqual(
			curatedDeckStill({ seriesId: 'film', viewport: { width: 1440, height: 900 }, curated }),
			{ cut: LANDING_DECK_MEDIA.gta.wide, focus: '50% 56%' }
		);
	});

	it('gives it the upright still on an upright window, centred', () => {
		assert.deepEqual(
			curatedDeckStill({ seriesId: 'film', viewport: { width: 390, height: 760 }, curated }),
			{ cut: LANDING_DECK_MEDIA.gta.tall, focus: '50% 50%' }
		);
	});

	it('gives nothing to a series without footage or outside the deck', () => {
		const viewport = { width: 1440, height: 900 };

		assert.equal(curatedDeckStill({ seriesId: 'plain', viewport, curated }), undefined);
		assert.equal(curatedDeckStill({ seriesId: 'other', viewport, curated }), undefined);
	});
});
