// Server-side session lifecycle. The cookie carries an opaque random token;
// the sessions.id column stores only its HMAC. A session is valid iff it
// exists, is not expired and belongs to an account that was not hard-deleted.

import { isNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';
import { env } from '../env';
import { peppered, randomToken } from '../lib/crypto';
import { HOUR_IN_MS } from '../lib/time';

/** Create a fresh session for a user; returns the plaintext token for the cookie. */
export const createSession = async (userId: string): Promise<string> => {
	const token = randomToken();
	const expiresAt = new Date(Date.now() + env.sessionTtlHours * HOUR_IN_MS);

	await query(`insert into sessions (id, user_id, expires_at) values ($1, $2, $3)`, [
		peppered(token),
		userId,
		expiresAt
	]);

	return token;
};

/** The user id behind a session token, or null if the session is invalid. */
export const userIdForToken = async (token: string): Promise<string | null> => {
	const rows = await query<{ user_id: string }>(
		`select s.user_id from sessions s
		 join users u on u.id = s.user_id and u.hard_deleted_at is null
		 where s.id = $1 and s.expires_at > now()
		 limit 1`,
		[peppered(token)]
	);

	return rows[0]?.user_id ?? null;
};

/** Login rotation: revoke whatever session the request carried (regardless of
 * owner) and issue a fresh token, so a pre-login cookie can never be fixated
 * into an authenticated one. */
export const rotateSession = async ({
	userId,
	previousToken
}: {
	userId: string;
	previousToken: string | null;
}): Promise<string> => {
	if (!isNullish(previousToken)) {
		await revokeToken(previousToken);
	}

	return createSession(userId);
};

/** Revoke a session (logout). Idempotent. */
export const revokeToken = async (token: string): Promise<void> => {
	await query(`delete from sessions where id = $1`, [peppered(token)]);
};

/** Revoke every session of a user (account-wide sign-out). */
export const revokeAllForUser = async (userId: string, q: TxQuery = query): Promise<void> => {
	await q(`delete from sessions where user_id = $1`, [userId]);
};
