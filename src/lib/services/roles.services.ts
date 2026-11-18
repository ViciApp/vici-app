import { Collection } from '#lib/constants/collections.constants.ts';
import type { UserRole } from '#lib/enums/user.ts';
import { getProfile } from '#lib/services/profile.services.ts';
import { deleteDoc, getDoc, listDocs, setDoc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Juno document payload for the roles collection.
 */
export interface RoleDoc {
	role: UserRole;
}

/**
 * Principal paired with assigned role for admin UIs.
 */
export interface UserRoleEntry {
	principal: PrincipalText;
	role: UserRole;
	nickname?: string;
}

/**
 * Lists all role assignments from Juno, enriched with profile nicknames.
 */
export const listRoles = async (): Promise<UserRoleEntry[]> => {
	const { items } = await listDocs<RoleDoc>({
		collection: Collection.ROLES
	});

	const entries = await Promise.all(
		items.map(async (doc) => {
			const entry: UserRoleEntry = {
				principal: doc.key,
				role: doc.data.role
			};

			try {
				const profile = await getProfile(doc.key);
				entry.nickname = profile.data.nickname;
			} catch {
				// Best-effort enrichment; fall back to bare principal on lookup failure.
			}

			return entry;
		})
	);

	return entries;
};

/**
 * Assigns or updates a user's role (throws if unchanged duplicate).
 */
export const setRole = async ({
	principal,
	role
}: {
	principal: PrincipalText;
	role: UserRole;
}): Promise<void> => {
	const existingDoc = await getDoc<RoleDoc>({
		collection: Collection.ROLES,
		key: principal
	});

	if (existingDoc?.data.role === role) {
		throw new Error(`User already has the role: ${role}`);
	}

	await setDoc({
		collection: Collection.ROLES,
		doc: {
			key: principal,
			data: {
				role
			},
			...(existingDoc && { version: existingDoc.version })
		}
	});
};

export const removeRole = async (principal: PrincipalText): Promise<void> => {
	const existingDoc = await getDoc<RoleDoc>({
		collection: Collection.ROLES,
		key: principal
	});

	if (!existingDoc) {
		throw new Error('User does not have a set role');
	}

	await deleteDoc({
		collection: Collection.ROLES,
		doc: existingDoc
	});
};
