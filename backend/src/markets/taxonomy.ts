// Three-layer market taxonomy, mirrored from the app's shared constants so
// the tag index derives the exact same bucket keys the clients reason about.
//
// - Layer 1 (macro): the coarse category bar bucket. Closed set.
// - Layer 2 (micro): the subcategory chip. Closed set; every micro belongs to
//   exactly one macro, so a market's macros are DERIVED from its micros.
// - Layer 3 (free tag): open event/entity tags stored alongside micro ids in
//   the same flat `tags` array, distinguished by not being a known micro id.
//   Free tags never create an index bucket.

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

/** micro -> its parent macro. The hierarchy is derived from this, never stored. */
export const MICRO_TO_MACRO = Object.fromEntries(
	MARKET_TAXONOMY.flatMap(({ id, micros }) => micros.map((micro) => [micro, id]))
) as Record<MicroId, MacroId>;

export const isMicroId = (value: string): value is MicroId =>
	(MICRO_IDS as readonly string[]).includes(value);

/** Every bucket key the tag index can hold: one per micro id and one per macro id. */
export const ALL_INDEX_KEYS: readonly string[] = [...MICRO_IDS, ...MACRO_IDS];

/** Micro ids carried by a market, de-duplicated preserving first-seen order. */
export const classificationMicros = (values: readonly string[]): MicroId[] => {
	const micros: MicroId[] = [];
	const seen = new Set<MicroId>();

	for (const value of values) {
		if (isMicroId(value) && !seen.has(value)) {
			seen.add(value);
			micros.push(value);
		}
	}

	return micros;
};

/** All macros a market belongs to (derived from its micros), primary first. */
export const classificationMacros = (values: readonly string[]): MacroId[] => {
	const macros: MacroId[] = [];

	for (const micro of classificationMicros(values)) {
		const macro = MICRO_TO_MACRO[micro];

		if (!macros.includes(macro)) {
			macros.push(macro);
		}
	}

	return macros;
};

/**
 * The bucket keys a market belongs to, derived from its stored tags: its micro
 * ids plus the macro ids those micros roll up to. De-duplicated (a macro can be
 * derived once even from several of its micros). Layer-3 free tags contribute
 * no bucket.
 */
export const indexKeysForTags = (tags: readonly string[]): string[] => [
	...new Set<string>([...classificationMicros(tags), ...classificationMacros(tags)])
];

/**
 * Normalize a stored `tags` array before persisting: trim, drop blanks, and
 * de-duplicate while preserving order (the first micro stays primary). Both
 * micro ids and Layer-3 free tags are kept: the taxonomy is closed at the
 * micro layer but open at the tag layer, so unknown values are retained as
 * free tags rather than dropped.
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
