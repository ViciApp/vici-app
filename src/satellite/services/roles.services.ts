import { Collection } from '#lib/constants/collections.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData, getDocStore } from '@junobuild/functions/sdk';

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

	const callerPrincipal = Principal.fromUint8Array(caller).toText();
	const callerDoc = getDocStore({
		collection: Collection.ROLES,
		key: callerPrincipal,
		caller
	});

	if (isNullish(callerDoc)) {
		throw new Error('You do not have permission to set roles.');
	}

	const { role } = decodeDocData<{ role: UserRole }>(callerDoc.data);

	if (role !== UserRole.ADMIN) {
		throw new Error('Only admins can set roles.');
	}

	const { role: newRole } = decodeDocData<{ role: UserRole }>(proposed.data);
	const validRoles = Object.values(UserRole);

	if (!validRoles.includes(newRole)) {
		throw new Error(`Invalid role: ${newRole}`);
	}
};
