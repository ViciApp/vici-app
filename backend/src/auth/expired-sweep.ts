// Retention cleanup for sign-in rows that can never be used again: expired
// sessions and expired one-time codes. Neither is read once past its expiry
// (the guard and the OTP flow both filter on `expires_at > now()`), and
// nothing else removes them: a session row is deleted only on logout,
// rotation or an account-wide revoke, and a code only when its address
// verifies or requests again. Codes burnt by a successful verify are already
// gone; a locked code is left alone until it expires, because it still
// counts towards its address's live-code cap.

import { query } from '../db/client';
import { DAY_IN_MS } from '../lib/time';

/** How long a row stays past its expiry before the sweep removes it. A day
 * keeps a sign-in problem reported today traceable in the tables, and keeps
 * the sweep well clear of a request that read the row just before it
 * expired. */
export const EXPIRED_AUTH_ROW_RETENTION_MS = DAY_IN_MS;

/** Rows deleted per table per sweep, so one pass stays a short statement
 * however large a backlog has grown; the rest goes on the next pass. */
export const EXPIRED_AUTH_ROW_SWEEP_LIMIT = 5_000;

type ExpiringAuthTable = 'sessions' | 'otp_codes';

const deleteExpiredBatch = async ({
	table,
	cutoff,
	limit
}: {
	table: ExpiringAuthTable;
	cutoff: Date;
	limit: number;
}): Promise<number> => {
	const rows = await query<{ id: string }>(
		`delete from ${table} where id in (
		   select id from ${table} where expires_at <= $1 limit $2 for update skip locked
		 ) returning id`,
		[cutoff, limit]
	);

	return rows.length;
};

/**
 * Deletes at most `limit` sessions and `limit` one-time codes whose expiry is
 * older than {@link EXPIRED_AUTH_ROW_RETENTION_MS}. Idempotent: a deleted row
 * is gone, so a re-run only finds rows that expired since.
 */
export const sweepExpiredAuthRows = async ({
	limit = EXPIRED_AUTH_ROW_SWEEP_LIMIT
}: { limit?: number } = {}): Promise<{ sessions: number; otpCodes: number }> => {
	const cutoff = new Date(Date.now() - EXPIRED_AUTH_ROW_RETENTION_MS);

	const sessions = await deleteExpiredBatch({ table: 'sessions', cutoff, limit });
	const otpCodes = await deleteExpiredBatch({ table: 'otp_codes', cutoff, limit });

	return { sessions, otpCodes };
};
