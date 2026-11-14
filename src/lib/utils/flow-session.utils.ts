import { DAILY_GOAL_TARGET } from '#lib/utils/daily-goal.utils.ts';
import { DAILY_HARD_CAP } from '#lib/utils/motion-engine.utils.ts';

// Sitting-ceiling arithmetic for a Flow session. Pure functions over the
// daily-goal baseline and the per-day hard cap, kept out of the component
// so the cross-session cap rules (#484/#485) live in one place. The
// component holds the reactive `$state`/`$derived` and delegates the math.

/**
 * This sitting's ceiling for the cumulative daily count: the daily ten
 * normally, or the daily hard cap (15) once the day is already in overtime
 * (entered with ten-or-more placed) or the user pushed into it.
 */
export const sittingGoalFor = ({
	baseline,
	pushedToOvertime
}: {
	baseline: number;
	pushedToOvertime: boolean;
}): number =>
	baseline >= DAILY_GOAL_TARGET || pushedToOvertime ? DAILY_HARD_CAP : DAILY_GOAL_TARGET;

/**
 * Swipes this sitting may still place: the sitting goal less what the day
 * already carried in. The run ends on the session counter reaching this:
 * exactly the cumulative daily count reaching `sittingGoal`, so the cap
 * holds regardless of how many times Flow is re-entered today.
 */
export const maxCallsFor = ({
	sittingGoal,
	baseline
}: {
	sittingGoal: number;
	baseline: number;
}): number => Math.max(0, sittingGoal - baseline);

/**
 * Whether the day's sitting goal is the hard cap (15): the day entered in
 * overtime or the user opted in via Push-to-15.
 */
export const isOvertimeSession = (sittingGoal: number): boolean => sittingGoal >= DAILY_HARD_CAP;

/**
 * Whether the day's calls have reached the hard cap across sessions, so
 * opening Flow should show the "come back tomorrow" takeover.
 */
export const isDailyCapReached = (dailyGoalDone: number): boolean =>
	dailyGoalDone >= DAILY_HARD_CAP;

/**
 * Whether Push-to-15 may be offered on FlowEnd: only on a regular
 * (non-overtime) day that still has deck inventory to continue into, and
 * only while the day has cross-session headroom left under the hard cap.
 */
export const canExtendSession = ({
	overtimeSession,
	hasMoreCards,
	dailyGoalDone
}: {
	overtimeSession: boolean;
	hasMoreCards: boolean;
	dailyGoalDone: number;
}): boolean => !overtimeSession && hasMoreCards && dailyGoalDone < DAILY_HARD_CAP;
