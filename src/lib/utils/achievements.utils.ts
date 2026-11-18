// Pure achievement evaluator.
//
// Single source of truth for the rules that decide which entries in
// `ACHIEVEMENTS` are unlocked or in progress, given a snapshot of the
// user's stats. Consumed by:
//
// - `profile.services.ts`: after recomputing stats, to detect newly
//   unlocked ids, credit XP, and persist them.
// - `ProfileDashboard.svelte`: to render unlocked state + progress.
//
// Keep this file pure (no Svelte / stores / I/O). All inputs flow in
// through `AchievementsInput`; outputs are deterministic.

import { ACHIEVEMENTS, type AchievementDef } from '#lib/constants/achievements.constants.ts';
import { ACCURACY_GATE_CALLS } from '#lib/constants/flow-rewards.constants.ts';
import { nonNullish } from '@dfinity/utils';

// "Long shot" cutoff for the `contrarian` achievement: a settled trade
// counts as a contrarian win when the user paid this price or less for
// the winning side (i.e. the market thought their side was ≤30% likely
// at execution time). Mirrors the public copy "10 wins on <30%
// consensus" in `achievement.contrarian.description`.
export const CONTRARIAN_PRICE_THRESHOLD = 0.3;
export const CONTRARIAN_WIN_TARGET = 10;
export const ON_FIRE_STREAK_TARGET = 10;
export const ORACLE_ACCURACY_TARGET = 80;
export const ORACLE_TRADES_TARGET = 50;
export const MARATHON_DAILY_STREAK_TARGET = 30;
// `league-founder` unlocks once the caller owns a league with at least
// this many members (themselves included). Sticky: survives a later
// disband via `mergeUnlockedAchievements`.
export const LEAGUE_FOUNDER_MIN_MEMBERS = 3;
// `top-decile` unlocks after holding a top-10% global-leaderboard
// position for this many consecutive calendar days. The streak is
// bumped at most once per calendar day inside `calculateAndSyncStats`
// (client-side, persisted to the profile doc); this evaluator only
// reads the already-persisted value.
export const TOP_DECILE_STREAK_TARGET = 7;

export interface AchievementsInput {
	totalTrades: number;
	/** Consecutive winning trades (motion-engine "streak"). */
	winStreak: number;
	dailyStreak: number;
	accuracy: number;
	contrarianWins: number;
	/**
	 * `true` when the caller currently owns a league whose member count
	 * is at least `LEAGUE_FOUNDER_MIN_MEMBERS`. Drives `league-founder`.
	 */
	ownsQualifyingLeague: boolean;
	/**
	 * Consecutive calendar days the caller has held a top-10% global
	 * leaderboard position. Drives `top-decile`.
	 */
	topDecileStreak: number;
	/**
	 * Best monthly sharpest-eye placement the caller has ever earned:
	 * `'gold'` / `'silver'` / `'bronze'`, or `undefined` if they've never
	 * placed top-3 in a completed month. Drives `sharpest-eye` (presence =
	 * unlocked; the value picks the tier wash).
	 */
	sharpestEyeBestTier?: string;
	/**
	 * `true` when the caller has won (or tied for) a completed month's
	 * bold-caller award: best accuracy among users whose median
	 * consensus-at-call is below the bold threshold. Drives `bold-caller`.
	 */
	wonBoldCallerMonth: boolean;
}

export interface AchievementEvaluation {
	id: string;
	def: AchievementDef;
	unlocked: boolean;
	/** 0..1: capped. Always 1 when `unlocked` is true. */
	progress: number;
}

const ratio = ({ current, target }: { current: number; target: number }): number => {
	if (target <= 0) {
		return 0;
	}

	return Math.max(0, Math.min(current / target, 1));
};

const evaluateOne = ({
	def,
	input
}: {
	def: AchievementDef;
	input: AchievementsInput;
}): AchievementEvaluation => {
	const { totalTrades, winStreak, dailyStreak, accuracy, contrarianWins } = input;
	const accuracyUnlocked = totalTrades >= ACCURACY_GATE_CALLS;

	switch (def.id) {
		case 'first-call': {
			const unlocked = totalTrades > 0;

			return { id: def.id, def, unlocked, progress: unlocked ? 1 : 0 };
		}

		case 'on-fire': {
			return {
				id: def.id,
				def,
				unlocked: winStreak >= ON_FIRE_STREAK_TARGET,
				progress: ratio({ current: winStreak, target: ON_FIRE_STREAK_TARGET })
			};
		}

		case 'oracle': {
			const accuracyHit = accuracyUnlocked && accuracy >= ORACLE_ACCURACY_TARGET;
			const tradesHit = totalTrades >= ORACLE_TRADES_TARGET;

			// Progress on the trade-count axis only: accuracy is a
			// quality gate, not a continuous bar. (We don't want to
			// teach users that "more trades at 40% accuracy = closer
			// to Oracle".)
			return {
				id: def.id,
				def,
				unlocked: accuracyHit && tradesHit,
				progress: accuracyHit ? ratio({ current: totalTrades, target: ORACLE_TRADES_TARGET }) : 0
			};
		}

		case 'contrarian': {
			return {
				id: def.id,
				def,
				unlocked: contrarianWins >= CONTRARIAN_WIN_TARGET,
				progress: ratio({ current: contrarianWins, target: CONTRARIAN_WIN_TARGET })
			};
		}

		case 'marathon': {
			return {
				id: def.id,
				def,
				unlocked: dailyStreak >= MARATHON_DAILY_STREAK_TARGET,
				progress: ratio({ current: dailyStreak, target: MARATHON_DAILY_STREAK_TARGET })
			};
		}

		case 'league-founder': {
			// Binary unlock: own a league of `LEAGUE_FOUNDER_MIN_MEMBERS`+
			// members. Progress is 0/1 (no partial bar): the threshold is
			// a membership count the caller doesn't directly control. Once
			// merged into `unlockedAchievements` it's sticky, so a later
			// disband or member exodus never rescinds it.
			return {
				id: def.id,
				def,
				unlocked: input.ownsQualifyingLeague,
				progress: input.ownsQualifyingLeague ? 1 : 0
			};
		}

		case 'top-decile': {
			return {
				id: def.id,
				def,
				unlocked: input.topDecileStreak >= TOP_DECILE_STREAK_TARGET,
				progress: ratio({ current: input.topDecileStreak, target: TOP_DECILE_STREAK_TARGET })
			};
		}

		case 'sharpest-eye': {
			// Binary unlock: earned the first time the caller places top-3 in
			// a completed month's accuracy leaderboard. Presence of a best
			// tier is the unlock signal (the tier picks the album wash). No
			// partial bar: the placement is a monthly cohort ranking the caller
			// doesn't directly control. Sticky via `mergeUnlockedAchievements`.
			const unlocked = nonNullish(input.sharpestEyeBestTier);

			return { id: def.id, def, unlocked, progress: unlocked ? 1 : 0 };
		}

		case 'bold-caller': {
			// Binary unlock: won (or tied for) a completed month's bold-caller
			// award (best accuracy among habitual long-shot callers). 0/1
			// progress for the same reason as `sharpest-eye`; sticky once
			// earned.
			return {
				id: def.id,
				def,
				unlocked: input.wonBoldCallerMonth,
				progress: input.wonBoldCallerMonth ? 1 : 0
			};
		}

		default:
			return { id: def.id, def, unlocked: false, progress: 0 };
	}
};

export const evaluateAchievements = (input: AchievementsInput): AchievementEvaluation[] =>
	ACHIEVEMENTS.map((def) => evaluateOne({ def, input }));

/**
 * Merges a fresh evaluation pass into the persisted list and returns
 * the merged set plus any ids that flipped from locked → unlocked.
 *
 * Unlocks are sticky: an id that's in `previouslyUnlocked` stays in
 * the result even if its current `unlocked` flag is false (e.g. the
 * user's streak regressed). The newly-unlocked list is the trigger
 * for one-shot side effects: XP credit and toast.
 */
export const mergeUnlockedAchievements = ({
	previouslyUnlocked,
	evaluations
}: {
	previouslyUnlocked: readonly string[];
	evaluations: readonly AchievementEvaluation[];
}): { unlocked: string[]; newlyUnlocked: AchievementEvaluation[] } => {
	const prev = new Set(previouslyUnlocked);
	const newlyUnlocked = evaluations.filter(
		(evaluation) => evaluation.unlocked && !prev.has(evaluation.id)
	);
	const unlocked = [...previouslyUnlocked, ...newlyUnlocked.map((evaluation) => evaluation.id)];

	return { unlocked, newlyUnlocked };
};
