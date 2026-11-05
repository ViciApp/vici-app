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
import { getIdentity, safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import { getProfile } from '#lib/services/profile.services.ts';
import { loadWithCertification } from '#lib/services/query-update.services.ts';
import { getFollowers, getFriends } from '#lib/services/relation-queries.services.ts';
import type { RegistryDid } from '$declarations';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
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
// express — hence the direct comparison.
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

/**
 * Callback-based variant of {@link getGroup}. Delivers `onLoad` twice —
 * uncertified query first, certified update second. No-op when the user is not
 * signed in (mirrors `safeGetIdentityOnce` auth gating without throwing).
 */
export const loadGroup = async ({
	groupId,
	onLoad,
	onUpdateError
}: {
	groupId: string;
	onLoad: (options: { certified: boolean; response: RegistryDid.Group | undefined }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<RegistryDid.Group | undefined>({
		identity,
		request: ({ certified, identity: reqIdentity }: { certified: boolean; identity: Identity }) =>
			getGroupApi({ identity: reqIdentity, groupId, certified }),
		onLoad,
		onUpdateError
	});
};

export const listGroups = async (creator?: PrincipalText): Promise<RegistryDid.Group[]> => {
	const identity = await safeGetIdentityOnce();

	return await listGroupsApi({ identity, creator, certified: true });
};

/**
 * Callback-based variant of {@link listGroups}. No-op when the user is not
 * signed in.
 */
export const loadGroups = async ({
	creator,
	onLoad,
	onUpdateError
}: {
	creator?: PrincipalText;
	onLoad: (options: { certified: boolean; response: RegistryDid.Group[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<RegistryDid.Group[]>({
		identity,
		request: ({ certified, identity: reqIdentity }: { certified: boolean; identity: Identity }) =>
			listGroupsApi({ identity: reqIdentity, creator, certified }),
		onLoad,
		onUpdateError
	});
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

export const getOrCreateFriendsGroup = async (): Promise<string> => {
	const identity = await safeGetIdentityOnce();
	const principal = identity.getPrincipal().toText();

	const allGroups = await listGroups(principal);
	const existingFriendsGroup = allGroups.find((g) => g.name === 'My Friends');
	const friendsGroup =
		existingFriendsGroup ??
		(await getGroup(
			await createGroup({
				name: 'My Friends',
				description: 'A private circle for my friends.'
			})
		));

	if (!friendsGroup) {
		throw new Error('Failed to retrieve friends group after creation');
	}

	const activeFriends = await getFriends();
	const friendPrincipals = activeFriends
		.map((f) => f.participants.find((p) => p !== principal))
		.filter((p): p is PrincipalText => nonNullish(p));

	const currentMembers = friendsGroup.members.map((m) => m.toText());
	const missingMembers = friendPrincipals.filter((p) => !currentMembers.includes(p));

	if (missingMembers.length > 0) {
		await addGroupMembers({ groupId: friendsGroup.group_id, principals: missingMembers });
	}

	return friendsGroup.group_id;
};

export const getOrCreateFollowersGroup = async (): Promise<string> => {
	const identity = await safeGetIdentityOnce();
	const principal = identity.getPrincipal().toText();

	const allGroups = await listGroups(principal);
	const existingFollowersGroup = allGroups.find((g) => g.name === 'My Followers');
	const followersGroup =
		existingFollowersGroup ??
		(await getGroup(
			await createGroup({
				name: 'My Followers',
				description: 'A private circle for the people who follow me.'
			})
		));

	if (!followersGroup) {
		throw new Error('Failed to retrieve followers group after creation');
	}

	const followerPrincipals = await getFollowers();

	const currentMembers = followersGroup.members.map((m) => m.toText());
	const missingMembers = followerPrincipals.filter((p) => !currentMembers.includes(p));

	if (missingMembers.length > 0) {
		await addGroupMembers({ groupId: followersGroup.group_id, principals: missingMembers });
	}

	return followersGroup.group_id;
};
