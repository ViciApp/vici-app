import type { RegistryDid } from '#declarations';
import {
	addGroupAdmins as addGroupAdminsApi,
	addGroupMembers as addGroupMembersApi,
	createGroup as createGroupApi,
	deleteGroup as deleteGroupApi,
	getGroup as getGroupApi,
	listGroups as listGroupsApi,
	removeGroupAdmins as removeGroupAdminsApi,
	removeGroupMembers as removeGroupMembersApi,
	updateGroup as updateGroupApi,
	updateTradingAccess as updateTradingAccessApi
} from '#lib/api/registry.api.ts';
import { ROLE_PERMISSIONS } from '#lib/constants/authz.constants.ts';
import { Permission } from '#lib/enums/permission.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import { getProfile } from '#lib/services/profile.services.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { PrincipalText } from '@junobuild/schema';

const assertPermission = async (permission: Permission): Promise<void> => {
	const identity = await safeGetIdentityOnce();
	const profile = await getProfile(identity.getPrincipal().toText());
	const { role } = profile.data;

	if (isNullish(role)) {
		throw new Error(`Unauthorized: missing ${permission} permission`);
	}

	const permissions = ROLE_PERMISSIONS[role] ?? [];

	if (!permissions.includes(permission)) {
		throw new Error(`Unauthorized: missing ${permission} permission`);
	}
};

export const createGroup = async ({
	name,
	description,
	iconUrl
}: {
	name: string;
	description?: string;
	iconUrl?: string;
}): Promise<string> => {
	const identity = await safeGetIdentityOnce();

	return await createGroupApi({
		identity,
		params: {
			name,
			description: description ? [description] : [],
			icon_url: iconUrl ? [iconUrl] : []
		}
	});
};

// Encodes a clearable update field (`opt opt text`): `undefined` leaves the
// field unchanged (`[]`), an explicit `null` clears it (`[[]]`). The two
// nullish values carry different meanings here, which `isNullish` cannot
// express, hence the direct comparison.
const toClearableUpdate = (value: string | null | undefined): [] | [[] | [string]] => {
	// eslint-disable-next-line no-restricted-syntax
	if (value === undefined) {
		return [];
	}

	return isNullish(value) ? [[]] : [[value]];
};

export const updateGroup = async ({
	groupId,
	name,
	description,
	iconUrl
}: {
	groupId: string;
	name?: string;
	description?: string | null;
	iconUrl?: string | null;
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	return await updateGroupApi({
		identity,
		params: {
			group_id: groupId,
			name: nonNullish(name) ? [name] : [],
			description: toClearableUpdate(description),
			icon_url: toClearableUpdate(iconUrl)
		}
	});
};

export const addGroupAdmins = async ({
	groupId,
	principals
}: {
	groupId: string;
	principals: PrincipalText[];
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	return await addGroupAdminsApi({
		identity,
		params: {
			group_id: groupId,
			principals: principals.map((p) => Principal.fromText(p))
		}
	});
};

export const removeGroupAdmins = async ({
	groupId,
	principals
}: {
	groupId: string;
	principals: PrincipalText[];
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	return await removeGroupAdminsApi({
		identity,
		params: {
			group_id: groupId,
			principals: principals.map((p) => Principal.fromText(p))
		}
	});
};

export const addGroupMembers = async ({
	groupId,
	principals
}: {
	groupId: string;
	principals: PrincipalText[];
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	return await addGroupMembersApi({
		identity,
		params: {
			group_id: groupId,
			principals: principals.map((p) => Principal.fromText(p))
		}
	});
};

export const removeGroupMembers = async ({
	groupId,
	principals
}: {
	groupId: string;
	principals: PrincipalText[];
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	return await removeGroupMembersApi({
		identity,
		params: {
			group_id: groupId,
			principals: principals.map((p) => Principal.fromText(p))
		}
	});
};

export const getGroup = async (groupId: string): Promise<RegistryDid.Group | undefined> => {
	const identity = await safeGetIdentityOnce();

	return await getGroupApi({ identity, groupId, certified: true });
};

export const listGroups = async (creator?: PrincipalText): Promise<RegistryDid.Group[]> => {
	const identity = await safeGetIdentityOnce();

	return await listGroupsApi({ identity, creator, certified: true });
};

export const deleteGroup = async (groupId: string): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	return await deleteGroupApi({ identity, groupId });
};

export const updateTradingAccess = async ({
	seriesId,
	tradingAccess
}: {
	seriesId: string;
	tradingAccess: RegistryDid.TradingAccess[];
}): Promise<void> => {
	await assertPermission(Permission.MANAGE_TRADING_ACCESS);

	const identity = await safeGetIdentityOnce();

	return await updateTradingAccessApi({
		identity,
		params: {
			series_id: seriesId,
			trading_access: tradingAccess
		}
	});
};

export const syncGroupAdminsAfterUnfriend = async ({
	userA,
	userB
}: {
	userA: PrincipalText;
	userB: PrincipalText;
}): Promise<void> => {
	const removeFromAdminsIfPresent = async ({
		groups,
		adminToRemove
	}: {
		groups: RegistryDid.Group[];
		adminToRemove: PrincipalText;
	}): Promise<void> => {
		await Promise.all(
			groups
				.filter((group) => group.admins.some((a) => a.toText() === adminToRemove))
				.map((group) => removeGroupAdmins({ groupId: group.group_id, principals: [adminToRemove] }))
		);
	};

	try {
		const [groupsA, groupsB] = await Promise.all([listGroups(userA), listGroups(userB)]);

		await Promise.all([
			removeFromAdminsIfPresent({ groups: groupsA, adminToRemove: userB }),
			removeFromAdminsIfPresent({ groups: groupsB, adminToRemove: userA })
		]);
	} catch (e: unknown) {
		console.error('Failed to sync group admins after unfriend', e);
	}
};
