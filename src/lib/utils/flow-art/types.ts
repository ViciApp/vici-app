// Flow Mode generative artwork — shared public + internal types.
//
// Extracted from the original flow-art.utils.ts during the structural
// split; behaviour-identical, no logic here.

import { MACRO_IDS, type MacroId } from '#lib/constants/market-taxonomy.constants.ts';
import type { Theme } from '#lib/stores/theme.store.ts';

/**
 * Public artwork category: the seven taxonomy macros plus the opt-in `wc`
 * tentpole editorial variant. `wc` is not a macro — it's the FIFA-themed
 * World-Cup composition preserved from the tentpole deck, resolved from a
 * `world-cup` free tag rather than derived from a micro.
 */
export type FlowArtCategory = MacroId | 'wc';

/**
 * Internal render bucket: the six bespoke generative visual languages. Each
 * macro maps onto exactly one bucket via {@link MACRO_ART_BUCKET} — macros
 * without a bespoke language (e.g. `world`, `economy`) share the closest
 * relative — so the renderer / palette tables stay keyed by these six plus
 * the separately-dispatched `wc`.
 */
export type FlowArtBucket = 'macro' | 'crypto' | 'sports' | 'politics' | 'tech' | 'culture';

/** Macro → render bucket. `wc` is handled outside this map (editorial). */
export const MACRO_ART_BUCKET: Record<MacroId, FlowArtBucket> = {
	politics: 'politics',
	world: 'politics',
	economy: 'macro',
	crypto: 'crypto',
	tech: 'tech',
	culture: 'culture',
	sports: 'sports'
};

export type FlowArtState = 'neutral' | 'won' | 'lost';
// FlowArt's palette dimension is keyed by the app-wide `Theme` union;
// re-export under a domain alias so existing call sites read naturally.
export type FlowArtTheme = Theme;

/**
 * Canonical category set used for random category assignment when a market
 * has no micro tags. The seven macros, in canonical order. `wc` is
 * intentionally excluded — it's a tentpole-only language and must be opt-in
 * via a `world-cup` free tag (typically driven by the FeaturedEvent
 * abstraction).
 */
export const FLOW_ART_CATEGORIES: readonly MacroId[] = MACRO_IDS;

/**
 * Pre-built lookup set for `FLOW_ART_CATEGORIES` plus the opt-in `wc`
 * tentpole. Three Flow surfaces (FlowCard, FlowMode, market-signals) need
 * to test whether an arbitrary string is a known category — exporting the
 * Set once avoids each consumer rebuilding it on module load.
 */
export const FLOW_ART_CATEGORY_SET: ReadonlySet<string> = new Set<FlowArtCategory>([
	...FLOW_ART_CATEGORIES,
	'wc'
]);

export interface FlowArtPalette {
	bg: string;
	base: string;
	ink: string;
	accent: string;
	hot: string;
	dim: string;
	fg: string;
	// `culture` is the only category whose palette ships an additional
	// six-colour ink set. All other categories leave it undefined.
	inks?: readonly string[];
}

export interface FlowArtRenderOptions {
	category: FlowArtCategory;
	// Stable per-market seed. Pass `market.id` (or any deterministic
	// string / number — strings are FNV-1a hashed first).
	seed: string | number;
	state?: FlowArtState;
	theme?: FlowArtTheme;
	// Output viewBox is always 0 0 100 100; `size` controls the
	// rendered width / height attributes (px). Spec checks 80 / 140 / 220.
	size?: number;
	// When true, draws an additional inset stroke frame inside the
	// composition. Off by default; FlowCard layers a separate frame.
	frame?: boolean;
	// Optional market question text. Only the WC renderer consults it —
	// to resolve per-market artwork from the question, first via the
	// authoritative `WC_MARKET_ART` catalogue, then the heuristic
	// resolver. Absent (the default at every non-WC call site and any WC
	// site without the question handy) → behaviour unchanged: the WC
	// renderer keeps its curated-recipe / nation / generic resolution.
	title?: string;
}

export interface Rng {
	r: () => number;
	range: (lo: number, hi: number) => number;
	pick: <T>(arr: readonly T[]) => T;
	int: (lo: number, hi: number) => number;
	chance: (p: number) => boolean;
}

// Renderer protocol — every category renderer takes the same args
// so the dispatch table types cleanly. Object form (vs positional) per
// the repo's `prefer-object-params` convention.
//
// `uid` is a stable per-render suffix appended to every SVG `<defs>`
// id (gradients, filters, etc.) so multiple FlowArtFrames on the same
// document never collide on `url(#mwash)` lookups. Derived from the
// hash of `${category}::${seed}::${state}::${theme}` so identical inputs
// reuse the same uid (the renderer is still deterministic).
export interface RenderArgs {
	rng: Rng;
	p: FlowArtPalette;
	state: FlowArtState;
	uid: string;
	// Original render seed (typically a market id). Renderers that
	// need to pin specific markets to specific outputs (e.g. WC kits
	// per nation) read this; everything else stays seed-derived via
	// `rng`.
	seed: string | number;
	// Optional market question text. Only the WC renderer reads it — to
	// look up per-market artwork in the `WC_MARKET_ART` catalogue (then
	// the heuristic resolver); undefined for every other renderer and any
	// WC render without a question.
	title?: string;
}
