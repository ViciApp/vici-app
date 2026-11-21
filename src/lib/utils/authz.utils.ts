import { ROLE_PERMISSIONS } from '#lib/constants/authz.constants.ts';
import { SATELLITE_CONTROLLERS } from '#lib/constants/controllers.constants.ts';
import type { Permission } from '#lib/enums/permission.ts';
import { UserRole } from '#lib/enums/user.ts';
import { nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@junobuild/schema';

/**
 * A satellite controller holds no grantable role doc, so its controller status
 * wins over whatever its profile carries; everyone else gets the profile role.
 */
export const userRoleOf = ({
	principal,
	profileRole
}: {
	principal: PrincipalText | undefined;
	profileRole: UserRole | undefined;
}): UserRole | undefined =>
	nonNullish(principal) && SATELLITE_CONTROLLERS.includes(principal)
		? UserRole.CONTROLLER
		: profileRole;

export const roleHasPermission = ({
	role,
	permission
}: {
	role: UserRole | undefined;
	permission: Permission;
}): boolean => nonNullish(role) && ROLE_PERMISSIONS[role].includes(permission);
