import type { MessageKey } from '#lib/utils/i18n.utils.ts';

// ─────────────────────────────────────────────────────────────────────────────
// THE MENAGERIE — the achievement trophy layer.
//
// Twelve animals, each with a tier ladder (wood → silver → gold → iridescent).
// An animal's current tier is derived live from the owner's real stats (see
// `#lib/utils/menagerie.utils.ts`); this file is the static catalogue: identity,
// copy keys, the palette tokens that colour each glyph, and the tier ladders.
//
// The glyph SVG sprite lives in `#lib/components/menagerie/MenagerieSprite.svelte`
// and the per-animal CSS palette variables (`--menagerie-{slug}` /
// `-{slug}-deep`) are declared in `MenagerieSprite.svelte`'s scoped `:global`
// block so both the sprite and the badge frames can reference them.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum run of consecutive settled losses that makes the next settled win
 * count as a comeback (the Honey Badger metric, recomputed from clearing
 * history in `calculateAndSyncStats`). One or two losses is everyday
 * variance; three straight is a genuine cold streak worth celebrating the
 * recovery from. */
export const COMEBACK_COLD_STREAK_LOSSES = 3;

/** A category counts toward the Magpie (all-rounder) metric once the owner
 * has at least this many settled calls in it — accuracy on fewer calls isn't
 * yet a signal of breadth. */
export const MAGPIE_MIN_CATEGORY_CALLS = 3;

/** …and at least this win ratio (0..1) across those calls. */
export const MAGPIE_MIN_CATEGORY_ACCURACY = 0.5;

/** Tier rungs, lowest → highest. `irid` = iridescent (the rarest). */
export type MenagerieTier = 'wood' | 'silver' | 'gold' | 'irid';

/** Stable ordering used for tier comparisons and crossing detection. */
export const MENAGERIE_TIER_RANK: Record<MenagerieTier, number> = {
	wood: 1,
	silver: 2,
	gold: 3,
	irid: 4
};

/** Animal identifiers — also the sprite symbol + palette token suffix. */
export type MenagerieSlug =
	| 'hatchling'
	| 'beaver'
	| 'rooster'
	| 'snake'
	| 'owl'
	| 'raven'
	| 'octopus'
	| 'magpie'
	| 'badger'
	| 'parrot'
	| 'bee'
	| 'goat';

/** One rung of an animal's ladder: the tier and the metric threshold it needs. */
export interface MenagerieTierStep {
	tier: MenagerieTier;
	/** Threshold the animal's metric must reach (or, for reversed metrics, fall to). */
	t: number;
}

export interface MenagerieAnimal {
	slug: MenagerieSlug;
	nameKey: MessageKey;
	/** The animal's evocative one-liner ("First light", "The greatest"). */
	oracleKey: MessageKey;
	/** The plain-English rule ("Make your first prediction."). */
	ruleKey: MessageKey;
	/** Short concept label shown when the animal is earned ("Accuracy", "Volume"). */
	conceptKey: MessageKey;
	/** Per-tier milestone labels ("65%", "10 calls") — same length as `tiers`. */
	labelKeys: MessageKey[];
	/** Hero animals get the "LEGENDARY" eyebrow + extra frame glow at top tiers. */
	hero?: boolean;
	/** Lower-is-better metric (consensus magnitude, rank percentile). */
	reversed?: boolean;
	/** The tier ladder for this animal, lowest threshold first. */
	tiers: MenagerieTierStep[];
}

// Per-animal body + deep colours. Collision-safe against the YES (mint) / NO
// (coral) market palette. Emitted as `--menagerie-{slug}` / `-{slug}-deep` CSS
// variables by `MenagerieSprite.svelte`.
export const MENAGERIE_PALETTES: Record<MenagerieSlug, { body: string; deep: string }> = {
	hatchling: { body: '#F2C14E', deep: '#C9912A' },
	beaver: { body: '#BD8A52', deep: '#8A6336' },
	rooster: { body: '#F0883C', deep: '#B85A1E' },
	snake: { body: '#B89038', deep: '#846026' },
	owl: { body: '#E2B842', deep: '#8C6E1A' },
	raven: { body: '#5A6B92', deep: '#36405C' },
	octopus: { body: '#B56C9B', deep: '#854A73' },
	magpie: { body: '#56A6B4', deep: '#357C8B' },
	badger: { body: '#45433D', deep: '#26251F' },
	parrot: { body: '#7E89D6', deep: '#4E5AA6' },
	bee: { body: '#E0A52E', deep: '#9C6E14' },
	goat: { body: '#7E5BC4', deep: '#543A8C' }
};

/** Frame colour per tier. Iridescent uses a conic gradient in CSS; this is its
 * representative swatch (the violet sheen) for dots / eyebrows / progress fills. */
export const MENAGERIE_TIER_COLORS: Record<MenagerieTier, string> = {
	wood: '#C08A52',
	silver: '#C6CAD2',
	gold: '#E2B842',
	irid: '#C79BE8'
};

// ── The catalogue — 12 entries, ordered by reveal cadence (Hatchling first) ──
// Some ladders are 1-step (Hatchling), most are 3-step (volume / count), and the
// skill ladders (Owl accuracy, Octopus upset, Goat rank) are 4-step.
export const MENAGERIE: MenagerieAnimal[] = [
	{
		slug: 'hatchling',
		nameKey: 'menagerie.hatchling.name',
		oracleKey: 'menagerie.hatchling.oracle',
		ruleKey: 'menagerie.hatchling.rule',
		conceptKey: 'menagerie.hatchling.concept',
		labelKeys: ['menagerie.hatchling.label.wood'],
		tiers: [{ tier: 'wood', t: 1 }]
	},
	{
		slug: 'beaver',
		nameKey: 'menagerie.beaver.name',
		oracleKey: 'menagerie.beaver.oracle',
		ruleKey: 'menagerie.beaver.rule',
		conceptKey: 'menagerie.beaver.concept',
		labelKeys: [
			'menagerie.beaver.label.wood',
			'menagerie.beaver.label.silver',
			'menagerie.beaver.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 10 },
			{ tier: 'silver', t: 50 },
			{ tier: 'gold', t: 250 }
		]
	},
	{
		slug: 'rooster',
		nameKey: 'menagerie.rooster.name',
		oracleKey: 'menagerie.rooster.oracle',
		ruleKey: 'menagerie.rooster.rule',
		conceptKey: 'menagerie.rooster.concept',
		labelKeys: [
			'menagerie.rooster.label.wood',
			'menagerie.rooster.label.silver',
			'menagerie.rooster.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 7 },
			{ tier: 'silver', t: 15 },
			{ tier: 'gold', t: 30 }
		]
	},
	{
		slug: 'snake',
		nameKey: 'menagerie.snake.name',
		oracleKey: 'menagerie.snake.oracle',
		ruleKey: 'menagerie.snake.rule',
		conceptKey: 'menagerie.snake.concept',
		labelKeys: [
			'menagerie.snake.label.wood',
			'menagerie.snake.label.silver',
			'menagerie.snake.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 5 },
			{ tier: 'silver', t: 10 },
			{ tier: 'gold', t: 20 }
		]
	},
	{
		slug: 'owl',
		nameKey: 'menagerie.owl.name',
		oracleKey: 'menagerie.owl.oracle',
		ruleKey: 'menagerie.owl.rule',
		conceptKey: 'menagerie.owl.concept',
		labelKeys: [
			'menagerie.owl.label.wood',
			'menagerie.owl.label.silver',
			'menagerie.owl.label.gold',
			'menagerie.owl.label.irid'
		],
		// Accuracy is a 0..1 ratio gated behind a minimum call count (see hook).
		tiers: [
			{ tier: 'wood', t: 0.65 },
			{ tier: 'silver', t: 0.72 },
			{ tier: 'gold', t: 0.78 },
			{ tier: 'irid', t: 0.82 }
		]
	},
	{
		slug: 'raven',
		nameKey: 'menagerie.raven.name',
		oracleKey: 'menagerie.raven.oracle',
		ruleKey: 'menagerie.raven.rule',
		conceptKey: 'menagerie.raven.concept',
		labelKeys: [
			'menagerie.raven.label.wood',
			'menagerie.raven.label.silver',
			'menagerie.raven.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 3 },
			{ tier: 'silver', t: 10 },
			{ tier: 'gold', t: 25 }
		]
	},
	{
		slug: 'octopus',
		nameKey: 'menagerie.octopus.name',
		oracleKey: 'menagerie.octopus.oracle',
		ruleKey: 'menagerie.octopus.rule',
		conceptKey: 'menagerie.octopus.concept',
		labelKeys: [
			'menagerie.octopus.label.wood',
			'menagerie.octopus.label.silver',
			'menagerie.octopus.label.gold',
			'menagerie.octopus.label.irid'
		],
		hero: true,
		// Smallest consensus the user has won against — lower is rarer.
		reversed: true,
		tiers: [
			{ tier: 'wood', t: 0.25 },
			{ tier: 'silver', t: 0.2 },
			{ tier: 'gold', t: 0.15 },
			{ tier: 'irid', t: 0.1 }
		]
	},
	{
		slug: 'magpie',
		nameKey: 'menagerie.magpie.name',
		oracleKey: 'menagerie.magpie.oracle',
		ruleKey: 'menagerie.magpie.rule',
		conceptKey: 'menagerie.magpie.concept',
		labelKeys: [
			'menagerie.magpie.label.wood',
			'menagerie.magpie.label.silver',
			'menagerie.magpie.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 3 },
			{ tier: 'silver', t: 5 },
			{ tier: 'gold', t: 7 }
		]
	},
	{
		// A "comeback" is a settled win that snaps a cold streak of at least
		// `COMEBACK_COLD_STREAK_LOSSES` consecutive settled losses (see
		// `calculateAndSyncStats`).
		slug: 'badger',
		nameKey: 'menagerie.badger.name',
		oracleKey: 'menagerie.badger.oracle',
		ruleKey: 'menagerie.badger.rule',
		conceptKey: 'menagerie.badger.concept',
		labelKeys: [
			'menagerie.badger.label.wood',
			'menagerie.badger.label.silver',
			'menagerie.badger.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 1 },
			{ tier: 'silver', t: 3 },
			{ tier: 'gold', t: 5 }
		]
	},
	{
		slug: 'parrot',
		nameKey: 'menagerie.parrot.name',
		oracleKey: 'menagerie.parrot.oracle',
		ruleKey: 'menagerie.parrot.rule',
		conceptKey: 'menagerie.parrot.concept',
		labelKeys: [
			'menagerie.parrot.label.wood',
			'menagerie.parrot.label.silver',
			'menagerie.parrot.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 1 },
			{ tier: 'silver', t: 3 },
			{ tier: 'gold', t: 10 }
		]
	},
	{
		slug: 'bee',
		nameKey: 'menagerie.bee.name',
		oracleKey: 'menagerie.bee.oracle',
		ruleKey: 'menagerie.bee.rule',
		conceptKey: 'menagerie.bee.concept',
		labelKeys: [
			'menagerie.bee.label.wood',
			'menagerie.bee.label.silver',
			'menagerie.bee.label.gold'
		],
		tiers: [
			{ tier: 'wood', t: 1 },
			{ tier: 'silver', t: 2 },
			{ tier: 'gold', t: 3 }
		]
	},
	{
		slug: 'goat',
		nameKey: 'menagerie.goat.name',
		oracleKey: 'menagerie.goat.oracle',
		ruleKey: 'menagerie.goat.rule',
		conceptKey: 'menagerie.goat.concept',
		labelKeys: [
			'menagerie.goat.label.wood',
			'menagerie.goat.label.silver',
			'menagerie.goat.label.gold',
			'menagerie.goat.label.irid'
		],
		hero: true,
		// Percentile (rank / total) — lower is better. The iridescent rung uses
		// a `-1` sentinel threshold (never auto-matched by the reversed compare);
		// reaching world rank #1 promotes the earned tier to `irid` explicitly.
		reversed: true,
		tiers: [
			{ tier: 'wood', t: 0.1 },
			{ tier: 'silver', t: 0.05 },
			{ tier: 'gold', t: 0.01 },
			{ tier: 'irid', t: -1 }
		]
	}
];

export const MENAGERIE_BY_SLUG = new Map(MENAGERIE.map((animal) => [animal.slug, animal]));

/** Warm-bodied animals lose edge against the peach theme — the badge deepens
 * their aura + frame stroke to keep them legible. */
export const MENAGERIE_WARM_SLUGS = new Set<MenagerieSlug>([
	'hatchling',
	'beaver',
	'owl',
	'badger'
]);
