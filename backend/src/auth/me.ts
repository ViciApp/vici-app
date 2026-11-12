// The `/auth/me` read model.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';

interface MeIdentity {
	provider: string;
	email: string | null;
}

interface MeUser {
	id: string;
	role: string;
	displayName: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

/** The signed-in user as `GET /auth/me` answers it: the user row, its linked
 * sign-in identities and its adopted legacy principals; null when the user row
 * is gone. */
export const loadMe = async (userId: string): Promise<Record<string, unknown> | null> => {
	const users = await query<{
		id: string;
		role: string;
		display_name: string | null;
		avatar_url: string | null;
		created_at: Date;
	}>(`select id, role, display_name, avatar_url, created_at from users where id = $1`, [userId]);
	const [user] = users;

	if (isNullish(user)) {
		return null;
	}

	const identities = await query<{ provider: string; email: string | null }>(
		`select provider, email from auth_identities where user_id = $1 order by created_at`,
		[userId]
	);
	const principals = await query<{ principal: string; matched_via: string }>(
		`select principal, matched_via from legacy_principals where user_id = $1 order by linked_at`,
		[userId]
	);

	const shaped: MeUser = {
		id: user.id,
		role: user.role,
		displayName: user.display_name,
		avatarUrl: user.avatar_url,
		createdAt: user.created_at.toISOString()
	};

	return {
		...shaped,
		identities: identities satisfies MeIdentity[],
		legacyPrincipals: principals.map((p) => ({ principal: p.principal, matchedVia: p.matched_via }))
	};
};
