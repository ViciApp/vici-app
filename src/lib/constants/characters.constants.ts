import type { FlameStage } from '#lib/utils/streak.utils.ts';

/**
 * The five companion characters. Each is a hand-drawn SVG silhouette
 * (see `#lib/components/characters/`) with a single accent fill + a
 * darker `deep` shade used for shadowing / secondary marks.
 *
 * - **vici** — the friendly guide bot (four moods).
 * - **oracle** — the hooded seer (inner-glow pulse + twinkles).
 * - **trickster** — the contrarian fox (ear twitch, tail sway, optional bolt).
 * - **archivist**: held in reserve, an accent only with no silhouette yet.
 * - **flame** — the streak indicator (five stages, see {@link FLAME_STAGES}).
 */
export const CHARACTERS = ['vici', 'oracle', 'trickster', 'archivist', 'flame'] as const;

export type Character = (typeof CHARACTERS)[number];

/**
 * Per-character accent palette. The same hues are mirrored as
 * `--char-*` / `--char-*-deep` custom properties in `src/app.css` for
 * surfaces that tint via CSS (companion chips, trait dots). Components
 * that bake the color straight into SVG `fill` attributes read from
 * here so the two never drift.
 */
export const CHAR_PALETTE: Record<Character, { fill: string; deep: string }> = {
	vici: { fill: '#B7B0E8', deep: '#6F66B3' },
	oracle: { fill: '#E2B842', deep: '#8C6E1A' },
	trickster: { fill: '#FF8A7A', deep: '#B14E42' },
	archivist: { fill: '#5DB6A9', deep: '#2E6E66' },
	flame: { fill: '#F08A3C', deep: '#8C3A0A' }
};

/**
 * Ink used for facial features / line work that sits on top of a
 * character's accent fill, and the parchment-cream used for highlights
 * (eyes, ear insets). Shared so every
 * silhouette renders against the same two neutrals.
 */
export const CHAR_INK = '#0E0D0B';
export const CHAR_CREAM = '#F2ECDC';

/**
 * The five Flame stages, keyed by streak tier (see
 * {@link stageForStreak}). `core` is the body fill, `tip` the inner
 * highlight, and `scale` grows the silhouette as the streak climbs so
 * a longer run literally reads as a bigger fire.
 */
export const FLAME_STAGES: Record<FlameStage, { core: string; tip: string; scale: number }> = {
	spark: { core: '#F08A3C', tip: '#FFD27A', scale: 0.55 },
	ember: { core: '#F08A3C', tip: '#FFD27A', scale: 0.72 },
	flame: { core: '#F08A3C', tip: '#FFD27A', scale: 0.88 },
	blaze: { core: '#FF6B3C', tip: '#FFC04A', scale: 1.0 },
	inferno: { core: '#FF4F8E', tip: '#FFB04A', scale: 1.08 }
};
