// Server-authoritative Flow daily counter. The client never sends a count:
// it sends only its local-day key, which the server uses solely as the
// rollover boundary. The server owns the increment and the hard cap.

import { isNullish } from '@dfinity/utils';
import { tx } from '../db/client';

/**
 * Daily hard cap: the most predictions a single day's Flow can count (the
 * daily-ten goal plus the +5 overtime push). The cross-session "come back
 * tomorrow" takeover fires once the day's running total reaches this.
 */
export const DAILY_HARD_CAP = 15;

/** Typed failure for a swipe from an account with no profile yet. */
export class NoProfileError extends Error {
	constructor() {
		super('Cannot record a Flow swipe: the caller has no profile.');
	}
}

/** Typed failure for a malformed local-day key, so the route can map it to
 * a 400 without matching on the message text. */
export class InvalidDayKeyError extends Error {
	constructor() {
		super('dayKey must be a well-formed YYYY-MM-DD local-day key.');
	}
}

export interface RecordFlowSwipeResult {
	/** The authoritative count of Flow swipes recorded for `dailyGoalDate`. */
	dailyGoalDone: number;
	/** The local-day key (`YYYY-MM-DD`) the count belongs to. */
	dailyGoalDate: string;
	/** `true` once `dailyGoalDone` has reached {@link DAILY_HARD_CAP}. */
	capReached: boolean;
}

/**
 * A `YYYY-MM-DD` local-day key is well-formed iff its parsed components
 * round-trip exactly through a UTC date (so `2026-02-31`, which `Date`
 * would silently normalize to March 3, is rejected). The server has no
 * notion of the caller's timezone, so it does NOT compute the day itself;
 * it accepts the client's local-day key and uses it only as the rollover
 * boundary.
 */
export const isWellFormedDayKey = (key: string): boolean => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);

	if (isNullish(match)) {
		return false;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));

	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
};

/**
 * Authoritative per-swipe daily-counter increment. Reads the caller's own
 * profile row under a lock and either increments the stored count (same
 * day, capped at {@link DAILY_HARD_CAP}) or starts the day fresh at 1 under
 * the new key. A caller with no profile fails fast rather than fabricating
 * an authoritative-shaped count.
 *
 * The overtime VXP mint that fires at the cap on the satellite belongs to
 * the VXP economy phase; the counter semantics here are complete without
 * it.
 */
export const recordFlowSwipe = async ({
	userId,
	dayKey
}: {
	userId: string;
	dayKey: string;
}): Promise<RecordFlowSwipeResult> => {
	if (!isWellFormedDayKey(dayKey)) {
		throw new InvalidDayKeyError();
	}

	return await tx(async (q) => {
		const rows = await q<{ daily_goal_done: number; daily_goal_date: string | null }>(
			`select daily_goal_done, daily_goal_date from profiles where user_id = $1 for update`,
			[userId]
		);
		const [profile] = rows;

		if (isNullish(profile)) {
			throw new NoProfileError();
		}

		// Roll over by the client's local-day key: a stored count for any other
		// day has elapsed, so the new day starts at 0 before this swipe.
		const prevForDay = profile.daily_goal_date === dayKey ? (profile.daily_goal_done ?? 0) : 0;
		const dailyGoalDone = Math.min(DAILY_HARD_CAP, Math.max(0, prevForDay) + 1);

		await q(
			`update profiles
			 set daily_goal_done = $2, daily_goal_date = $3, updated_at = now()
			 where user_id = $1`,
			[userId, dailyGoalDone, dayKey]
		);

		return {
			dailyGoalDone,
			dailyGoalDate: dayKey,
			capReached: dailyGoalDone >= DAILY_HARD_CAP
		};
	});
};
