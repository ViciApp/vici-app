/**
 * Churn-feedback log written when a user deletes their account.
 *
 * The delete-account flow asks the leaving user to pick
 * one of six reasons and optionally leave a short note. We persist
 * those signals so the team can read churn trends without keeping
 * any handle on who left: the doc has **no principal field** and
 * its key is a random UUID, so the row outlives the account that
 * generated it while staying unlinkable.
 *
 * Doc lifecycle:
 *  - Written exactly once by `deleteMyAccount` before the cascade
 *    hard-deletes the caller's profile + identity-keyed rows.
 *  - Never edited (the assert rejects writes when `current` is
 *    non-null).
 *  - Never deleted (no delete assert handler: admin-only via
 *    direct console access if a future privacy request lands).
 */

/**
 * The six reason buckets the FE picker exposes. Kept in lockstep
 * with the picker labels so the catalog a future analytics
 * consumer reads agrees with what the user saw.
 */
export const EXIT_SIGNAL_REASONS = [
	'not-for-me',
	'too-busy',
	'privacy',
	'duplicate',
	'bugs',
	'other'
] as const;

export type ExitSignalReason = (typeof EXIT_SIGNAL_REASONS)[number];

/**
 * 240-char cap on the optional free-text note. Matches the
 * `maxLength` the picker textarea enforces. Long enough for a
 * Tweet-style explanation; short enough to keep the log payload
 * bounded.
 */
export const EXIT_SIGNAL_NOTE_MAX_LENGTH = 240;

export interface ExitSignalDoc {
	/** Picked from `EXIT_SIGNAL_REASONS`. */
	reason: ExitSignalReason;
	/** Free-text note, capped at {@link EXIT_SIGNAL_NOTE_MAX_LENGTH}. Empty string when none. */
	note: string;
	/** Creation timestamp in ms since epoch. */
	createdAtMs: number;
}
