import type { MessageKey } from '#lib/utils/i18n.utils.ts';

export type AchievementTier = 'gold' | 'silver' | 'bronze';

/**
 * Achievement definition: drives the Album tile + the unlock toast.
 *
 * On the profile + album surfaces the canonical render is the lucide
 * `Trophy` outline glyph with the tier-tinted wash (every award shows
 * the same trophy mark on the AlbumScreen). `emblem` is kept as a
 * single unicode fallback glyph for surfaces that render the def
 * out-of-band (Dash next-up rail) and for screen-reader / plain-text
 * contexts. The catalogue uses the brand's approved glyph set
 * (`◎ ★ ⚡ ⧖ ◐ ⌘ ✦`: see `docs/ai/frontend/brand.md`).
 *
 * `tier` decides the wash colour (gold = laurel-tinted; silver /
 * bronze are reserved for monthly-leaderboard achievements once they
 * ship).
 *
 * `detailKey` is the rich multi-sentence prose surfaced in the
 * bottom-sheet modal: distinct from the short `descriptionKey`
 * sub-line on the tile.
 *
 * The order in this array is the default render order for the
 * profile achievement rail before progress-sorting kicks in: it leads
 * with `contrarian`, `marathon`, `first-call`.
 */
export interface AchievementDef {
	id: string;
	nameKey: MessageKey;
	descriptionKey: MessageKey;
	detailKey: MessageKey;
	emblem: string;
	tier: AchievementTier;
	xp: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
	{
		id: 'contrarian',
		nameKey: 'achievement.contrarian.name',
		descriptionKey: 'achievement.contrarian.description',
		detailKey: 'achievement.contrarian.detail',
		emblem: '⧖',
		tier: 'gold',
		xp: 400
	},
	{
		id: 'marathon',
		nameKey: 'achievement.marathon.name',
		descriptionKey: 'achievement.marathon.description',
		detailKey: 'achievement.marathon.detail',
		emblem: '◐',
		tier: 'gold',
		xp: 800
	},
	{
		id: 'first-call',
		nameKey: 'achievement.first_call.name',
		descriptionKey: 'achievement.first_call.description',
		detailKey: 'achievement.first_call.detail',
		emblem: '◎',
		tier: 'gold',
		xp: 50
	},
	{
		id: 'on-fire',
		nameKey: 'achievement.on_fire.name',
		descriptionKey: 'achievement.on_fire.description',
		detailKey: 'achievement.on_fire.detail',
		emblem: '⚡',
		tier: 'gold',
		xp: 200
	},
	{
		id: 'oracle',
		nameKey: 'achievement.oracle.name',
		descriptionKey: 'achievement.oracle.description',
		detailKey: 'achievement.oracle.detail',
		emblem: '★',
		tier: 'gold',
		xp: 500
	},
	{
		id: 'league-founder',
		nameKey: 'achievement.league_founder.name',
		descriptionKey: 'achievement.league_founder.description',
		detailKey: 'achievement.league_founder.detail',
		emblem: '✦',
		tier: 'gold',
		xp: 300
	},
	{
		id: 'top-decile',
		nameKey: 'achievement.top_decile.name',
		descriptionKey: 'achievement.top_decile.description',
		detailKey: 'achievement.top_decile.detail',
		emblem: '⌘',
		tier: 'gold',
		xp: 1000
	},
	{
		// Monthly accuracy podium. The static `tier` is the default wash;
		// the live tier (gold / silver / bronze) comes from the profile's
		// `sharpestEyeBestTier` once the album surface reads it.
		id: 'sharpest-eye',
		nameKey: 'achievement.sharpest_eye.name',
		descriptionKey: 'achievement.sharpest_eye.description',
		detailKey: 'achievement.sharpest_eye.detail',
		emblem: '◉',
		tier: 'gold',
		xp: 750
	},
	{
		id: 'bold-caller',
		nameKey: 'achievement.bold_caller.name',
		descriptionKey: 'achievement.bold_caller.description',
		detailKey: 'achievement.bold_caller.detail',
		emblem: '✧',
		tier: 'gold',
		xp: 600
	}
];

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
