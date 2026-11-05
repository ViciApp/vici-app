// Flow Mode generative artwork — public entry point.
//
// Six per-category visual languages (macro / crypto / sports /
// politics / tech / culture) plus the WC editorial system, × three
// states (neutral / won / lost) × theme. Same
// `(category, seed, state, theme)` tuple always renders the identical
// composition — theme is part of the seed key (it tunes the palette and
// the `<defs>` ids), not a pure post-hoc recolor. The seed flows through
// a FNV-1a hash + mulberry32 PRNG so output is byte-stable across reloads.
//
// Returns SVG strings — components mount via {@html ...}. No DOM
// access, no I/O — pure helper.

import { PAL } from '#lib/constants/flow-art-palettes.constants.ts';
import {
	classificationTags,
	isMacroId,
	primaryMacro
} from '#lib/constants/market-taxonomy.constants.ts';
import { renderCrypto } from '#lib/utils/flow-art/renderers/crypto.ts';
import { renderCulture } from '#lib/utils/flow-art/renderers/culture.ts';
import { renderMacro } from '#lib/utils/flow-art/renderers/macro.ts';
import { renderPolitics } from '#lib/utils/flow-art/renderers/politics.ts';
import { renderSports } from '#lib/utils/flow-art/renderers/sports.ts';
import { renderTech } from '#lib/utils/flow-art/renderers/tech.ts';
import { hashStr, makeRng } from '#lib/utils/flow-art/rng.ts';
import { bgRect, frameInset, svgClose, svgOpen, svgOpenWC } from '#lib/utils/flow-art/svg.ts';
import {
	FLOW_ART_CATEGORIES,
	MACRO_ART_BUCKET,
	type FlowArtBucket,
	type FlowArtCategory,
	type FlowArtRenderOptions,
	type RenderArgs
} from '#lib/utils/flow-art/types.ts';
import { renderWC } from '#lib/utils/flow-art/wc/render.ts';
import { nonNullish } from '@dfinity/utils';

const RENDERERS: Record<FlowArtBucket, (args: RenderArgs) => string> = {
	macro: renderMacro,
	crypto: renderCrypto,
	sports: renderSports,
	politics: renderPolitics,
	tech: renderTech,
	culture: renderCulture
};

/**
 * Resolve the render bucket + palette key for a public category. `wc` is the
 * editorial tentpole (its own renderer + palette); every macro folds onto one
 * of the six bespoke visual languages via {@link MACRO_ART_BUCKET}.
 */
const artBucket = (category: FlowArtCategory): FlowArtBucket | 'wc' =>
	category === 'wc' ? 'wc' : MACRO_ART_BUCKET[category];

// =============================================================
//   Public API
// =============================================================

export const renderFlowArt = ({
	category,
	seed,
	state = 'neutral',
	theme = 'dark',
	size = 240,
	frame = false,
	title
}: FlowArtRenderOptions): string => {
	const bucket = artBucket(category);
	const renderer = bucket === 'wc' ? renderWC : RENDERERS[bucket];
	const categoryPalettes = PAL[bucket] ?? PAL.macro;
	const themePalettes = categoryPalettes[theme] ?? categoryPalettes.dark;
	const pal = themePalettes[state] ?? themePalettes.neutral;
	const seedKey = `${category}::${seed}::${state}::${theme}`;
	const rng = makeRng(seedKey);
	// Stable per-render suffix for SVG `<defs>` ids. Multiple
	// FlowArtFrames render simultaneously in the FlowMode deck and
	// `<defs>` ids live in the document scope — without a suffix,
	// `url(#mwash)` would resolve to the first match in the document
	// (potentially another card's gradient).
	const uid = hashStr(seedKey).toString(36);
	const body = renderer({ rng, p: pal, state, uid, seed, title });

	if (category === 'wc') {
		// WC fills its own 280×100 background and is excluded from the
		// optional inset frame — its full-bleed editorial composition
		// already supplies the visual containment.
		return svgOpenWC(size) + body + svgClose();
	}

	let svg = svgOpen(size) + bgRect(pal) + body;

	if (frame) {
		svg += frameInset({ p: pal, state });
	}

	svg += svgClose();

	return svg;
};

/**
 * Resolve a `FlowArtCategory` for a market from its stored `tags`:
 *
 * 1. A `world-cup` free tag pins the FIFA-themed `wc` editorial variant,
 *    preserving the tentpole look independent of the market's micros.
 * 2. Otherwise the market's {@link primaryMacro} drives the artwork.
 * 3. Untagged markets (no micros) fall back to a deterministic
 *    hash-of-`seed` bucket so they still render stable artwork.
 *
 * `seed` is typically `market.id`. Passing a bare macro id as a single-
 * element `tags` array (e.g. `[macro]`) is also supported for the surfaces
 * that only hold a resolved macro.
 */
export const resolveFlowArtCategory = ({
	tags,
	seed
}: {
	tags?: readonly string[] | null;
	seed: string | number;
}): FlowArtCategory => {
	const values = tags ?? [];

	if (classificationTags(values).includes('world-cup')) {
		return 'wc';
	}

	const macro = primaryMacro(values);

	if (nonNullish(macro)) {
		return macro;
	}

	// No micros: some surfaces pass a bare macro id (not a micro) they
	// resolved elsewhere — honour it before the hash fallback.
	const bare = values.find((value) => isMacroId(value));

	if (nonNullish(bare)) {
		return bare;
	}

	const idx = hashStr(String(seed)) % FLOW_ART_CATEGORIES.length;

	return FLOW_ART_CATEGORIES[idx];
};

export { flowArtViewBox } from '#lib/utils/flow-art/svg.ts';
export {
	FLOW_ART_CATEGORIES,
	FLOW_ART_CATEGORY_SET,
	MACRO_ART_BUCKET
} from '#lib/utils/flow-art/types.ts';
export type {
	FlowArtBucket,
	FlowArtCategory,
	FlowArtPalette,
	FlowArtRenderOptions,
	FlowArtState,
	FlowArtTheme
} from '#lib/utils/flow-art/types.ts';
