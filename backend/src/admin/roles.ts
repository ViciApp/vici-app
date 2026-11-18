// Role administration: the stored role column is the source of truth, and
// every transition is mirrored onto the on-chain engine registry so an
// assignment is enough to both manage and actually act there. The role is
// persisted FIRST and the mirror runs after: a mirror failure surfaces to
// the caller (the stored role stands, matching the original post-write hook
// ordering) and a retry of the same transition re-issues only the missing
// calls thanks to the idempotent engine answers.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { userIcPrincipalText } from '../lib/keys';
import { isGrantableRole, syncRoleToEngine, type GrantableRole } from './engine-sync';

export class RoleError extends Error {}

export interface RoleAssignment {
	userId: string;
	role: GrantableRole;
	principal: string;
}

const readStoredRole = async (userId: string): Promise<string | undefined> => {
	const rows = await query<{ role: string }>(`select role from users where id = $1`, [userId]);

	return rows[0]?.role;
};

const asGrantable = (role: string | undefined): GrantableRole | undefined =>
	isNullish(role) || !isGrantableRole(role) ? undefined : role;

/** Every user holding a role beyond the default, with the engine principal
 * the mirror targets. */
export const listRoleAssignments = async (): Promise<RoleAssignment[]> => {
	const rows = await query<{ id: string; role: string }>(
		`select id, role from users where role <> 'user' order by role, id`
	);

	return rows
		.filter((row): row is { id: string; role: GrantableRole } => isGrantableRole(row.role))
		.map((row) => ({ userId: row.id, role: row.role, principal: userIcPrincipalText(row.id) }));
};

/**
 * Grant (or change) a user's role. Persists the column, then mirrors the
 * transition onto the engine registry with the admin identity.
 */
export const setUserRole = async ({
	userId,
	role
}: {
	userId: string;
	role: GrantableRole;
}): Promise<RoleAssignment> => {
	const prev = await readStoredRole(userId);

	if (isNullish(prev)) {
		throw new RoleError('unknown_user');
	}

	await query(`update users set role = $2 where id = $1`, [userId, role]);

	await syncRoleToEngine({
		principalText: userIcPrincipalText(userId),
		prevRole: asGrantable(prev),
		nextRole: role
	});

	return { userId, role, principal: userIcPrincipalText(userId) };
};

/**
 * Revoke a user's role (back to the default). Mirrors as a full revoke of
 * every engine role the previous assignment mapped to, settler membership
 * included.
 */
export const revokeUserRole = async ({
	userId
}: {
	userId: string;
}): Promise<{ userId: string; revoked: boolean }> => {
	const prev = await readStoredRole(userId);

	if (isNullish(prev)) {
		throw new RoleError('unknown_user');
	}

	const prevGrantable = asGrantable(prev);

	if (isNullish(prevGrantable)) {
		return { userId, revoked: false };
	}

	await query(`update users set role = 'user' where id = $1`, [userId]);

	await syncRoleToEngine({
		principalText: userIcPrincipalText(userId),
		prevRole: prevGrantable,
		nextRole: undefined
	});

	return { userId, revoked: true };
};
