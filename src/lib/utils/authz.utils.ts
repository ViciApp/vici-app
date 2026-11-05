import { ROLE_PERMISSIONS } from '#lib/constants/authz.constants.ts';
import type { Permission } from '#lib/enums/permission.ts';
import type { UserRole } from '#lib/enums/user.ts';
import { isNullish } from '@dfinity/utils';

export const hasPermission = ({
	role,
	permission
}: {
	role: UserRole | undefined;
	permission: Permission;
}): boolean => {
	if (isNullish(role)) {
		return false;
	}

	return ROLE_PERMISSIONS[role].includes(permission);
};
