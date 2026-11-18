import {
	monthStartMs,
	roundWindow,
	type TriggerTournamentDrawRefusalReason
} from '#lib/types/tournament.ts';
import { MONTH_ANCHOR_RE, monthAnchorFromMs } from '#lib/utils/month-anchor.utils.ts';

/**
 * Why the draw for `monthAnchor` is refused at `nowMs`, or nothing when that
 * month can be drawn. Only the current UTC month can, and only while its
 * round 1 window is still open: the round windows are anchored at the month
 * start, so a bracket drawn after round 1 closed would resolve its closed
 * rounds at once on double forfeits and pay prizes for matches nobody played.
 * After that, the month has no tournament. A closed month has every window
 * behind it and is refused the same way.
 */
export const tournamentDrawRefusal = ({
	monthAnchor,
	nowMs
}: {
	monthAnchor: string;
	nowMs: number;
}): TriggerTournamentDrawRefusalReason | undefined => {
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		return 'invalid_input';
	}

	const currentMonthAnchor = monthAnchorFromMs(nowMs);

	if (monthAnchor > currentMonthAnchor) {
		return 'month_not_started';
	}

	const roundOne = roundWindow({ tournamentMonthStartMs: monthStartMs(nowMs), round: 'r1' });

	if (monthAnchor !== currentMonthAnchor || nowMs >= roundOne.endMs) {
		return 'invalid_input';
	}
};
