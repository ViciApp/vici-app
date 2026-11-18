import {
	del as storageDel,
	get as storageGet,
	set as storageSet
} from '#lib/utils/storage.utils.ts';
import { todayKey } from '#lib/utils/streak.utils.ts';
import { nonNullish } from '@dfinity/utils';

// Standard daily target: predictions a user commits to making in a day.
// Single source of truth for both the Flow session ceiling and the
// dashboard "Today's goal" resume card, so the two surfaces never drift.
export const DAILY_GOAL_TARGET = 10;

export interface DailyGoalState {
	// Predictions committed toward the goal on `date` (`0..target`).
	done: number;
	// Local-day key (`YYYY-MM-DD`) the count belongs to.
	date: string;
}

/**
 * Effective goal count for *today*. Returns the stored `done` only when
 * it belongs to the current local day; any earlier day has already
 * elapsed, so the goal reads as 0. Pure; callers decide when to read.
 *
 * Used for hydration/display so a session opened on a new day shows a
 * fresh goal before the first prediction lands.
 */
export const rolloverDailyGoal = ({
	done,
	date,
	now = new Date()
}: {
	done: number;
	date?: string;
	now?: Date;
}): number => (date === todayKey(now) ? Math.max(0, done) : 0);

/**
 * Record one prediction toward the daily goal. Rolls the count over to
 * the current local day first (so the previous day's total never leaks
 * into today), then increments by one, capped at `target`. Stateless:
 * callers persist the returned `{ done, date }`.
 */
export const applyDailyGoalBump = ({
	done,
	date,
	target,
	now = new Date()
}: {
	done: number;
	date?: string;
	target: number;
	now?: Date;
}): DailyGoalState => {
	const today = todayKey(now);
	const base = rolloverDailyGoal({ done, date, now });

	return { done: Math.min(target, base + 1), date: today };
};

// localStorage mirror of the daily-goal count. The AUTHORITATIVE copy
// lives on the profile and is set by the satellite (`recordFlowSwipe`,
// which the server computes and caps: the client never sends a count).
// The mirror is a fast OFFLINE HINT and an in-flight high-water: written
// synchronously on every commit so the cap still gates a refresh that
// races the server read, a signed-out / offline session, or a re-entry
// while per-swipe records are still in flight. On entry it is reconciled
// against the server value by taking the MAX, so it can only ever RAISE
// the count: a stale-low profile can't re-open the cap, and a cleared /
// lower mirror can't either (see `reconcileDailyGoalOnEntry`).
// Namespaced + versioned to match the repo's other persisted keys
// (`vici.motion.state.v3`, `vici-theme`) and leave room for a future
// shape migration.
const DAILY_GOAL_STORAGE_KEY = 'vici.flow.daily-goal.v1';

const isDailyGoalState = (value: unknown): value is DailyGoalState =>
	nonNullish(value) &&
	// Reject NaN / Infinity / negatives: a corrupt or hand-edited
	// count must not propagate through `rolloverDailyGoal` and defeat
	// the `>= DAILY_HARD_CAP` gate.
	Number.isFinite((value as DailyGoalState).done) &&
	(value as DailyGoalState).done >= 0 &&
	typeof (value as DailyGoalState).date === 'string';

/** Read the localStorage mirror, or `undefined` when absent / malformed. */
export const readDailyGoalMirror = (): DailyGoalState | undefined => {
	const raw = storageGet<DailyGoalState>({ key: DAILY_GOAL_STORAGE_KEY });

	return isDailyGoalState(raw) ? raw : undefined;
};

/** Write the localStorage mirror. Best-effort (see `storage.utils`). */
export const writeDailyGoalMirror = (state: DailyGoalState): void => {
	storageSet({ key: DAILY_GOAL_STORAGE_KEY, value: state });
};

/** Drop the localStorage mirror. See `reconcileIdentityScopedStorage`. */
export const clearDailyGoalMirror = (): void => {
	storageDel({ key: DAILY_GOAL_STORAGE_KEY });
};

/**
 * Effective daily-goal state on Flow entry: the HIGHER of the hydrated
 * server count and the localStorage mirror, both rolled over to today.
 *
 * The server count (set by `recordFlowSwipe`) is authoritative, but a
 * fast-swiping session may leave Flow with per-swipe records still in
 * flight, so the freshly-read profile can lag the optimistic mirror. Taking
 * the max closes that window: on re-entry the count never reads below what
 * the user already committed, so the daily hard cap can't be re-opened by
 * bouncing in and out of Flow.
 *
 * `max` only ever RAISES the count, so it still can't reset the cap: a
 * cleared client has no mirror and falls back to the server value; a
 * hand-edited lower mirror is ignored in favour of the higher server value;
 * a stale-day mirror rolls over to 0 and drops out. When neither source has
 * a today-count the result is 0 (a genuine fresh day).
 *
 * The reconciled count is written back to the mirror only when it advances
 * it, so a later entry without a hydrated profile still gates on the
 * freshest known count. Reads and (conditionally) writes the mirror.
 */
export const reconcileDailyGoalOnEntry = ({
	done,
	date,
	now = new Date()
}: {
	done: number;
	date?: string;
	now?: Date;
}): { done: number; date: string | undefined } => {
	const mirror = readDailyGoalMirror();
	const profileDone = rolloverDailyGoal({ done, date, now });
	const mirrorDone = nonNullish(mirror)
		? rolloverDailyGoal({ done: mirror.done, date: mirror.date, now })
		: 0;
	const best = Math.max(profileDone, mirrorDone);
	const today = todayKey(now);

	if (best > 0 && best !== mirrorDone) {
		writeDailyGoalMirror({ done: best, date: today });
	}

	return { done: best, date: best > 0 ? today : date };
};
