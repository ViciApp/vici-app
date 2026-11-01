/**
 * Landing-only mock data — markets + World Cup favourites.
 *
 * The landing surface is a pre-sign-in marketing page and does NOT
 * read live markets from the canister. These fixtures shape the
 * sections that render the curated marketing cards.
 */

export type LandingMarketCategory =
	'wc' | 'macro' | 'crypto' | 'politics' | 'tech' | 'sports' | 'culture';

export interface LandingMarket {
	readonly id: string;
	readonly cat: LandingMarketCategory;
	readonly q: string;
	readonly ctx: string;
	readonly yes: number;
	readonly vol: string;
	readonly liq: string;
	readonly closes: string;
	readonly days: number;
	readonly hot?: boolean;
	readonly predictors?: number;
}

/**
 * Markets deck — first three drive the Hero deck + Flow demo, first
 * six the Live Markets grid, first eight the ticker. The top card
 * (`wc-winner-brazil`) is `hot: true` and triggers the "trickster
 * pill" on the Hero card because `min(yes, no) < 25`.
 */
export const LANDING_MARKETS: readonly LandingMarket[] = [
	{
		id: 'wc-winner-brazil',
		cat: 'wc',
		q: 'Will Brazil win the 2026 World Cup?',
		ctx: 'Hex contenders · 17.9% favorite',
		yes: 18,
		vol: '4.2M',
		liq: '780K',
		closes: 'July 19, 2026',
		days: 90,
		hot: true,
		predictors: 1240
	},
	{
		id: 'wc-winner-spain',
		cat: 'wc',
		q: 'Will Spain win the 2026 World Cup?',
		ctx: 'Defending Euro champ · talented core',
		yes: 15,
		vol: '3.1M',
		liq: '620K',
		closes: 'July 19, 2026',
		days: 90,
		predictors: 980
	},
	{
		id: 'wc-winner-france',
		cat: 'wc',
		q: 'Will France win the 2026 World Cup?',
		ctx: 'Mbappé peak years · always in mix',
		yes: 14,
		vol: '3.8M',
		liq: '710K',
		closes: 'July 19, 2026',
		days: 90,
		predictors: 1120
	},
	{
		id: 'fed-jun',
		cat: 'macro',
		q: 'Will the Fed cut rates in June?',
		ctx: 'FOMC · rate-cut call',
		yes: 64,
		vol: '2.4M',
		liq: '480K',
		closes: 'June 18',
		days: 47,
		hot: true,
		predictors: 2410
	},
	{
		id: 'btc-150k',
		cat: 'crypto',
		q: 'Will BTC close above $150K by year-end?',
		ctx: 'Spot price $128.4K · 7d +4.2%',
		yes: 38,
		vol: '8.1M',
		liq: '1.2M',
		closes: 'Dec 31',
		days: 228,
		hot: true,
		predictors: 3210
	},
	{
		id: 'gpt6-2026',
		cat: 'tech',
		q: 'Will OpenAI release GPT-6 before Q4?',
		ctx: 'Last release: GPT-5.5 · Mar 2026',
		yes: 22,
		vol: '620K',
		liq: '180K',
		closes: 'Sep 30',
		days: 135,
		predictors: 1480
	},
	{
		id: 'sb-niners',
		cat: 'sports',
		q: 'Will the 49ers win the Super Bowl?',
		ctx: 'Currently 12-3 · favored by Vegas',
		yes: 31,
		vol: '1.8M',
		liq: '320K',
		closes: 'Feb 8',
		days: 266,
		predictors: 1820
	},
	{
		id: 'eu-ai-act',
		cat: 'politics',
		q: 'Will the EU pass the AI Liability Act this session?',
		ctx: 'Council vote pending · whip count tight',
		yes: 55,
		vol: '410K',
		liq: '90K',
		closes: 'Jul 12',
		days: 58,
		predictors: 980
	}
] as const;

/**
 * World Cup favourites — used by the WCFeature section's 2×2 flag
 * grid. The kickoff countdown beside the grid is derived live from the
 * featured event's `kickoffAt_ms` (`daysToKickoff` / `hoursToKickoff`)
 * so the landing always shows the same countdown the rest of the app uses.
 */
export interface LandingWcFavorite {
	readonly code: string;
	readonly team: string;
	readonly color: string;
	readonly odds: number;
}

export const LANDING_WC_FAVORITES: readonly LandingWcFavorite[] = [
	{ code: 'BR', team: 'Brazil', color: '#0F8C3A', odds: 17.9 },
	{ code: 'ES', team: 'Spain', color: '#AA151B', odds: 14.8 },
	{ code: 'FR', team: 'France', color: '#0033A0', odds: 13.6 },
	{ code: 'AR', team: 'Argentina', color: '#75AADB', odds: 12.4 }
] as const;

/**
 * Category → label map used by the ticker + cards. Only the
 * categories that appear in `LANDING_MARKETS` are listed.
 */
export const LANDING_CAT_LABELS: Record<LandingMarketCategory, string> = {
	wc: 'World Cup',
	macro: 'Macro',
	crypto: 'Crypto',
	politics: 'Politics',
	tech: 'Tech',
	sports: 'Sports',
	culture: 'Culture'
};

/**
 * Category → accent color used by the FlowCard header tint.
 */
export const LANDING_CAT_COLORS: Record<LandingMarketCategory, string> = {
	wc: '#E2B842',
	macro: '#7EB6FF',
	crypto: '#FFB04A',
	politics: '#FF8A4C',
	tech: '#6FE0B6',
	sports: '#FF8A7A',
	culture: '#B49CFF'
};

/**
 * League rows used by the LeagueShowcase panel — `office-hex` members.
 */
export interface LandingLeagueMember {
	readonly rank: number;
	readonly handle: string;
	readonly shirt: string;
	readonly acc: number;
	readonly kls: 'gold' | 'silver' | 'bronze' | 'you' | 'normal';
}

export interface LandingLeague {
	readonly id: string;
	readonly name: string;
	readonly emblem: string;
	readonly color: string;
	readonly memberCount: number;
	readonly members: readonly LandingLeagueMember[];
}

export const LANDING_LEAGUES: readonly LandingLeague[] = [
	{
		id: 'office-hex',
		name: 'Office Hex',
		emblem: 'O',
		color: '#E2B842',
		memberCount: 12,
		members: [
			{ rank: 1, handle: 'augustus', shirt: '#E2B842', acc: 0.802, kls: 'gold' },
			{ rank: 2, handle: 'cassandra', shirt: '#75AADB', acc: 0.778, kls: 'silver' },
			{ rank: 3, handle: 'horatius', shirt: '#0033A0', acc: 0.764, kls: 'bronze' },
			{ rank: 4, handle: 'plinius', shirt: '#75AADB', acc: 0.751, kls: 'normal' },
			{ rank: 5, handle: 'livia', shirt: '#1F2A3A', acc: 0.742, kls: 'normal' },
			{ rank: 7, handle: 'YOU', shirt: '#E2B842', acc: 0.728, kls: 'you' }
		]
	},
	{
		id: 'lupercal',
		name: 'Lupercal Society',
		emblem: 'L',
		color: '#B5462C',
		memberCount: 8,
		members: [
			{ rank: 1, handle: 'marcus.x', shirt: '#2D2D2D', acc: 0.789, kls: 'gold' },
			{ rank: 2, handle: 'nero', shirt: '#75AADB', acc: 0.762, kls: 'silver' },
			{ rank: 3, handle: 'galba', shirt: '#0F8C3A', acc: 0.745, kls: 'bronze' }
		]
	}
];

/**
 * Worlds Universities — top 3 by `accWC` for the podium mini-panel.
 */
export interface LandingUniversity {
	readonly id: string;
	readonly name: string;
	readonly short: string;
	readonly color: string;
	readonly text: string;
	readonly accWC: number;
}

export const LANDING_WORLDS_UNIVERSITIES: readonly LandingUniversity[] = [
	{
		id: 'stanford',
		name: 'Stanford',
		short: 'STAN',
		color: '#8C1515',
		text: '#F2ECDC',
		accWC: 0.714
	},
	{
		id: 'harvard',
		name: 'Harvard',
		short: 'HARV',
		color: '#A51C30',
		text: '#F2ECDC',
		accWC: 0.682
	},
	{
		id: 'berkeley',
		name: 'Berkeley',
		short: 'BERK',
		color: '#003262',
		text: '#FDB515',
		accWC: 0.668
	},
	{ id: 'mit', name: 'MIT', short: 'MIT', color: '#A31F34', text: '#F2ECDC', accWC: 0.661 }
] as const;

export const LANDING_WORLDS_UNIVERSITIES_COUNT = 64;

/* ── Landing hero (interactive swipe card) ─────────────────────────── */

/**
 * The single demo market a first-time visitor can swipe in the hero.
 * Mirrors a real Flow card: a binary question with a published YES
 * consensus. Kept deliberately simple — the question text resolves
 * from i18n (`welcome.hero.card_q`), only the artwork seed + YES%
 * live here.
 */
export const LANDING_HERO_CARD = {
	/** Artwork seed passed to `MarketArtwork` (category `crypto`). */
	artSeed: 'btc-year-close',
	/** Published YES consensus for the demo question. */
	yes: 33
} as const;

/** Stake the hero payoff math + leaderboard climb beat are framed around. */
export const LANDING_HERO_STAKE = 50;

/**
 * Leaderboard-climb beat shown after the XP count-up — the competitive
 * hook that turns a single correct call into a rank move. Handles are
 * illustrative marketing names, not real users.
 */
export const LANDING_HERO_CLIMB = {
	rank: 2,
	delta: 6,
	rival: 'giovanni',
	below: 'antonio'
} as const;

/* ── Landing status slider (accuracy-as-status, 3 tabs) ────────────── */

export type LandingStatusTabId = 'friends' | 'uni' | 'work';

export interface LandingStatusRow {
	readonly rank: number;
	/** Either a raw handle (prefixed `@` in the UI) or a localized team name. */
	readonly name: string;
	/** Pre-formatted accuracy string, e.g. `82.4%`. */
	readonly acc: string;
	/** Highlight this row as the visitor's own. */
	readonly you?: boolean;
	/** Optional rank-move badge, e.g. `▲ 3`. */
	readonly delta?: string;
	/** Render the name verbatim (a team), not as an `@handle`. */
	readonly team?: boolean;
}

/**
 * Friends-tab board — a small group-chat leaderboard. Handles are
 * illustrative; the visitor sits at #2 with a recent climb.
 */
export const LANDING_STATUS_FRIENDS: readonly LandingStatusRow[] = [
	{ rank: 1, name: 'giovanni', acc: '82.4%' },
	{ rank: 2, name: 'you', acc: '80.1%', you: true, delta: '▲ 3' },
	{ rank: 3, name: 'antonio', acc: '77.9%' },
	{ rank: 4, name: 'sofia_b', acc: '74.2%' }
] as const;

/**
 * Market-matched universities per language — real institutions the visitor
 * recognises, illustrative of the kind that compete. Proper nouns, so these are
 * data (not translatable i18n strings). Languages without a list fall back to
 * the en set.
 */
const LANDING_STATUS_UNIVERSITIES_BY_LANG: Record<string, readonly string[]> = {
	en: ['Stanford', 'Harvard', 'MIT', 'NYU'],
	es: ['UNAM', 'Buenos Aires (UBA)', 'Complutense Madrid', 'Andes'],
	pt: ['USP', 'Lisboa', 'Unicamp', 'Porto'],
	it: ['Politecnico Milano', 'Sapienza Roma', 'Bocconi', 'Torino'],
	fr: ['Sorbonne', 'Sciences Po', 'PSL', 'Polytechnique'],
	de: ['TU München', 'LMU München', 'Heidelberg', 'Humboldt Berlin']
};

/**
 * The visitor's market-matched universities for a locale: full tag first (so a
 * region-specific list like `zh-Hans` or `pt-BR` wins when present), then the base
 * language, then the `en` fallback.
 */
export const landingStatusUniversities = (locale: string): readonly string[] =>
	LANDING_STATUS_UNIVERSITIES_BY_LANG[locale] ??
	LANDING_STATUS_UNIVERSITIES_BY_LANG[locale.split('-')[0]] ??
	LANDING_STATUS_UNIVERSITIES_BY_LANG.en;

/* ── Landing proof ticker (live calls) ─────────────────────────────── */

export type LandingCallSide = 'YES' | 'NO';

export interface LandingProofChip {
	readonly who: string;
	readonly side: LandingCallSide;
	readonly q: string;
}

/**
 * Decorative live-calls ticker (aria-hidden). Handles + questions are
 * illustrative marketing texture, not live data.
 */
export const LANDING_PROOF_CHIPS: readonly LandingProofChip[] = [
	{ who: 'marcov', side: 'YES', q: 'Bitcoin closes the year higher' },
	{ who: 'lenak', side: 'NO', q: 'The Fed cuts at its next meeting' },
	{ who: 'tariq', side: 'YES', q: 'The derby goes to the home side' },
	{ who: 'priyas', side: 'YES', q: 'A sequel tops the box office' },
	{ who: 'dani', side: 'NO', q: 'The incumbent wins again' },
	{ who: 'okonkwo', side: 'YES', q: 'The next phone costs more' }
] as const;
