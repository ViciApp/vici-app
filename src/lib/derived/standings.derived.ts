import {
	LEADERBOARD_PRIOR_MEAN,
	LEADERBOARD_PRIOR_WEIGHT
} from '#lib/constants/standings.constants.ts';
import { profilesStore } from '#lib/stores/profiles.store.ts';
import { globalStandingsStore } from '#lib/stores/standings.store.ts';
import { leaderboardQualifyMin } from '#lib/stores/tweaks.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import type { StandingEntry, StandingsWindow } from '#lib/types/standings.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@junobuild/schema';
import { derived, type Readable } from 'svelte/store';

/**
 * Bayesian-shrinkage leaderboard score for one entry.
 *
 * A predictor's win rate is blended with a population prior, weighted by how
 * much evidence they have: `(PRIOR_MEAN·PRIOR_WEIGHT + wins) / (PRIOR_WEIGHT +
 * settled)`. A thin record decays toward the prior mean, so a 10/11 (≈0.91)
 * record scores below a 45/50 (0.90) record once shrunk — being right
 * *repeatedly* is the score, not a short lucky streak.
 *
 * Uses the raw `winCount / settledCount` ratio (reconstructed as `wins =
 * accuracy_fraction · settled`, here `winCount` directly), NOT the rounded
 * integer `accuracy`, so the blend doesn't compress at the rounding. Returns
 * the prior mean for a zero-settled entry (no evidence at all).
 */
export const rankScore = ({
	winCount,
	settledCount
}: Pick<StandingEntry, 'winCount' | 'settledCount'>): number => {
	// No evidence → the prior mean, explicitly. Guards the documented contract
	// against an inconsistent upstream (a `winCount` with a zero `settledCount`
	// would otherwise lift the score above the prior, even past 1).
	if (settledCount <= 0) {
		return LEADERBOARD_PRIOR_MEAN;
	}

	return (
		(LEADERBOARD_PRIOR_MEAN * LEADERBOARD_PRIOR_WEIGHT + winCount) /
		(LEADERBOARD_PRIOR_WEIGHT + settledCount)
	);
};

/**
 * Shrinkage-first ordering for the *ranked* (qualified) leaderboard slice.
 *
 * The clearing canister hands us the slice ranked by net realized P&L (a
 * high-stakes loss can outrank a quiet 100%), so we re-rank it here on the FE
 * for this surface only. Other consumers of the same cached slice (the Dash
 * "Top X%" rank tile, `findOwnStanding`) deliberately keep the canister's P&L
 * rank — see `standings.services`.
 *
 * Order: shrinkage score desc → settledCount desc (more proof breaks a score
 * tie) → realizedPnl desc → stable (equal entries fall through to the input
 * order, the canister's tiebreak, so the sort is deterministic).
 */
// eslint-disable-next-line local-rules/prefer-object-params -- compare functions read best with positional params
const byRankScore = (a: StandingEntry, b: StandingEntry): number => {
	const scoreA = rankScore(a);
	const scoreB = rankScore(b);

	if (scoreA !== scoreB) {
		return scoreB - scoreA;
	}

	if (b.settledCount !== a.settledCount) {
		return b.settledCount - a.settledCount;
	}

	// `realizedPnl` is a signed bigint — compare directly, never via Number.
	if (a.realizedPnl !== b.realizedPnl) {
		return b.realizedPnl > a.realizedPnl ? 1 : -1;
	}

	return 0;
};

/**
 * Ordering for the *provisional* (below-gate) slice: closest to qualifying
 * first (settledCount desc), accuracy as a stable tiebreak. These rows are
 * never ranked, so they don't go through the shrinkage sort.
 */
// eslint-disable-next-line local-rules/prefer-object-params -- compare functions read best with positional params
const byProgress = (a: StandingEntry, b: StandingEntry): number => {
	if (b.settledCount !== a.settledCount) {
		return b.settledCount - a.settledCount;
	}

	return b.accuracy - a.accuracy;
};

/**
 * A ranked standings row joined with the predictor's display identity. The
 * accuracy-ordered position (`displayRank`) and the underlying figures
 * (accuracy, P&L, settled count) are authoritative; the handle / avatar /
 * streak are overlaid from the shared profile cache, with the viewer's own row
 * taking the freshest values from `userStore.profile` so they never see a stale
 * handle for themselves.
 */
export interface StandingsRow {
	entry: StandingEntry;
	owner: PrincipalText;
	/**
	 * 1-based position in the shrinkage-ordered ranked list — NOT `entry.rank`
	 * (the canister's P&L rank). This is the number the leaderboard renders.
	 * `undefined` for a provisional row (below the qualify gate, so unranked).
	 */
	displayRank: number | undefined;
	nickname: string | undefined;
	avatar: string | undefined;
	/** Serialized faceted-avatar picks — lets the row render the predictor's
	 *  saved face instead of the principal-seeded fallback. */
	avatarParts: string | undefined;
	/**
	 * Consecutive active days (the Flame engine) — the leaderboard renders
	 * this as "{n}d streak", so it must be the days-based counter, not the
	 * consecutive-wins `streak` field.
	 */
	dailyStreak: number;
	isSelf: boolean;
}

const toRow = ({
	entry,
	displayRank,
	profile,
	self,
	selfProfile
}: {
	entry: StandingEntry;
	displayRank: number | undefined;
	profile: UserProfile | undefined;
	self: boolean;
	selfProfile: UserProfile | undefined;
}): StandingsRow => {
	const source = self ? (selfProfile ?? profile) : profile;

	return {
		entry,
		owner: entry.owner,
		displayRank,
		nickname: source?.nickname,
		avatar: source?.avatar,
		avatarParts: source?.avatarParts,
		dailyStreak: source?.dailyStreak ?? 0,
		isSelf: self
	};
};

/**
 * The two partitions a window's standings split into: predictors who have
 * cleared the qualify gate (`ranked`, in shrinkage order with a stamped
 * `displayRank`) and those below it (`provisional`, ordered by progress toward
 * the gate, `displayRank` left `undefined`).
 */
export interface PartitionedStandings {
	ranked: StandingsRow[];
	provisional: StandingsRow[];
}

/**
 * Builds a readable of the joined {@link PartitionedStandings} for one window's
 * cached global standings. `undefined` while the window has not yet loaded
 * (distinct from a loaded-but-empty window, whose partitions are both `[]`).
 *
 * Two guards turn raw accuracy into a defensible board (see
 * `standings.constants`): a **qualify gate** (settled ≥ the effective
 * threshold) splits ranked from provisional, and **shrinkage** orders the
 * ranked slice so thin records don't top it. The gate threshold is read live
 * from {@link leaderboardQualifyMin} (the dev Tweaks knob), so changing it
 * re-partitions the board without a reload.
 *
 * This re-ranks the *fetched slice* — the canister returns the top-N by net
 * P&L, so re-ranking here is correct only while the whole user base fits within
 * the fetched pages. At scale, ranking should move into the clearing canister
 * (`list_leaderboard`) so high-accuracy / low-P&L predictors (and below-gate
 * provisional ones) aren't dropped from the slice before the FE ever sees them.
 */
export const globalStandingsRows = (
	window: StandingsWindow
): Readable<PartitionedStandings | undefined> =>
	derived(
		[globalStandingsStore, profilesStore, userStore, leaderboardQualifyMin],
		([$standings, $profiles, { user, profile }, $qualifyMin]) => {
			const result = $standings.get(window);

			if (isNullish(result)) {
				return;
			}

			const selfOwner = user?.owner;

			const join = ({
				entry,
				displayRank
			}: {
				entry: StandingEntry;
				displayRank: number | undefined;
			}): StandingsRow =>
				toRow({
					entry,
					displayRank,
					profile: $profiles.get(entry.owner),
					self: entry.owner === selfOwner,
					selfProfile: profile
				});

			// Honor the "Show on global leaderboard" opt-out, failing CLOSED: a
			// non-self row is shown only once its profile is loaded AND not
			// opted out. While the profile is still hydrating it stays hidden,
			// so an opted-out predictor never flashes onto the board in the gap
			// before we know their preference (showing-then-hiding is itself a
			// leak). The viewer always keeps their own row and rank —
			// `ownGlobalStanding` reads this same self-inclusive slice, so the
			// two surfaces never disagree. The leaderboard page hydrates every
			// raw-slice entry (not just the visible rows), so opted-in rows fill
			// in as profiles land rather than starving — see LeaderboardPage's
			// hydration effect. A nullish flag on a loaded profile (legacy row)
			// reads as opted-in, matching the always-shown default.
			const visible = [...result.entries].filter((entry) => {
				if (entry.owner === selfOwner) {
					return true;
				}

				const profile = $profiles.get(entry.owner);

				return nonNullish(profile) && profile.preferences.sharing.leaderboardOptIn !== false;
			});
			const qualified = visible.filter((entry) => entry.settledCount >= $qualifyMin);
			const provisional = visible.filter((entry) => entry.settledCount < $qualifyMin);

			return {
				// 1-based position in the shrinkage order, not the canister rank.
				ranked: qualified.sort(byRankScore).map((entry, i) => join({ entry, displayRank: i + 1 })),
				provisional: provisional
					.sort(byProgress)
					.map((entry) => join({ entry, displayRank: undefined }))
			};
		}
	);

/**
 * The viewer's own standing in one window — the exact rank the leaderboard
 * renders for their `You` row, surfaced for compact callers (the Arena "Global
 * ranking" card) that show a single number instead of the full board, so the
 * two surfaces can never disagree about the viewer's position.
 *
 * `displayRank` is the shrinkage-ordered position once the viewer has cleared
 * the qualify gate; `provisional` is `true` when they're below it (unranked,
 * `displayRank` left `undefined`). `undefined` while the window's slice hasn't
 * loaded, or when the viewer isn't in the fetched slice at all — the same
 * top-N limitation {@link globalStandingsRows} carries.
 */
export interface OwnStanding {
	displayRank: number | undefined;
	provisional: boolean;
}

export const ownGlobalStanding = (window: StandingsWindow): Readable<OwnStanding | undefined> =>
	derived(globalStandingsRows(window), ($partition) => {
		if (isNullish($partition)) {
			return;
		}

		const ranked = $partition.ranked.find((row) => row.isSelf);

		if (nonNullish(ranked)) {
			return { displayRank: ranked.displayRank, provisional: false };
		}

		return $partition.provisional.some((row) => row.isSelf)
			? { displayRank: undefined, provisional: true }
			: undefined;
	});
