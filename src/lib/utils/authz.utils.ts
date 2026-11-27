import { ROLE_PERMISSIONS } from '#lib/constants/authz.constants.ts';
import type { Permission } from '#lib/enums/permission.ts';
import type { UserRole } from '#lib/enums/user.ts';
import { nonNullish } from '@dfinity/utils';

export const roleHasPermission = ({
	role,
	permission
}: {
	role: UserRole | undefined;
	permission: Permission;
}): boolean => nonNullish(role) && ROLE_PERMISSIONS[role].includes(permission);
