import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import { isNullish } from '@dfinity/utils';

/**
 * The single definition of "rank within a league". Every surface that shows
 * a member's league position (the leagues-list card badge, the detail-page
 * hero, and the detail-page leaderboard list) ranks through here, so the
 * three can never disagree.
 *
 * The order is accuracy-first: prediction accuracy (win rate) descending,
 * tie-broken on the longer active streak, then on join order (oldest first)
 * for a stable result. A member yet to settle a prediction sits at 0% and
 * sinks to the foot rather than riding join order or role to the top. This
 * mirrors the global leaderboard and is window-independent: the accuracy
 * figure is a single lifetime value, identical on the week and all-time
 * tabs.
 *
 * Accuracy/streak are read through caller-supplied accessors (the component
 * owns the profile cache) and snapshotted once per member before the sort,
 * so the O(n log n) comparator never re-reads the cache on every pass.
 */

export const rankLeagueMembers = ({
	members,
	accuracyOf,
	streakOf
}: {
	members: LeagueMemberDoc[];
	/** Prediction accuracy (0–100) for a principal; 0 before its profile loads. */
	accuracyOf: (principal: string) => number;
	/** Consecutive active days for a principal; 0 before its profile loads. */
	streakOf: (principal: string) => number;
}): LeagueMemberDoc[] => {
	const ranked = members.map((member) => ({
		member,
		accuracy: accuracyOf(member.member),
		streak: streakOf(member.member)
	}));

	ranked.sort((a, b) => {
		const accuracyDelta = b.accuracy - a.accuracy;

		if (accuracyDelta !== 0) {
			return accuracyDelta;
		}

		const streakDelta = b.streak - a.streak;

		if (streakDelta !== 0) {
			return streakDelta;
		}

		return a.member.joinedAtMs - b.member.joinedAtMs;
	});

	return ranked.map((r) => r.member);
};

/**
 * The caller's 1-based position inside an already-ranked roster (the output
 * of {@link rankLeagueMembers}), or `undefined` when the principal isn't in
 * the roster, e.g. while it is still hydrating, so the caller can default
 * or hide the badge rather than show a wrong number.
 */
export const leagueRankOf = ({
	sorted,
	principal
}: {
	sorted: LeagueMemberDoc[];
	principal: string | undefined;
}): number | undefined => {
	if (isNullish(principal)) {
		return;
	}

	const idx = sorted.findIndex((m) => m.member === principal);

	return idx === -1 ? undefined : idx + 1;
};
