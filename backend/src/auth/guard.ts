// Session guards. `requireUser` resolves the caller from the session cookie;
// `requireAdmin` checks that user's server-side role column. Routes
// answer 401/403 through the helpers below so the bodies stay uniform.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { readCookie, SESSION_COOKIE } from '../lib/cookie';
import { peppered } from '../lib/crypto';

export type Role = 'user' | 'admin';

export interface AuthedUser {
	id: string;
	role: Role;
}

/** The signed-in user, or null when the request carries no valid session. */
export const requireUser = async (request: Request): Promise<AuthedUser | null> => {
	const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);

	if (isNullish(token) || token === '') {
		return null;
	}

	const rows = await query<{ id: string; role: Role }>(
		`select u.id, u.role
		 from sessions s
		 join users u on u.id = s.user_id
		 where s.id = $1 and s.expires_at > now()
		 limit 1`,
		[peppered(token)]
	);

	return rows[0] ?? null;
};

/** The user `requireUser` resolved when it holds the admin role, or null (403); the session is read once. */
export const requireAdmin = (user: AuthedUser): AuthedUser | null =>
	user.role === 'admin' ? user : null;

interface StatusContext {
	status?: number | string;
}

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
