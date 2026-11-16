import type { RegistryDid } from '#declarations';
import {
	listGroups as listGroupsApi,
	removeGroupAdmins as removeGroupAdminsApi
} from '#lib/api/registry.api.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { PrincipalText } from '@junobuild/schema';

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

export const listGroups = async (creator?: PrincipalText): Promise<RegistryDid.Group[]> => {
	const identity = await safeGetIdentityOnce();

	return await listGroupsApi({ identity, creator, certified: true });
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
