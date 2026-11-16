import { MONTH_ANCHOR_RE, monthAnchorFromMs } from '#lib/utils/month-anchor.utils.ts';

/**
 * Why the draw for `monthAnchor` is refused at `nowMs` on month grounds,
 * or nothing when that month can be drawn. Only the current UTC month can:
 * a closed month has every round window behind it, so its bracket would
 * resolve and conclude at once on double forfeits and pay prizes for a
 * tournament nobody played.
 */
export const tournamentDrawMonthRefusal = ({
	monthAnchor,
	nowMs
}: {
	monthAnchor: string;
	nowMs: number;
}): 'invalid_input' | 'month_not_started' | undefined => {
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		return 'invalid_input';
	}

	const currentMonthAnchor = monthAnchorFromMs(nowMs);

	if (monthAnchor > currentMonthAnchor) {
		return 'month_not_started';
	}

	if (monthAnchor !== currentMonthAnchor) {
		return 'invalid_input';
	}
};
