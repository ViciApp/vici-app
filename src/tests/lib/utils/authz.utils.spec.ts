import { SATELLITE_CONTROLLERS } from '#lib/constants/controllers.constants.ts';
import { Permission } from '#lib/enums/permission.ts';
import { UserRole } from '#lib/enums/user.ts';
import { roleHasPermission, userRoleOf } from '#lib/utils/authz.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const [CONTROLLER] = SATELLITE_CONTROLLERS;
const USER = '2vxsx-fae';

describe('userRoleOf', () => {
	it('gives a satellite controller the controller role whatever its profile says', () => {
		assert.equal(
			userRoleOf({ principal: CONTROLLER, profileRole: undefined }),
			UserRole.CONTROLLER
		);
		assert.equal(
			userRoleOf({ principal: CONTROLLER, profileRole: UserRole.CREATOR }),
			UserRole.CONTROLLER
		);
	});

	it('gives any other principal its profile role', () => {
		assert.equal(userRoleOf({ principal: USER, profileRole: UserRole.SOLVER }), UserRole.SOLVER);
		assert.equal(userRoleOf({ principal: USER, profileRole: undefined }), undefined);
		assert.equal(userRoleOf({ principal: undefined, profileRole: UserRole.ADMIN }), UserRole.ADMIN);
	});
});

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
