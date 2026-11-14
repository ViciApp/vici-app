import type { FeaturedEvent } from '#lib/types/featured-event.ts';

/**
 * The 2026 FIFA World Cup: current featured event.
 *
 * To swap the featured event:
 *
 * 1. Add a new `FeaturedEvent` instance below (`OLYMPICS_2026`, etc.).
 * 2. Re-export it as `CURRENT_FEATURED_EVENT`.
 * 3. (Optional) Migrate any in-flight markets to carry the new `categoryTag`.
 *
 * Nothing else in the codebase reads the World Cup by name: surfaces use
 * the abstraction in `#lib/types/featured-event.ts` and the derivations in
 * `#lib/derived/featured-event.derived.ts`.
 *
 * Source: `data.js` § WORLD_CUP. Names are kept
 * as literal English; the rendering layer should layer i18n on top via
 * the participant `id` (ISO-3166 alpha-2 for football, where applicable).
 */
export const WORLD_CUP_2026: FeaturedEvent = {
	id: 'fifa-wc-2026',
	kind: 'tournament',
	title: '2026 FIFA World Cup',
	shortTitle: 'World Cup',
	badgeTitle: 'FIFA World Cup 2026',
	brandedTitle: 'FIFA World Cup',
	subtitle: 'USA · Canada · Mexico · 48 teams',
	kickoffAt_ms: Date.UTC(2026, 5, 11, 0, 0, 0), // June 11, 2026
	finalAt_ms: Date.UTC(2026, 6, 19, 0, 0, 0), // July 19, 2026
	archiveAfter_ms: Date.UTC(2026, 7, 1, 0, 0, 0), // 2026-08-01 (2 weeks post-final)
	categoryTag: 'wc',
	accentColor: '#0F8C3A',
	artworkKey: 'wc',
	predictorsEstimate: 12847,
	favouriteIds: ['BR', 'ES', 'FR', 'AR'],
	advancementMarkets: {
		BR: { id: 'wc-br-r16', q: 'Will Brazil make the round of 16?', yes: 78 },
		ES: { id: 'wc-es-r16', q: 'Will Spain make the round of 16?', yes: 74 },
		FR: { id: 'wc-fr-r16', q: 'Will France make the round of 16?', yes: 76 },
		AR: { id: 'wc-ar-r16', q: 'Will Argentina make the round of 16?', yes: 72 },
		EN: { id: 'wc-en-r16', q: 'Will England make the round of 16?', yes: 71 },
		DE: { id: 'wc-de-r16', q: 'Will Germany make the round of 16?', yes: 65 },
		PT: { id: 'wc-pt-r16', q: 'Will Portugal make the round of 16?', yes: 68 },
		NL: { id: 'wc-nl-r16', q: 'Will the Netherlands make the round of 16?', yes: 64 },
		BE: { id: 'wc-be-r16', q: 'Will Belgium make the round of 16?', yes: 58 },
		IT: { id: 'wc-it-r16', q: 'Will Italy make the round of 16?', yes: 54 },
		HR: { id: 'wc-hr-r16', q: 'Will Croatia make the round of 16?', yes: 52 },
		UY: { id: 'wc-uy-r16', q: 'Will Uruguay make the round of 16?', yes: 48 },
		US: { id: 'wc-us-r16', q: 'Will the USA make the round of 16?', yes: 46 },
		MA: { id: 'wc-ma-r16', q: 'Will Morocco make the round of 16?', yes: 42 },
		JP: { id: 'wc-jp-r16', q: 'Will Japan make the round of 16?', yes: 40 },
		SN: { id: 'wc-sn-r16', q: 'Will Senegal make the round of 16?', yes: 38 }
	},
	participants: [
		// Favourites first
		{
			id: 'BR',
			name: 'Brazil',
			glyph: '🇧🇷',
			winPct: 17.9,
			marketId: 'wc-winner-brazil',
			color: '#0F8C3A'
		},
		{
			id: 'ES',
			name: 'Spain',
			glyph: '🇪🇸',
			winPct: 14.9,
			marketId: 'wc-winner-spain',
			color: '#C8102E'
		},
		{
			id: 'FR',
			name: 'France',
			glyph: '🇫🇷',
			winPct: 14.1,
			marketId: 'wc-winner-france',
			color: '#0055A4'
		},
		{
			id: 'AR',
			name: 'Argentina',
			glyph: '🇦🇷',
			winPct: 12.0,
			marketId: 'wc-winner-argentina',
			color: '#75AADB'
		},
		// Tier 2
		{ id: 'EN', name: 'England', glyph: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', winPct: 9.8 },
		{ id: 'DE', name: 'Germany', glyph: '🇩🇪', winPct: 6.4 },
		{ id: 'PT', name: 'Portugal', glyph: '🇵🇹', winPct: 5.9 },
		{ id: 'NL', name: 'Netherlands', glyph: '🇳🇱', winPct: 5.1 },
		{ id: 'BE', name: 'Belgium', glyph: '🇧🇪', winPct: 3.8 },
		{ id: 'IT', name: 'Italy', glyph: '🇮🇹', winPct: 3.4 },
		{ id: 'UY', name: 'Uruguay', glyph: '🇺🇾', winPct: 2.9 },
		{ id: 'HR', name: 'Croatia', glyph: '🇭🇷', winPct: 2.4 },
		{ id: 'MA', name: 'Morocco', glyph: '🇲🇦', winPct: 2.0 },
		{ id: 'US', name: 'USA', glyph: '🇺🇸', winPct: 1.8 },
		{ id: 'JP', name: 'Japan', glyph: '🇯🇵', winPct: 1.5 },
		{ id: 'SN', name: 'Senegal', glyph: '🇸🇳', winPct: 1.3 },
		// Long tail
		{ id: 'CH', name: 'Switzerland', glyph: '🇨🇭', winPct: 1.2 },
		{ id: 'MX', name: 'Mexico', glyph: '🇲🇽', winPct: 1.1 },
		{ id: 'CO', name: 'Colombia', glyph: '🇨🇴', winPct: 1.0 },
		{ id: 'DK', name: 'Denmark', glyph: '🇩🇰', winPct: 0.9 },
		{ id: 'KR', name: 'Korea Rep.', glyph: '🇰🇷', winPct: 0.8 },
		{ id: 'EC', name: 'Ecuador', glyph: '🇪🇨', winPct: 0.7 },
		{ id: 'AU', name: 'Australia', glyph: '🇦🇺', winPct: 0.6 },
		{ id: 'RS', name: 'Serbia', glyph: '🇷🇸', winPct: 0.6 },
		{ id: 'CA', name: 'Canada', glyph: '🇨🇦', winPct: 0.5 },
		{ id: 'PL', name: 'Poland', glyph: '🇵🇱', winPct: 0.5 },
		{ id: 'AT', name: 'Austria', glyph: '🇦🇹', winPct: 0.4 },
		{ id: 'TR', name: 'Turkey', glyph: '🇹🇷', winPct: 0.4 },
		{ id: 'NO', name: 'Norway', glyph: '🇳🇴', winPct: 0.4 },
		{ id: 'EG', name: 'Egypt', glyph: '🇪🇬', winPct: 0.3 },
		{ id: 'CI', name: 'Côte d’Ivoire', glyph: '🇨🇮', winPct: 0.3 },
		{ id: 'NG', name: 'Nigeria', glyph: '🇳🇬', winPct: 0.3 },
		{ id: 'DZ', name: 'Algeria', glyph: '🇩🇿', winPct: 0.3 },
		{ id: 'GH', name: 'Ghana', glyph: '🇬🇭', winPct: 0.2 },
		{ id: 'CM', name: 'Cameroon', glyph: '🇨🇲', winPct: 0.2 },
		{ id: 'TN', name: 'Tunisia', glyph: '🇹🇳', winPct: 0.2 },
		{ id: 'IR', name: 'Iran', glyph: '🇮🇷', winPct: 0.2 },
		{ id: 'SA', name: 'Saudi Arabia', glyph: '🇸🇦', winPct: 0.2 },
		{ id: 'QA', name: 'Qatar', glyph: '🇶🇦', winPct: 0.2 },
		{ id: 'IQ', name: 'Iraq', glyph: '🇮🇶', winPct: 0.2 },
		{ id: 'UZ', name: 'Uzbekistan', glyph: '🇺🇿', winPct: 0.2 },
		{ id: 'CR', name: 'Costa Rica', glyph: '🇨🇷', winPct: 0.2 },
		{ id: 'PA', name: 'Panama', glyph: '🇵🇦', winPct: 0.1 },
		{ id: 'JM', name: 'Jamaica', glyph: '🇯🇲', winPct: 0.1 },
		{ id: 'PY', name: 'Paraguay', glyph: '🇵🇾', winPct: 0.1 },
		{ id: 'CL', name: 'Chile', glyph: '🇨🇱', winPct: 0.1 },
		{ id: 'NZ', name: 'New Zealand', glyph: '🇳🇿', winPct: 0.1 },
		{ id: 'WA', name: 'Wales', glyph: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', winPct: 0.1 }
	]
};

/**
 * The featured event currently surfaced by the app. Swap this single
 * export to re-point the entire event surface (onboarding, Flow filter,
 * Worlds event battle) at a new tentpole.
 */
export const CURRENT_FEATURED_EVENT: FeaturedEvent = WORLD_CUP_2026;
