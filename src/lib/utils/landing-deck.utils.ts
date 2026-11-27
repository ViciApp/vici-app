import { LANDING_DECK_FLIP_3D_MAX_WIDTH } from '#lib/constants/landing.constants.ts';
import { VXP_DEFAULT_CALL_SIZE } from '#lib/constants/vxp-economy.constants.ts';
import type {
	LandingDeckCard,
	LandingDeckFilm,
	LandingDeckSeries,
	LandingDeckSide
} from '#lib/types/landing.ts';
import type { Market } from '#lib/types/market.ts';
import { isMarketRevealed } from '#lib/utils/market-reveal.utils.ts';
import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
import { projectMomentum, rubberBand, type Velocity2d } from '#lib/utils/spring.utils.ts';
import { vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Geometry and decisions of the landing deck's swipe: how far a card must
 * travel to arm and to commit, what a release resolves to, and what a card
 * looks like at a given offset. Pure, so the feel is pinned by specs.
 */

export interface DeckViewport {
	width: number;
	height: number;
}

export type DeckArm = LandingDeckSide | undefined;

export interface DeckCardFrame {
	transform: string;
	yesOpacity: number;
	noOpacity: number;
	passOpacity: number;
	/** The side whose stamp is fully in: releasing here commits it. */
	arm: DeckArm;
	/** 0 at rest, 1 once a stamp is fully in; drives the card underneath. */
	progress: number;
}

export type DeckRelease =
	| { kind: 'call'; side: LandingDeckSide; velocity: number }
	| { kind: 'pass'; velocity: number }
	| { kind: 'snap'; damping: number; velocity: Velocity2d };

/** Share of vertical finger travel the card follows: a swipe is sideways first. */
export const DECK_VERTICAL_FOLLOW = 0.3;

const MAX_TILT_DEG = 14;
const FLIP_PERSPECTIVE_PX = 1400;
// Below half a degree the turn is invisible, and leaving `perspective` out
// keeps a flat card on the cheaper 2D compositing path.
const FLIP_VISIBLE_DEG = 0.5;
const DRAG_FREE_SHARE = 0.6;

const MIN_CALL_THROW_VELOCITY = 900;
const MIN_PASS_THROW_VELOCITY = 1200;
const FLICK_VELOCITY = 600;
const FLICK_DAMPING = 0.78;
const SETTLE_DAMPING = 1;

const UNDER_SCALE = 0.96;
const UNDER_SHADE = 0.45;

/** Sideways travel at which a stamp is fully in. */
export const deckStampThreshold = (width: number): number => Math.min(width * 0.22, 160);

/** Projected sideways travel past which a release commits the call. */
export const deckCommitThreshold = (width: number): number => Math.min(width * 0.28, 220);

/** Projected upward travel past which a release passes. */
export const deckPassThreshold = (height: number): number => Math.min(height * 0.3, 260);

const deckPassStampTravel = (height: number): number => Math.min(height * 0.22, 180);

/** How far the attract demo rocks the card: always past the stamp threshold. */
export const deckAttractAmplitude = (width: number): number =>
	Math.max(deckStampThreshold(width) * 1.08, Math.min(width * 0.24, 230));

/** The card follows the finger 1:1, then resists past most of the screen width. */
export const deckDragX = ({ rawX, width }: { rawX: number; width: number }): number => {
	const limit = width * DRAG_FREE_SHARE;
	const distance = Math.abs(rawX);

	if (distance <= limit) {
		return rawX;
	}

	return Math.sign(rawX) * (limit + rubberBand({ over: distance - limit, dimension: width }));
};

/**
 * What lifting the finger means. Momentum is projected first, so a short
 * fast flick commits like a long slow drag; a pass needs an upward throw
 * that is not also a sideways one; anything else returns to rest, with a
 * bounce only when it was flicked.
 */
export const resolveDeckRelease = ({
	x,
	rawY,
	velocity,
	viewport: { width, height }
}: {
	x: number;
	/** Vertical finger travel, before the card's reduced follow. */
	rawY: number;
	velocity: Velocity2d;
	viewport: DeckViewport;
}): DeckRelease => {
	const commit = deckCommitThreshold(width);
	const projectedX = x + projectMomentum({ velocity: velocity.x });

	if (projectedX > commit) {
		return { kind: 'call', side: 'yes', velocity: Math.max(velocity.x, MIN_CALL_THROW_VELOCITY) };
	}

	if (projectedX < -commit) {
		return { kind: 'call', side: 'no', velocity: Math.min(velocity.x, -MIN_CALL_THROW_VELOCITY) };
	}

	const projectedY = rawY + projectMomentum({ velocity: velocity.y });

	if (projectedY < -deckPassThreshold(height) && Math.abs(projectedX) < commit * 0.6) {
		return { kind: 'pass', velocity: Math.min(velocity.y, -MIN_PASS_THROW_VELOCITY) };
	}

	const flicked = Math.hypot(velocity.x, velocity.y) > FLICK_VELOCITY;

	return {
		kind: 'snap',
		damping: flicked ? FLICK_DAMPING : SETTLE_DAMPING,
		velocity: { x: velocity.x, y: velocity.y * DECK_VERTICAL_FOLLOW }
	};
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** What a card looks like at offset (`x`, `y`) and `flipDeg` degrees of turn. */
export const deckCardFrame = ({
	x,
	y,
	flipDeg,
	viewport: { width, height }
}: {
	x: number;
	y: number;
	flipDeg: number;
	viewport: DeckViewport;
}): DeckCardFrame => {
	const turning = flipDeg > FLIP_VISIBLE_DEG;
	const threshold = deckStampThreshold(width);
	const progress = Math.min(1, Math.abs(x) / threshold);
	const rawY = -y / DECK_VERTICAL_FOLLOW;

	return {
		transform: `${
			turning ? `perspective(${FLIP_PERSPECTIVE_PX}px) ` : ''
		}translate3d(${x}px,${y}px,0) rotate(${(x / width) * MAX_TILT_DEG}deg)${
			turning ? ` rotateY(${flipDeg}deg)` : ''
		}`,
		yesOpacity: x > 0 ? progress : 0,
		noOpacity: x < 0 ? progress : 0,
		passOpacity: Math.abs(x) < threshold * 0.5 ? clamp01(rawY / deckPassStampTravel(height)) : 0,
		arm: progress >= 1 ? (x > 0 ? 'yes' : 'no') : undefined,
		progress
	};
};

/** The card underneath rises to full size and sheds its shade as the top card leaves. */
export const deckUnderFrame = (progress: number): { transform: string; shade: number } => ({
	transform: `scale(${UNDER_SCALE + (1 - UNDER_SCALE) * progress})`,
	shade: UNDER_SHADE * (1 - progress)
});

export const DECK_UNDER_REST_TRANSFORM = deckUnderFrame(0).transform;

/** Small screens turn the card over in 3D; never under reduced motion. */
export const isDeckFlip3d = ({
	width,
	reducedMotion
}: {
	width: number;
	reducedMotion: boolean;
}): boolean => !reducedMotion && width <= LANDING_DECK_FLIP_3D_MAX_WIDTH;

/** Vertical share (0 to 1) of a two-value `object-position` such as `50% 56%`. */
export const focusY = (position: string): number => {
	const share = Number.parseFloat(position.trim().split(/\s+/)[1] ?? '');

	return Number.isFinite(share) ? share / 100 : 0.5;
};

export interface DeckSeamStop {
	/** Opacity of the shade at this stop. */
	alpha: number;
	/** Distance from the top of the window, px. */
	offsetPx: number;
}

// Feather of the shade above the footage's dark edge: opacity, and how far
// above the edge (as a share of the window height) that opacity is reached.
const SEAM_FEATHER: readonly (readonly [alpha: number, above: number])[] = [
	[0, 0.2],
	[0.3, 0.12],
	[0.66, 0.055],
	[0.9, 0.018],
	[0.97, 0]
];

/**
 * Gradient stops of the shade that ends on a hard dark edge in the footage.
 * The edge sits `seam` of the way down the clip; where that lands in the
 * window depends on how `object-fit: cover` crops the clip, hence the
 * clip's aspect ratio and its vertical focus.
 */
export const deckSeamStops = ({
	viewport: { width, height },
	aspectRatio,
	focus,
	seam
}: {
	viewport: DeckViewport;
	aspectRatio: number;
	/** Vertical `object-position` share, 0 to 1. */
	focus: number;
	seam: number;
}): DeckSeamStop[] => {
	const renderedHeight = Math.max(height, width / aspectRatio);
	const edge = (height - renderedHeight) * focus + seam * renderedHeight;

	return SEAM_FEATHER.map(([alpha, above]) => ({
		alpha,
		offsetPx: Math.round(edge - above * height)
	}));
};

export type DeckTrend = 'up' | 'down' | 'flat';

export interface DeckSparkline {
	points: string;
	end: { x: number; y: number };
	trend: DeckTrend;
}

export const DECK_SPARKLINE_WIDTH = 44;
export const DECK_SPARKLINE_HEIGHT = 14;
const SPARKLINE_POINTS = 16;
const SPARKLINE_INSET = 1;
const SPARKLINE_MIN_RANGE = 2;

const trendOf = (delta: number): DeckTrend => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');

/** The small price line beside the category: the latest points of `history`. */
export const deckSparkline = (history: readonly number[]): DeckSparkline | undefined => {
	const values = history.slice(-SPARKLINE_POINTS);

	if (values.length < 2) {
		return;
	}

	const low = Math.min(...values);
	const range = Math.max(SPARKLINE_MIN_RANGE, Math.max(...values) - low);
	const drawable = DECK_SPARKLINE_HEIGHT - 2 * SPARKLINE_INSET;

	const coords = values.map((value, i) => ({
		x: Number(((i / (values.length - 1)) * DECK_SPARKLINE_WIDTH).toFixed(1)),
		y: Number(
			(DECK_SPARKLINE_HEIGHT - SPARKLINE_INSET - ((value - low) / range) * drawable).toFixed(1)
		)
	}));

	return {
		points: coords.map(({ x, y }) => `${x},${y}`).join(' '),
		end: coords[coords.length - 1],
		trend: trendOf(Math.round(values[values.length - 1]) - Math.round(values[0]))
	};
};

/**
 * The YES price's move over the last 24 hours in whole points: now against
 * the first traded price in that rolling window (the `1d` history period,
 * not the calendar day). `undefined` when nothing traded in it, so the card
 * states no move instead of an invented "flat".
 */
export const deckMove24h = ({
	history,
	yesPercent
}: {
	history: readonly number[] | undefined;
	yesPercent: number;
}): number | undefined => {
	if (isNullish(history) || history.length === 0) {
		return;
	}

	return yesPercent - Math.round(history[0]);
};

/**
 * The card for a loaded series, or `undefined` when it cannot be shown
 * honestly: no market, not a Yes/No market, not open, not released yet
 * (the same start gate as every other feed surface), or no crowd price yet.
 */
export const toLandingDeckCard = ({
	entry,
	market,
	history,
	now
}: {
	entry: LandingDeckSeries;
	market: Market | undefined;
	history?: number[];
	/** Client clock (ms) the release start is read against. */
	now: number;
}): LandingDeckCard | undefined => {
	if (
		isNullish(market) ||
		market.payoffType !== 'Binary' ||
		market.status !== 'Open' ||
		!isMarketRevealed({ startDate: market.startDate, now }) ||
		isNullish(market.yesProbability)
	) {
		return;
	}

	const yesPercent = Math.round(market.yesProbability * 100);

	if (!Number.isFinite(yesPercent) || yesPercent < 0 || yesPercent > 100) {
		return;
	}

	const earns = (action: 'YES' | 'NO'): number =>
		vxpNetWin({
			amount: VXP_DEFAULT_CALL_SIZE,
			pWin: resolveOutcomeExecutionPrice({ market, action })
		});

	return { entry, market, yesPercent, yesEarns: earns('YES'), noEarns: earns('NO'), history };
};

/** Whole-percent price of `side` on a card. */
export const deckSidePercent = ({
	card,
	side
}: {
	card: LandingDeckCard;
	side: LandingDeckSide;
}): number => (side === 'yes' ? card.yesPercent : 100 - card.yesPercent);

/**
 * The deck's series in order: the series the page leads with first (its
 * curated entry when it is one of them, a bare entry otherwise), then the
 * curated ones, none twice.
 */
export const landingDeckSeries = ({
	curated,
	leadSeriesId
}: {
	curated: readonly LandingDeckSeries[];
	leadSeriesId?: string;
}): LandingDeckSeries[] => {
	const lead = leadSeriesId?.trim() ?? '';

	if (lead === '') {
		return [...curated];
	}

	return [
		curated.find(({ seriesId }) => seriesId === lead) ?? { seriesId: lead },
		...curated.filter(({ seriesId }) => seriesId !== lead)
	];
};

export const hasDeckFilm = (entry: LandingDeckSeries): entry is LandingDeckFilm =>
	nonNullish(entry.media);
