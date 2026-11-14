export type AppLocale =
	| 'en'
	| 'es'
	| 'es-419'
	| 'es-ES'
	| 'es-MX'
	| 'es-AR'
	| 'es-CO'
	| 'pt'
	| 'pt-BR'
	| 'it'
	| 'fr'
	| 'de'
	| 'nl'
	| 'pl'
	| 'cs'
	| 'sk'
	| 'ru'
	| 'zh-Hans'
	| 'ja'
	| 'ko'
	| 'hi'
	| 'vi';

export const DEFAULT_LOCALE: AppLocale = 'en';

/**
 * Launch readiness for a locale.
 *
 * - `live`: the catalog is populated and kept fully aligned to `en`
 *   (enforced by `check:i18n`).
 * - `soon`: registered for fallback resolution and the picker (browser
 *   auto-detect targets only `live` locales), but the catalog is
 *   absent or only partial. Missing keys resolve through the `fallback`
 *   chain to `en`, so the UI always renders real copy, never a raw key.
 */
export type LocaleTier = 'live' | 'soon';

/**
 * A registered locale (BCP-47: `language[-Script][-REGION]`).
 *
 * One language splits into a neutral base plus regional variants. The base
 * carries the language's shared copy and backs its regional deltas; it is
 * marked `hidden` so it is not offered as a standalone region choice. Each
 * variant declares an ordered `fallback` chain that `t()` walks on a missing
 * key, always ending at `en`.
 *
 * `region` and `regionLabel` describe the geographic facet so a
 * future region-aware picker can group variants under their language; the
 * current flat picker reads `id`, `label` and `short` only.
 */
export interface LocaleEntry {
	/** BCP-47 locale id and the value persisted in storage. */
	readonly id: AppLocale;
	/** Native language name, as shown to a speaker of that language. */
	readonly label: string;
	/** English name of the locale, for operator-facing surfaces. */
	readonly name: string;
	/** Short badge used by the picker rows (e.g. `EN`, `MX`). */
	readonly short: string;
	/** ISO-ish region code (`US`, `MX`, `419`, …). */
	readonly region: string;
	/** Native region label shown in the picker (`México`, `中国大陆`, …). */
	readonly regionLabel: string;
	/**
	 * Show the world/globe icon instead of a country flag: for supra-national
	 * rows (e.g. `en` Global, `es-419` Latin America). Country rows render the
	 * SVG flag for their `region` via the shared CountryFlag component.
	 */
	readonly worldFlag?: boolean;
	/** Ordered resolution chain walked on a missing key, ending at `en`. */
	readonly fallback: readonly AppLocale[];
	/** Neutral base dictionary for a language; backs its regional deltas. */
	readonly base?: boolean;
	/** Not offered as a standalone choice in the picker (base dictionaries). */
	readonly hidden?: boolean;
	/** Launch readiness: drives `check:i18n` strictness. */
	readonly tier: LocaleTier;
}

/**
 * The single source of truth for every locale the app knows about. Detection,
 * fallback resolution and the catalog checker all derive from this list.
 *
 * Today's fully-translated locales (`en`, `it`, `es`, `de`, `fr`, `pt`,
 * `zh-Hans`) are `live`; the rest are `soon` and resolve to English through
 * their `fallback` chain until their catalogs land.
 */
export const LOCALE_REGISTRY: readonly LocaleEntry[] = [
	{
		id: 'en',
		label: 'English',
		name: 'English',
		short: 'EN',
		region: 'US',
		regionLabel: 'Global',
		worldFlag: true,
		fallback: [],
		tier: 'live'
	},

	// Spanish: a hidden neutral base plus regional deltas. `es-419` is the
	// Latin-American tier most LatAm variants fall back to.
	{
		id: 'es',
		label: 'Español',
		name: 'Spanish',
		short: 'ES',
		region: 'ES',
		regionLabel: 'Español',
		fallback: ['en'],
		base: true,
		hidden: true,
		tier: 'live'
	},
	{
		id: 'es-419',
		label: 'Español',
		name: 'Spanish (Latin America)',
		short: '419',
		region: '419',
		regionLabel: 'Latinoamérica',
		worldFlag: true,
		fallback: ['es', 'en'],
		tier: 'soon'
	},
	{
		id: 'es-ES',
		label: 'Español',
		name: 'Spanish (Spain)',
		short: 'ES',
		region: 'ES',
		regionLabel: 'España',
		fallback: ['es', 'en'],
		tier: 'soon'
	},
	{
		id: 'es-MX',
		label: 'Español',
		name: 'Spanish (Mexico)',
		short: 'MX',
		region: 'MX',
		regionLabel: 'México',
		fallback: ['es-419', 'es', 'en'],
		tier: 'soon'
	},
	{
		id: 'es-AR',
		label: 'Español',
		name: 'Spanish (Argentina)',
		short: 'AR',
		region: 'AR',
		regionLabel: 'Argentina',
		fallback: ['es-419', 'es', 'en'],
		tier: 'soon'
	},
	{
		id: 'es-CO',
		label: 'Español',
		name: 'Spanish (Colombia)',
		short: 'CO',
		region: 'CO',
		regionLabel: 'Colombia',
		fallback: ['es-419', 'es', 'en'],
		tier: 'soon'
	},

	// Portuguese: Portugal is the neutral base, Brazil the populated variant.
	{
		id: 'pt',
		label: 'Português',
		name: 'Portuguese (Portugal)',
		short: 'PT',
		region: 'PT',
		regionLabel: 'Portugal',
		fallback: ['en'],
		base: true,
		tier: 'live'
	},
	{
		id: 'pt-BR',
		label: 'Português',
		name: 'Portuguese (Brazil)',
		short: 'BR',
		region: 'BR',
		regionLabel: 'Brasil',
		fallback: ['pt', 'en'],
		tier: 'soon'
	},

	{
		id: 'it',
		label: 'Italiano',
		name: 'Italian',
		short: 'IT',
		region: 'IT',
		regionLabel: 'Italia',
		fallback: ['en'],
		tier: 'live'
	},
	{
		id: 'fr',
		label: 'Français',
		name: 'French',
		short: 'FR',
		region: 'FR',
		regionLabel: 'France',
		fallback: ['en'],
		tier: 'live'
	},
	{
		id: 'de',
		label: 'Deutsch',
		name: 'German',
		short: 'DE',
		region: 'DE',
		regionLabel: 'Deutschland',
		fallback: ['en'],
		tier: 'live'
	},
	{
		id: 'nl',
		label: 'Nederlands',
		name: 'Dutch',
		short: 'NL',
		region: 'NL',
		regionLabel: 'Nederland',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'pl',
		label: 'Polski',
		name: 'Polish',
		short: 'PL',
		region: 'PL',
		regionLabel: 'Polska',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'cs',
		label: 'Čeština',
		name: 'Czech',
		short: 'CS',
		region: 'CZ',
		regionLabel: 'Česko',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'sk',
		label: 'Slovenčina',
		name: 'Slovak',
		short: 'SK',
		region: 'SK',
		regionLabel: 'Slovensko',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'ru',
		label: 'Русский',
		name: 'Russian',
		short: 'RU',
		region: 'RU',
		regionLabel: 'Россия',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'zh-Hans',
		label: '简体中文',
		name: 'Chinese (Simplified)',
		short: 'ZH',
		region: 'CN',
		regionLabel: '中国大陆',
		fallback: ['en'],
		tier: 'live'
	},
	{
		id: 'ja',
		label: '日本語',
		name: 'Japanese',
		short: 'JA',
		region: 'JP',
		regionLabel: '日本',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'ko',
		label: '한국어',
		name: 'Korean',
		short: 'KO',
		region: 'KR',
		regionLabel: '대한민국',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'hi',
		label: 'हिन्दी',
		name: 'Hindi',
		short: 'HI',
		region: 'IN',
		regionLabel: 'भारत',
		fallback: ['en'],
		tier: 'soon'
	},
	{
		id: 'vi',
		label: 'Tiếng Việt',
		name: 'Vietnamese',
		short: 'VI',
		region: 'VN',
		regionLabel: 'Việt Nam',
		fallback: ['en'],
		tier: 'soon'
	}
] as const;

/**
 * The flat list of locales with a populated catalog (`tier: 'live'`), carrying
 * a compact `{ id, label, short }` shape. It is the allowlist for the live,
 * fully-translated set: it scopes the primary-subtag fallback in browser
 * auto-detection (see `detectBrowserLocale`: the exact-tag tier matches any
 * registered locale via `REGISTERED_LOCALE_IDS`), and the market-translation
 * surfaces gate their per-locale fields against it.
 *
 * The `hidden` flag (a language's neutral base) is deliberately ignored here:
 * grouping by language/region is the picker's concern, handled by
 * `localeLanguageGroups`, which reads the full registry.
 *
 * `soon` locales are registered in `LOCALE_REGISTRY` for detection fallback and
 * the picker, but stay out of this list until their catalogs land.
 */
export const SUPPORTED_LOCALES: readonly {
	id: AppLocale;
	label: string;
	short: string;
}[] = LOCALE_REGISTRY.filter(({ tier }) => tier === 'live').map(({ id, label, short }) => ({
	id,
	label,
	short
}));

/**
 * Every registered locale id, in registry order: `live` and `soon` alike.
 *
 * Browser detection uses this for its exact-tag match so a regional catalog
 * (`pt-BR`, `es-MX`, …) is caught on a first visit even while it is `soon`,
 * instead of fuzzy-collapsing onto its `live` base. The looser primary-subtag
 * fallback stays scoped to `SUPPORTED_LOCALES` (see `detectBrowserLocale`).
 */
export const REGISTERED_LOCALE_IDS: readonly AppLocale[] = LOCALE_REGISTRY.map(({ id }) => id);

const REGISTERED_LOCALE_ID_SET: ReadonlySet<string> = new Set(REGISTERED_LOCALE_IDS);

/**
 * Is this value one of the registered locale ids (`live` and `soon`)? Guards
 * every locale that crosses a trust boundary: a stored preference, a schema
 * field typed as a plain string.
 */
export const isRegisteredLocale = (value: unknown): value is AppLocale =>
	typeof value === 'string' && REGISTERED_LOCALE_ID_SET.has(value);

/**
 * A language grouped with its selectable regional editions, for the two-axis
 * (Language ▸ Region) picker.
 *
 * `lang` is the primary subtag shared by every region in the group (`es`,
 * `pt`, `en`, …). `label` / `name` carry the language's native and English
 * names. `regions` lists the selectable editions in registry order, with
 * `hidden` base dictionaries excluded: a base only anchors the group and
 * backs its deltas, it is never offered as a standalone choice.
 *
 * A group with a single region renders as a direct pick row; a group with
 * several renders an expandable header drilling into its region rows.
 */
export interface LocaleLanguageGroup {
	/** Primary subtag shared by the group (`es`, `pt`, `en`, …). */
	readonly lang: string;
	/** Native language name (from the group's anchor entry). */
	readonly label: string;
	/** English language name (from the group's anchor entry). */
	readonly name: string;
	/** Selectable regional editions, registry order, `hidden` bases excluded. */
	readonly regions: readonly LocaleEntry[];
}

/**
 * Group the registry into languages with their selectable regional editions
 * for the two-axis picker. Entries are bucketed by primary subtag in registry
 * order; `hidden` base dictionaries are dropped from the visible `regions` but
 * still seed the group's native/English name when they anchor the language.
 *
 * The base entry (when present) supplies the group's language-level `label` /
 * `name`; otherwise the first visible region does. This keeps a multi-region
 * language (Spanish, Portuguese) under one native header while single-region
 * languages collapse to a single direct row.
 */
export const localeLanguageGroups = (): readonly LocaleLanguageGroup[] => {
	const order: string[] = [];
	const byLang = new Map<string, { anchor: LocaleEntry; regions: LocaleEntry[] }>();

	for (const entry of LOCALE_REGISTRY) {
		const [lang] = entry.id.split('-');
		let bucket = byLang.get(lang);

		if (!bucket) {
			bucket = { anchor: entry, regions: [] };
			byLang.set(lang, bucket);
			order.push(lang);
		}

		// A `base` entry is the language's canonical anchor for naming even
		// though it never shows as a region row.
		if (entry.base === true) {
			bucket.anchor = entry;
		}

		if (entry.hidden !== true) {
			bucket.regions.push(entry);
		}
	}

	const groups: LocaleLanguageGroup[] = [];

	for (const lang of order) {
		const bucket = byLang.get(lang);

		if (bucket && bucket.regions.length > 0) {
			const { anchor, regions } = bucket;

			groups.push({ lang, label: anchor.label, name: anchor.name, regions });
		}
	}

	return groups;
};

/**
 * Resolve a locale's fallback chain: itself first, then each entry in its
 * registered `fallback`, always ending at `en`. Used by `t()` to render a
 * populated locale's key when a `soon` (or partial) locale lacks it.
 */
export const localeFallbackChain = (locale: AppLocale): readonly AppLocale[] => {
	const entry = LOCALE_REGISTRY.find(({ id }) => id === locale);
	const chain: AppLocale[] = [locale];

	if (entry) {
		for (const next of entry.fallback) {
			if (!chain.includes(next)) {
				chain.push(next);
			}
		}
	}

	if (!chain.includes(DEFAULT_LOCALE)) {
		chain.push(DEFAULT_LOCALE);
	}

	return chain;
};

export const LOCALE_STORAGE_KEY = 'vici.locale.v1';
