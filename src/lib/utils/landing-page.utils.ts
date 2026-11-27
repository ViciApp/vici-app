import {
	LANDING_CALLS_MAX,
	LANDING_CALLS_TTL_MS,
	LANDING_FLOAT_LAND_RADIUS_PX,
	LANDING_FLOAT_ORIGIN_Y
} from '#lib/constants/landing-page.constants.ts';
import type { LandingCall } from '#lib/types/landing-call.ts';
import { isNullish } from '@dfinity/utils';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && !isNullish(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const isLandingCall = (value: unknown): value is LandingCall =>
	isRecord(value) &&
	typeof value.seriesId === 'string' &&
	(value.side === 'yes' || value.side === 'no') &&
	isFiniteNumber(value.pricePercent) &&
	isFiniteNumber(value.atMs) &&
	(isNullish(value.amountVxp) || isFiniteNumber(value.amountVxp));

/** What browser storage held, read as calls: anything that is not one is dropped. */
export const parseLandingCalls = (stored: unknown): LandingCall[] =>
	Array.isArray(stored) ? stored.filter(isLandingCall) : [];

/** The calls worth keeping: the latest few, none older than a week. */
export const keepRecentLandingCalls = ({
	calls,
	nowMs
}: {
	calls: readonly LandingCall[];
	nowMs: number;
}): LandingCall[] =>
	calls.filter(({ atMs }) => nowMs - atMs < LANDING_CALLS_TTL_MS).slice(-LANDING_CALLS_MAX);

export interface LandingFloatBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface LandingFloatLanding {
	/** Translation and scale that carry the full-window card onto the target. */
	dx: number;
	dy: number;
	scale: number;
	/** `clip-path: inset()` of the card, in its own unscaled pixels, that leaves exactly the target's shape. */
	insetY: number;
	insetX: number;
	radius: number;
}

/**
 * Where a full-window deck card lands when it floats onto a smaller box: it
 * scales to cover the box and is clipped to it, so the picture arrives
 * framed as the box frames it.
 */
export const landingFloatLanding = ({
	viewport: { width, height },
	target
}: {
	viewport: { width: number; height: number };
	target: LandingFloatBox;
}): LandingFloatLanding => {
	const scale = Math.max(target.width / width, target.height / height);

	return {
		dx: target.left + target.width / 2 - width / 2,
		// The card scales around a point below its centre, so the centre it
		// lands on shifts with the scale.
		dy:
			target.top +
			target.height / 2 -
			LANDING_FLOAT_ORIGIN_Y * height +
			(LANDING_FLOAT_ORIGIN_Y - 0.5) * height * scale,
		scale,
		insetY: Math.max(0, (height - target.height / scale) / 2),
		insetX: Math.max(0, (width - target.width / scale) / 2),
		radius: LANDING_FLOAT_LAND_RADIUS_PX / scale
	};
};
