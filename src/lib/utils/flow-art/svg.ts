// Flow Mode generative artwork — SVG scaffolding primitives.
//
// Shared math helpers (deg / lerp) used by the category renderers,
// plus the document open/close + background helpers.

import type { FlowArtCategory, FlowArtPalette, FlowArtState } from '#lib/utils/flow-art/types.ts';

export const deg = (d: number): number => (d * Math.PI) / 180;
// Standard math-helper signature `(a, b, t)` — `prefer-object-params`
// relaxed since `lerp` is called dozens of times per render and an
// object form would obscure the math.
// eslint-disable-next-line local-rules/prefer-object-params
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const svgOpen = (size: number): string =>
	`<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision">`;

// WC uses a wider 280×100 viewBox so the editorial figure system can
// span the full-bleed artwork band edge-to-edge. `slice` fill keeps
// the band tight to its container without empty letterboxing.
export const svgOpenWC = (size: number): string => {
	const h = Math.round((size * 100) / 280);

	return `<svg viewBox="0 0 280 100" width="${size}" height="${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" shape-rendering="geometricPrecision">`;
};

/**
 * Public viewBox dimensions per category. Default categories render
 * into a square 100×100 viewBox; `wc` uses a wider 280×100 band so
 * the figure system spans full-bleed. `FlowArtFrame` reads this to
 * size its host element with the correct aspect ratio.
 */
export const flowArtViewBox = (category: FlowArtCategory): { width: number; height: number } =>
	category === 'wc' ? { width: 280, height: 100 } : { width: 100, height: 100 };

export const svgClose = (): string => `</svg>`;

export const bgRect = (p: FlowArtPalette): string =>
	`<rect width="100" height="100" fill="${p.bg}"/>`;

export const frameInset = ({ p, state }: { p: FlowArtPalette; state: FlowArtState }): string => {
	const stroke = state === 'won' ? p.accent : p.dim;
	const op = state === 'won' ? 0.45 : 0.2;

	return `<rect x="2" y="2" width="96" height="96" rx="6" fill="none" stroke="${stroke}" stroke-opacity="${op}" stroke-width="0.5"/>`;
};
