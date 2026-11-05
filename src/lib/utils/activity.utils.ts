import { ActivityType } from '#lib/enums/social.ts';

/**
 * Single-character glyph for an activity-feed row. Brand rule: no
 * emoji in user-facing surfaces ([`brand.md §2.3`](../../../docs/ai/frontend/brand.md#23-no-emoji-ever)).
 * The glyphs below are all from the approved typographic set.
 */
export const getActivityIcon = (type: ActivityType): string => {
	switch (type) {
		case ActivityType.TRADE:
			return '↑';
		case ActivityType.SETTLEMENT:
			return '◎';
		case ActivityType.COMMENT:
			return '—';
		case ActivityType.FOLLOW:
			return '→';
		case ActivityType.UPVOTE:
			return '↑';
		case ActivityType.DOWNVOTE:
			return '↓';
		default:
			return '·';
	}
};
