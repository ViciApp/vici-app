// Nickname (= handle) rules. The STORED value keeps the owner's form: case
// and accents preserved. Allowed charset: letters (any language) + digits +
// '. _ -'; everything else (whitespace, '@', symbols, emoji) is forbidden.
// Uniqueness is case- AND accent-insensitive via the fold below. The server
// is the authority; the client mirrors these rules for inline hints.

import { isNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';
import { DAY_IN_MS, MINUTE_IN_MS } from '../lib/time';

export const MIN_NICKNAME_LENGTH = 2;
export const MAX_NICKNAME_LENGTH = 16;

/** Validates the stored charset (letters + digits + '. _ -'). */
export const NICKNAME_PATTERN = new RegExp('^[\\p{L}\\p{M}0-9._-]+$', 'u');

/**
 * Case- + accent-insensitive uniqueness key: 'Jose' with an accent, 'JOSE'
 * and 'jose' all fold to 'jose'. Trim, NFKD, strip combining marks,
 * lowercase. Separators '. _ -' are kept ('a_b' stays distinct from 'ab').
 * Used for collisions AND handle-change detection so both sides agree on
 * "the same handle".
 */
const COMBINING_DIACRITICAL_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export const nicknameUniqueKey = (raw: string): string =>
	raw.trim().normalize('NFKD').replace(COMBINING_DIACRITICAL_MARKS, '').toLowerCase();

/**
 * A handle can be changed once every {@link HANDLE_COOLDOWN_DAYS} days. The
 * profile carries a handle_last_change_ms stamp; the profile write guard
 * rejects a handle change while the stored value is inside the window and
 * requires the stamp to move to ~now on an allowed change.
 */
export const HANDLE_COOLDOWN_DAYS = 30;

/**
 * Tolerance (ms) for the "is handle_last_change_ms set to ~now?" check on an
 * allowed handle change. The client stamps its wall clock before the update
 * is submitted, so by validation time the value is slightly in the past;
 * allow a small slack on both sides (clock skew + request latency) but
 * reject values that are clearly stale or in the future, so a client cannot
 * backdate the stamp and dodge the cooldown.
 */
export const HANDLE_LAST_CHANGE_TOLERANCE_MS = 5 * MINUTE_IN_MS;

/**
 * Whole days the owner must still wait before the handle can change again.
 * Returns 0 when the cooldown has elapsed or no prior change is on record.
 * A stamp skewed slightly into the future yields a negative day delta, so
 * the result is clamped to the full window as the hard ceiling.
 */
export const handleCooldownDaysLeft = ({
	lastChangeMs,
	nowMs
}: {
	lastChangeMs: number | undefined | null;
	nowMs: number;
}): number => {
	if (isNullish(lastChangeMs) || lastChangeMs <= 0) {
		return 0;
	}

	const daysSince = Math.floor((nowMs - lastChangeMs) / DAY_IN_MS);

	if (daysSince >= HANDLE_COOLDOWN_DAYS) {
		return 0;
	}

	return Math.min(HANDLE_COOLDOWN_DAYS, HANDLE_COOLDOWN_DAYS - daysSince);
};

/**
 * Outcome of a nickname validity + uniqueness check. `reason` is set only
 * when `available` is false:
 * - required: empty / whitespace.
 * - too_short: under {@link MIN_NICKNAME_LENGTH}.
 * - too_long: over {@link MAX_NICKNAME_LENGTH}.
 * - invalid: contains characters outside {@link NICKNAME_PATTERN}.
 * - taken: another user already owns this nickname (on the fold).
 */
export type NicknameAvailability =
	| { available: true }
	| { available: false; reason: 'required' | 'too_short' | 'too_long' | 'invalid' | 'taken' };

/**
 * Shared nickname validator. Used by both the profile write guard and the
 * availability probe, so the UI and the server always agree on what "taken"
 * means. `excludeUserId` is the editing user, passed so their own current
 * nickname does not count as a conflict.
 */
export const checkNicknameAvailability = async ({
	nickname,
	excludeUserId,
	q = query
}: {
	nickname: string | undefined | null;
	excludeUserId?: string;
	q?: TxQuery;
}): Promise<NicknameAvailability> => {
	if (isNullish(nickname) || nickname.trim() === '') {
		return { available: false, reason: 'required' };
	}

	const trimmedNickname = nickname.trim();

	if (trimmedNickname.length < MIN_NICKNAME_LENGTH) {
		return { available: false, reason: 'too_short' };
	}

	if (trimmedNickname.length > MAX_NICKNAME_LENGTH) {
		return { available: false, reason: 'too_long' };
	}

	// Charset guard tested on the RAW value (the stored one), not the trimmed
	// one, so surrounding whitespace is rejected too.
	if (!NICKNAME_PATTERN.test(nickname)) {
		return { available: false, reason: 'invalid' };
	}

	const proposedKey = nicknameUniqueKey(nickname);

	const rows = await q<{ exists: boolean }>(
		`select exists (
		   select 1 from profiles
		   where nickname_key = $1 and ($2::uuid is null or user_id <> $2::uuid)
		 ) as exists`,
		[proposedKey, excludeUserId ?? null]
	);

	if (rows[0]?.exists === true) {
		return { available: false, reason: 'taken' };
	}

	return { available: true };
};
