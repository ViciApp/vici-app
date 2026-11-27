import { Permission } from '#lib/enums/permission.ts';
import { UserRole } from '#lib/enums/user.ts';
import { roleHasPermission } from '#lib/utils/authz.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('roleHasPermission', () => {
	it('lets controllers, admins and solvers resolve markets', () => {
		for (const role of [UserRole.CONTROLLER, UserRole.ADMIN, UserRole.SOLVER]) {
			assert.equal(roleHasPermission({ role, permission: Permission.RESOLVE_MARKET }), true, role);
		}
	});

	it('refuses creators and principals with no role', () => {
		assert.equal(
			roleHasPermission({ role: UserRole.CREATOR, permission: Permission.RESOLVE_MARKET }),
			false
		);
		assert.equal(
			roleHasPermission({ role: undefined, permission: Permission.RESOLVE_MARKET }),
			false
		);
	});
});
