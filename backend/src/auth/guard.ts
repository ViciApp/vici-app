// Session guards. `requireUser` resolves the caller from the session cookie;
// `requireAdmin` checks that user's server-side role column. Routes
// answer 401/403 through the helpers below so the bodies stay uniform.

import { isNullish } from '@dfinity/utils';
import type { GrantableRole } from '../admin/engine-sync';
import { query } from '../db/client';
import { readCookie, SESSION_COOKIE } from '../lib/cookie';
import { peppered } from '../lib/crypto';
import type { StatusContext } from '../lib/http';
import { teamSessionParams } from './team-gate';

export type Role = 'user' | GrantableRole;

export interface AuthedUser {
	id: string;
	role: Role;
}

/** The signed-in user, or null when the request carries no valid session.
 * The hard delete revokes every session, but a sign-in racing the purge can
 * still mint one after it commits, so a hard-deleted account never resolves.
 * While team-only sign-in is enforced, an account with no allowlisted
 * sign-in email never resolves either; its sessions are left to expire, so
 * re-listing the address restores them. */
export const requireUser = async (request: Request): Promise<AuthedUser | null> => {
	const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);

	if (isNullish(token) || token === '') {
		return null;
	}

	const team = teamSessionParams();
	const rows = await query<{ id: string; role: Role }>(
		`select u.id, u.role
		 from sessions s
		 join users u on u.id = s.user_id and u.hard_deleted_at is null
		 where s.id = $1 and s.expires_at > now()
		   and (
		     not $2::boolean
		     or exists (
		       select 1 from auth_identities ai
		       where ai.user_id = u.id
		         and (
		           lower(ai.email) = any($3::text[])
		           or split_part(lower(ai.email), '@', 2) = any($4::text[])
		         )
		     )
		   )
		 limit 1`,
		[peppered(token), team.enforced, team.emails, team.domains]
	);

	return rows[0] ?? null;
};

/** The user `requireUser` resolved when it holds the admin role, or null (403); the session is read once. */
export const requireAdmin = (user: AuthedUser): AuthedUser | null =>
	user.role === 'admin' ? user : null;

/** Standard 401 body; `set.status` is mutated as a side effect. */
export const unauthenticated = (set: StatusContext): { error: string } => {
	set.status = 401;

	return { error: 'unauthenticated' };
};

/** Standard 403 body; `set.status` is mutated as a side effect. */
export const forbidden = (set: StatusContext): { error: string } => {
	set.status = 403;

	return { error: 'forbidden' };
};
