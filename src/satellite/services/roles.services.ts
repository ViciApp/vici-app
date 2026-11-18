import { Collection } from '#lib/constants/collections.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import { isAdmin, isControllerText } from '#satellite/services/authz.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

export const assertSetRole = ({
	caller,
	data: {
		collection,
		data: { proposed }
	}
}: AssertSetDocContext) => {
	if (collection !== Collection.ROLES) {
		return;
	}

	if (!isAdmin({ caller: Principal.fromUint8Array(caller) })) {
		throw new Error('Only admins can set roles.');
	}

	const { role: newRole } = decodeDocData<{ role: UserRole }>(proposed.data);
	const validRoles = Object.values(UserRole);

	if (!validRoles.includes(newRole)) {
		throw new Error(`Invalid role: ${newRole}`);
	}
};

/**
 * Removing a role doc revokes that principal's engine roles (the
 * `syncRoleToEngineOnDelete` hook), so it takes the same authority as
 * granting one: an admin, or a satellite controller.
 */
export const assertDeleteRole = ({ caller, data: { collection } }: AssertDeleteDocContext) => {
	if (collection !== Collection.ROLES) {
		return;
	}

	const callerPrincipal = Principal.fromUint8Array(caller);

	if (!isControllerText(callerPrincipal.toText()) && !isAdmin({ caller: callerPrincipal })) {
		throw new Error('Only admins can remove roles.');
	}
};
