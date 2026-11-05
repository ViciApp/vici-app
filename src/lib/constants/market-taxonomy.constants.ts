import type { MessageKey } from '#lib/utils/i18n.utils.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Three-layer market taxonomy.
 *
 * - **Layer 1 — macro** (`MacroId`): the coarse bucket rendered as the top
 *   category bar. Closed set. A market resolves to 1..N macros, but exactly
 *   one is *primary* (drives card accent, artwork, detail chip, stats).
 * - **Layer 2 — micro** (`MicroId`): the subcategory chip. Closed set; every
 *   micro belongs to exactly one macro, so a market's macros are *derived*
 *   from its micros — there is no separate stored macro field.
 * - **Layer 3 — tag**: open, optional free tags (event/entity level, e.g.
 *   `world-cup`, `bitcoin-etf`). Not enumerated here; they live alongside
 *   micro ids in the same `MarketMetadata.tags` array and are distinguished
 *   by *not* being a known micro id ({@link isMicroId}).
 *
 * Storage stays a flat `string[]` on `MarketMetadata.tags`: `[<micro>…,
 * <free-tag>…]` with the first micro as the primary. This keeps the wire
 * shape (and the satellite `market_tag_index`) unchanged while layering the
 * hierarchy on top in the frontend.
 *
 * This module is bundled into the satellite wasm (the satellite imports the
 * classification helpers), so it must
 * stay free of VALUE imports of frontend-only modules; only the type-only
 * `MessageKey` import is allowed (erased at compile time). Rendering helpers
 * that need `t` belong in `#lib/utils/market-tags.utils.ts`.
 *
 * To add a micro: extend the relevant macro's `micros` below and add
 * `market.micro.<id>` to every LIVE locale catalog under
 * `src/lib/constants/messages/`. To add a macro: add an entry here, a color
 * in {@link MACRO_COLORS}, and `market.macro.<id>` to every live catalog.
 */
export const MARKET_TAXONOMY = [
	{
		id: 'politics',
		micros: [
			'trump',
			'us-elections',
			'us-president',
			'congress',
			'senate',
			'house',
			'us-policy',
			'immigration',
			'appointments',
			'courts-legal',
			'supreme-court',
			'polls',
			'politics-other'
		]
	},
	{
		id: 'world',
		micros: [
			'geopolitics',
			'middle-east',
			'israel',
			'iran',
			'gaza',
			'russia-ukraine',
			'china',
			'taiwan',
			'north-korea',
			'europe',
			'uk',
			'asia',
			'india',
			'latin-america',
			'africa',
			'global-elections',
			'foreign-policy',
			'world-other'
		]
	},
	{
		id: 'economy',
		micros: [
			'fed-rates',
			'inflation',
			'growth-recession',
			'gdp',
			'jobs',
			'stocks',
			'earnings',
			'ipos',
			'mergers',
			'commodities',
			'oil',
			'gold',
			'housing',
			'trade',
			'economy-other'
		]
	},
	{
		id: 'crypto',
		micros: [
			'bitcoin',
			'ethereum',
			'solana',
			'xrp',
			'bnb',
			'cardano',
			'dogecoin',
			'memecoins',
			'altcoins',
			'etfs',
			'defi',
			'stablecoins',
			'nfts',
			'exchanges',
			'crypto-regulation',
			'mining',
			'crypto-other'
		]
	},
	{
		id: 'tech',
		micros: [
			'ai',
			'openai',
			'anthropic',
			'elon-musk',
			'tesla',
			'spacex',
			'apple',
			'google',
			'meta',
			'microsoft',
			'nvidia',
			'big-tech',
			'space',
			'gadgets',
			'science',
			'cybersecurity',
			'tech-other'
		]
	},
	{
		id: 'culture',
		micros: [
			'movies',
			'box-office',
			'music',
			'awards',
			'oscars',
			'grammys',
			'emmys',
			'celebrities',
			'taylor-swift',
			'kanye-west',
			'tv-streaming',
			'netflix',
			'gaming',
			'social-media',
			'mentions',
			'weather',
			'novelty',
			'culture-other'
		]
	},
	{
		id: 'sports',
		micros: [
			'soccer',
			'premier-league',
			'la-liga',
			'serie-a',
			'bundesliga',
			'champions-league',
			'world-cup',
			'mls',
			'nfl',
			'nba',
			'wnba',
			'mlb',
			'nhl',
			'tennis',
			'ufc',
			'boxing',
			'golf',
			'f1',
			'nascar',
			'motorsport',
			'cricket',
			'rugby',
			'college-football',
			'college-basketball',
			'esports',
			'olympics',
			'chess',
			'darts',
			'sports-other'
		]
	}
] as const satisfies ReadonlyArray<{ id: string; micros: readonly string[] }>;

export type MacroId = (typeof MARKET_TAXONOMY)[number]['id'];
export type MicroId = (typeof MARKET_TAXONOMY)[number]['micros'][number];

/** Macro ids in canonical (category-bar) order. */
export const MACRO_IDS: readonly MacroId[] = MARKET_TAXONOMY.map(({ id }) => id);

/** All micro ids in canonical order (macro order, then within-macro order). */
export const MICRO_IDS: readonly MicroId[] = MARKET_TAXONOMY.flatMap(({ micros }) => micros);

/** micro → its parent macro. The hierarchy is derived from this, never stored. */
export const MICRO_TO_MACRO = Object.fromEntries(
	MARKET_TAXONOMY.flatMap(({ id, micros }) => micros.map((micro) => [micro, id]))
) as Record<MicroId, MacroId>;

export const isMacroId = (value: string): value is MacroId =>
	(MACRO_IDS as readonly string[]).includes(value);

export const isMicroId = (value: string): value is MicroId =>
	(MICRO_IDS as readonly string[]).includes(value);

/** Parent macro of a micro. */
export const macroOfMicro = (micro: MicroId): MacroId => MICRO_TO_MACRO[micro];

/** Micros belonging to a macro, in canonical order. */
export const microsOfMacro = (macro: MacroId): MicroId[] =>
	MARKET_TAXONOMY.find(({ id }) => id === macro)?.micros.slice() ?? [];

/**
 * i18n key for a macro / micro label. The `check:i18n` gate guarantees the
 * referenced keys exist in `en.ts` (and every live catalog), so the cast is
 * safe. Labels themselves are rendered via `#lib/utils/market-tags.utils.ts`.
 */
export const macroLabelKey = (macro: MacroId): MessageKey => `market.macro.${macro}` as MessageKey;
export const microLabelKey = (micro: MicroId): MessageKey => `market.micro.${micro}` as MessageKey;

// Per-macro brand accent. Micros inherit their macro's color — the chip's
// meaning is carried by the macro family, not per-micro hues. Six values are
// reused verbatim from the legacy `TAG_COLORS`; `world` takes the laurel-gold
// that `wc` used to own (World Cup now lives under sports/soccer).
export const MACRO_COLORS = {
	politics: '#FF6B6B',
	world: '#E2B842',
	economy: '#7EB6FF',
	crypto: '#F7931A',
	tech: '#B49CFF',
	culture: '#FFB066',
	sports: '#6FE0B6'
} as const satisfies Record<MacroId, string>;

export const macroColor = (macro: MacroId): string => MACRO_COLORS[macro];

export const microColor = (micro: MicroId): string => MACRO_COLORS[macroOfMicro(micro)];

/**
 * Split a stored `tags` array into its structured layers. Order is
 * significant: the first micro is the market's *primary* classification.
 * Micros are de-duplicated preserving first-seen order; anything that is not
 * a known micro id is treated as a Layer-3 free tag.
 */
export const splitClassification = (
	values: readonly string[]
): { micros: MicroId[]; tags: string[] } => {
	const micros: MicroId[] = [];
	const seen = new Set<MicroId>();
	const tags: string[] = [];

	for (const value of values) {
		if (isMicroId(value)) {
			if (!seen.has(value)) {
				seen.add(value);
				micros.push(value);
			}
		} else {
			tags.push(value);
		}
	}

	return { micros, tags };
};

/** Micro ids carried by a market, primary first. */
export const classificationMicros = (values: readonly string[]): MicroId[] =>
	splitClassification(values).micros;

/** Layer-3 free tags carried by a market (non-micro values). */
export const classificationTags = (values: readonly string[]): string[] =>
	splitClassification(values).tags;

/** Primary micro (first) — the single home used by card art / detail chip. */
export const primaryMicro = (values: readonly string[]): MicroId | undefined =>
	classificationMicros(values)[0];

/** Primary macro — the macro of the primary micro. */
export const primaryMacro = (values: readonly string[]): MacroId | undefined => {
	const micro = primaryMicro(values);

	return isNullish(micro) ? undefined : macroOfMicro(micro);
};

/** All macros a market belongs to (derived from its micros), primary first. */
export const classificationMacros = (values: readonly string[]): MacroId[] => {
	const macros: MacroId[] = [];

	for (const micro of classificationMicros(values)) {
		const macro = macroOfMicro(micro);

		if (!macros.includes(macro)) {
			macros.push(macro);
		}
	}

	return macros;
};

/**
 * Normalize a stored `tags` array before persisting: trim, drop blanks, and
 * de-duplicate while preserving order (the first micro stays primary). Both
 * micro ids and Layer-3 free tags are kept — the taxonomy is closed at the
 * micro layer but open at the tag layer, so unknown values are retained as
 * free tags rather than dropped. Replaces the legacy `normalizeMarketTags`,
 * which filtered to the old closed 7-tag set.
 */
export const normalizeStoredTags = (values: readonly string[]): string[] => {
	const seen = new Set<string>();
	const out: string[] = [];

	for (const raw of values) {
		const value = raw.trim();

		if (value.length > 0 && !seen.has(value)) {
			seen.add(value);
			out.push(value);
		}
	}

	return out;
};
