import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';

/**
 * Static demo markets shared by the public `/welcome` landing grid and
 * the pre-sign-in onboarding. Both surfaces render hand-curated
 * "what the live deck feels like" cards; centralising the fixture
 * keeps IDs, categories, and yes-probabilities in lock-step so a tweak
 * here updates both surfaces.
 *
 * `yesProbability` is the source of truth (0–1). `yesPercent` is the
 * pre-rounded integer the landing surface displays directly. Onboarding
 * pulls `yesProbability` because it animates the slider; landing pulls
 * `yesPercent` because it shows the static rounded value.
 */
// Welcome/onboarding demo markets ship hand-curated fixtures across the
// six default categories. `wc` is tentpole-only and never part of the
// demo deck, so it's excluded from this fixture type — that lets
// downstream helpers (e.g. `onboarding.category.<id>.label` keys) stay
// statically narrowed to the six categories that ship onboarding copy.
export interface WelcomeMarketPreview {
	readonly id: string;
	readonly category: Exclude<FlowArtCategory, 'wc'>;
	readonly question: string;
	readonly yesProbability: number;
	readonly yesPercent: number;
	readonly closesLabel: string;
	readonly calls: string;
	readonly days: number;
}

const previewMarket = ({
	id,
	category,
	question,
	yesProbability,
	closesLabel,
	calls,
	days
}: {
	id: string;
	category: Exclude<FlowArtCategory, 'wc'>;
	question: string;
	yesProbability: number;
	closesLabel: string;
	calls: string;
	days: number;
}): WelcomeMarketPreview => ({
	id,
	category,
	question,
	yesProbability,
	yesPercent: Math.round(yesProbability * 100),
	closesLabel,
	calls,
	days
});

export const WELCOME_MARKET_PREVIEWS: readonly WelcomeMarketPreview[] = [
	previewMarket({
		id: 'fed-jun',
		category: 'economy',
		question: 'Will the Fed cut rates in June?',
		yesProbability: 0.64,
		closesLabel: 'June 18',
		calls: '2.4M',
		days: 47
	}),
	previewMarket({
		id: 'btc-150k',
		category: 'crypto',
		question: 'Will BTC close above $150K by year-end?',
		yesProbability: 0.38,
		closesLabel: 'Dec 31',
		calls: '8.1M',
		days: 228
	}),
	previewMarket({
		id: 'gpt6-2026',
		category: 'tech',
		question: 'Will OpenAI release GPT-6 before Q4?',
		yesProbability: 0.22,
		closesLabel: 'Sep 30',
		calls: '620K',
		days: 135
	}),
	previewMarket({
		id: 'sb-niners',
		category: 'sports',
		question: 'Will the 49ers win the Super Bowl?',
		yesProbability: 0.31,
		closesLabel: 'Feb 8',
		calls: '1.8M',
		days: 266
	}),
	previewMarket({
		id: 'eu-ai-act',
		category: 'politics',
		question: 'Will the EU pass the AI Liability Act this session?',
		yesProbability: 0.55,
		closesLabel: 'Jul 12',
		calls: '410K',
		days: 58
	}),
	previewMarket({
		id: 'taylor-tour',
		category: 'culture',
		// Question copy must stay in sync with `onboarding.markets.taylor_tour.title`
		// in the i18n catalog — onboarding renders the i18n version, landing
		// renders this string; drift here means two surfaces tell two stories
		// about the same market id.
		question: 'Will Taylor Swift announce a 2027 tour by August?',
		yesProbability: 0.48,
		closesLabel: 'Nov 4',
		calls: '380K',
		days: 106
	}),
	previewMarket({
		id: 'eth-flip',
		category: 'crypto',
		question: 'Will ETH market cap exceed BTC by 2027?',
		yesProbability: 0.09,
		closesLabel: 'Jan 1, 2027',
		calls: '720K',
		days: 410
	})
] as const;
