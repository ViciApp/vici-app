import { Collection } from '#lib/constants/collections.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteRole } from '#satellite/services/roles.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const admin = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const user = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const removeAdminRole = (caller: Principal) =>
	deleteContext({
		caller,
		collection: Collection.ROLES,
		key: admin.toText(),
		current: { role: UserRole.ADMIN },
		currentOwner: admin
	});

describe('roles.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost({
			docs: { [Collection.ROLES]: { [admin.toText()]: { role: UserRole.ADMIN } } }
		});
	});

	afterEach(() => host.restore());

	describe('assertDeleteRole', () => {
		it("rejects a non-admin deleting an admin's role", () => {
			assert.throws(() => assertDeleteRole(removeAdminRole(user)), /Only admins can remove roles/);
		});

		it('lets an admin or a satellite controller remove a role', () => {
			assert.doesNotThrow(() => assertDeleteRole(removeAdminRole(admin)));
			assert.doesNotThrow(() => assertDeleteRole(removeAdminRole(controller)));
		});
	});
});
