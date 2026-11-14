import type { MessageKey } from '#lib/utils/i18n.utils.ts';
import { isNullish } from '@dfinity/utils';

export type FlameStage = 'spark' | 'ember' | 'flame' | 'blaze' | 'inferno';

/**
 * Maps streak day-count to one of the five Flame stages.
 * Thresholds per design system: SPARK 1-2d, EMBER 3-6d, FLAME 7-14d, BLAZE 15-29d, INFERNO 30+d.
 */
export const stageForStreak = (days: number): FlameStage => {
	if (days >= 30) {
		return 'inferno';
	}

	if (days >= 15) {
		return 'blaze';
	}

	if (days >= 7) {
		return 'flame';
	}

	if (days >= 3) {
		return 'ember';
	}

	return 'spark';
};

/**
 * Day-count thresholds at which the flame enters a new stage above SPARK:
 * the milestones worth celebrating. These are the `stageForStreak` stage
 * thresholds (EMBER 3 / FLAME 7 / BLAZE 15 / INFERNO 30), so a milestone card
 * lines up with a visible flame-stage change. (The `streak_N` VXP award ladder
 * is close but not identical; its third tier is `streak_14`, not 15, so the
 * two are deliberately not coupled here.) Ascending.
 */
export const STREAK_MILESTONES = [3, 7, 15, 30] as const;

/**
 * The highest milestone day-count the streak has reached, or 0 while still
 * at SPARK (1–2 days). Used by the inbox streak card to fire once per stage
 * crossing rather than on every advancing day.
 */
export const streakMilestone = (days: number): number => {
	let reached = 0;

	for (const threshold of STREAK_MILESTONES) {
		if (days >= threshold) {
			reached = threshold;
		}
	}

	return reached;
};

export const FLAME_STAGE_LABEL_KEYS: Record<FlameStage, MessageKey> = {
	spark: 'flame.spark',
	ember: 'flame.ember',
	flame: 'flame.flame',
	blaze: 'flame.blaze',
	inferno: 'flame.inferno'
};

/**
 * Local-day key in `YYYY-MM-DD` form (user's local timezone). Used as
 * the persistence anchor for the daily-streak engine.
 */
export const todayKey = (now: Date = new Date()): string => {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');

	return `${y}-${m}-${d}`;
};

/**
 * Day delta between two `YYYY-MM-DD` keys (`to - from`). Returns
 * `Infinity` if either key is malformed: including an out-of-range key
 * (e.g. `2026-02-31`) that `Date.UTC` would otherwise silently normalize
 * to a valid timestamp; the parsed Y/M/D components must round-trip
 * exactly through the resulting UTC date. Used to decide whether the
 * previous recorded day was "today" (no-op), within the forgiveness
 * window (continue: at most one fully-missed day), or "too long ago"
 * (break).
 */
export const dayDelta = ({ from, to }: { from: string; to: string }): number => {
	const parse = (k: string): number | null => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);

		if (!m) {
			return null;
		}

		const [, y, mo, d] = m;
		const year = Number(y);
		const month = Number(mo) - 1;
		const day = Number(d);
		const ts = Date.UTC(year, month, day);

		if (!Number.isFinite(ts)) {
			return null;
		}

		// `Date.UTC` silently normalizes out-of-range components (e.g.
		// `2026-02-31` → 2026-03-03). Reject anything that does not
		// round-trip exactly, so a corrupted key reads as malformed.
		const date = new Date(ts);

		if (
			date.getUTCFullYear() !== year ||
			date.getUTCMonth() !== month ||
			date.getUTCDate() !== day
		) {
			return null;
		}

		return ts;
	};

	const a = parse(from);
	const b = parse(to);

	if (isNullish(a) || isNullish(b)) {
		return Infinity;
	}

	return Math.round((b - a) / (1000 * 60 * 60 * 24));
};

export interface DailyStreakBump {
	// New streak day count after the bump (`>= 1`).
	streak: number;
	// `'continue'`: same day, or the gap since the recorded key is
	// within the forgiveness window (delta <= 2, i.e. at most one
	// fully-missed day), or no record at all → start at SPARK 1.
	// `'break'`: gap of two or more fully-missed days (delta >= 3);
	// previous streak ended, fresh start at SPARK 1 with the break
	// choreography.
	transition: 'continue' | 'break';
	// `true` only on the first swipe of a new local day (the count
	// actually moved). `false` for additional swipes on the same day.
	bumped: boolean;
	// New value to persist as the user's `lastActiveDay`.
	lastActiveDay: string;
}

/**
 * Compute the next daily-streak state from the persisted streak +
 * lastActiveDay and a fresh "now". Stateless: callers (FlowMode,
 * profile sync, etc.) decide when to persist the result.
 *
 * Rules: streak progresses on any swipe (YES / NO / SKIP all count);
 * one fully-missed day is forgiven (the streak still increments), but
 * a gap of two or more fully-missed days resets to SPARK 1 with the
 * break choreography. Flame never goes dark: it returns to SPARK.
 */
export const applyDailyStreakBump = ({
	streak,
	lastActiveDay,
	now = new Date()
}: {
	streak: number;
	lastActiveDay?: string;
	now?: Date;
}): DailyStreakBump => {
	const today = todayKey(now);

	if (isNullish(lastActiveDay) || lastActiveDay === '') {
		return { streak: 1, transition: 'continue', bumped: true, lastActiveDay: today };
	}

	const delta = dayDelta({ from: lastActiveDay, to: today });

	if (delta <= 0) {
		// Same day (or, defensively, clock drift to the past). No
		// further bump, but echo the existing streak / day so callers
		// can branch on `bumped`.
		return {
			streak: Math.max(1, streak),
			transition: 'continue',
			bumped: false,
			lastActiveDay
		};
	}

	if (delta <= 2) {
		// `delta === 1` is a clean consecutive day; `delta === 2` means
		// exactly one fully-missed day, which the forgiveness window lets
		// slide: the streak still increments.
		return {
			streak: Math.max(1, streak) + 1,
			transition: 'continue',
			bumped: true,
			lastActiveDay: today
		};
	}

	// `delta >= 3`: two or more fully-missed days. Beyond the forgiveness
	// window, so the streak breaks; the today-swipe restarts the ladder at
	// SPARK 1 (Flame never goes dark: it returns to SPARK).
	return { streak: 1, transition: 'break', bumped: true, lastActiveDay: today };
};
