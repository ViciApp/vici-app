// Server-recorded activity days: the UTC calendar days on which a user made an
// executed fill (dated by the engine's fill timestamp) or a Flow swipe the API
// recorded (dated by the server clock). The daily streak and the comeback
// absence the economy pays on are derived from these rows only, never from the
// profile's client-written dailyStreak or lastActiveDay.

import { isNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';
import { dayKeyFromMs } from '../lib/time';
import { daysBetween } from './comeback';
import { STREAK_MAX_CONTINUING_DAY_DELTA } from './constants';

/**
 * Upserts the given day keys for the user and answers the ones this call
 * recorded for the first time. The primary key makes it idempotent: a replay
 * records nothing and answers an empty list.
 */
export const recordActivityDays = async (
	{ userId, dayKeys }: { userId: string; dayKeys: readonly string[] },
	q: TxQuery = query
): Promise<string[]> => {
	if (dayKeys.length === 0) {
		return [];
	}

	const rows = await q<{ day_key: string }>(
		`insert into activity_days (user_id, day_key)
		 select $1, day_key from unnest($2::text[]) as day_key
		 on conflict (user_id, day_key) do nothing
		 returning day_key`,
		[userId, [...new Set(dayKeys)]]
	);

	return rows.map(({ day_key }) => day_key);
};

/** Records the current server day; answers it when it was new, else nothing. */
export const recordActivityToday = async ({ userId }: { userId: string }): Promise<string[]> =>
	await recordActivityDays({ userId, dayKeys: [dayKeyFromMs(Date.now())] });

/** Every recorded activity day of the user, oldest first. */
export const listActivityDays = async ({ userId }: { userId: string }): Promise<string[]> => {
	const rows = await query<{ day_key: string }>(
		`select day_key from activity_days where user_id = $1 order by day_key`,
		[userId]
	);

	return rows.map(({ day_key }) => day_key);
};

/**
 * The daily streak as of the latest recorded day: the run of active days
 * ending there in which no two neighbours are further apart than the
 * forgiveness window. Each active day counts once, the same rule as the app's
 * streak engine. Zero with no recorded day.
 */
export const dailyStreakOf = (sortedDayKeys: readonly string[]): number => {
	let streak = 0;

	for (let i = sortedDayKeys.length - 1; i >= 0; i--) {
		streak += 1;

		const day = sortedDayKeys[i] ?? '';
		const previous = sortedDayKeys[i - 1];

		if (isNullish(previous)) {
			break;
		}

		const gap = daysBetween({ fromDay: previous, toDay: day });

		if (isNullish(gap) || gap > STREAK_MAX_CONTINUING_DAY_DELTA) {
			break;
		}
	}

	return streak;
};
