import { functions } from '#declarations/satellite/satellite.api.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { syncGroupAdminsAfterUnfriend } from '#lib/services/group.services.ts';
import type { FriendRequestOutcome, Relation } from '#lib/types/relation.ts';
import { toRelationId } from '#lib/utils/relation.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	acceptFriendRequest as acceptFriendRequestWeb2,
	cancelFriendRequest as cancelFriendRequestWeb2,
	followUser as followUserWeb2,
	rejectFriendRequest as rejectFriendRequestWeb2,
	searchProfiles as searchProfilesWeb2,
	sendFriendRequest as sendFriendRequestWeb2,
	unfollowUser as unfollowUserWeb2,
	unfriendUser as unfriendUserWeb2
} from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { deleteDoc, getDoc, type Doc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

/** Matches a bare account id (uuid) pasted into the add-friend input, so a web2
 * user can be targeted by id as well as by `@handle`. */
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * web2 counterpart of {@link resolveTargetPrincipal}: the account id is a uuid,
 * not a principal, so there is nothing to parse. Resolve an `@handle` via the
 * nickname search and accept a raw account id as a direct target. Throws the
 * same `not_found` / `self` codes the caller maps to i18n strings.
 */
const resolveTargetUserId = async ({
	input,
	sender
}: {
	input: string;
	sender: PrincipalText;
}): Promise<PrincipalText> => {
	const stripped = input.replace(/^@+/, '').trim();

	if (stripped === '') {
		throw new Error('not_found');
	}

	const normalized = stripped.toLowerCase();
	const items = await searchProfilesWeb2(normalized);
	const match = items.find((p) => p.nickname.trim().toLowerCase() === normalized);

	if (match) {
		if (match.owner === sender) {
			throw new Error('self');
		}

		return match.owner;
	}

	if (ACCOUNT_ID_PATTERN.test(stripped)) {
		if (stripped === sender) {
			throw new Error('self');
		}

		return stripped;
	}

	throw new Error('not_found');
};

/**
 * Resolves the add-friend input to a principal text. The Friends UI accepts
 * either a raw principal or an `@handle` (nickname); the satellite's
 * `sendFriendRequest` only accepts principal text and otherwise traps with
 * "Invalid textual representation of a Principal". So we resolve here before
 * calling through.
 *
 * Throws a typed `Error` with one of these codes on the message; the caller
 * is expected to map them to i18n strings:
 *   - `not_found`: nickname didn't match any profile
 *   - `self`: input resolves to the caller
 */
const resolveTargetPrincipal = async ({
	input,
	sender
}: {
	input: string;
	sender: PrincipalText;
}): Promise<PrincipalText> => {
	const stripped = input.replace(/^@+/, '').trim();

	// An input of just `@` (or whitespace) would otherwise fall through to
	// `searchProfiles({ queryStr: '' })`, which matches every profile in the
	// datastore: a needlessly heavy canister query from one malformed click.
	if (stripped === '') {
		throw new Error('not_found');
	}

	try {
		const asPrincipal = Principal.fromText(stripped).toText();

		if (asPrincipal === sender) {
			throw new Error('self');
		}

		return asPrincipal;
	} catch (err: unknown) {
		if (err instanceof Error && err.message === 'self') {
			throw err;
		}
	}

	const normalized = stripped.toLowerCase();
	const { items } = await functions.searchProfiles({ queryStr: normalized });
	const match = items.find((p) => p.nickname.trim().toLowerCase() === normalized);

	if (!match) {
		throw new Error('not_found');
	}

	if (match.owner === sender) {
		throw new Error('self');
	}

	return match.owner;
};

export const sendFriendRequest = async ({
	target,
	sender
}: {
	target: string;
	sender: PrincipalText;
}): Promise<FriendRequestOutcome> => {
	if (isWeb2Backend()) {
		return sendFriendRequestWeb2(await resolveTargetUserId({ input: target, sender }));
	}

	const resolved = await resolveTargetPrincipal({ input: target, sender });

	return await functions.sendFriendRequest({ target: resolved });
};

export const acceptFriendRequest = async ({
	currentRelation
}: {
	currentRelation: Doc<Relation> | { key: string };
}): Promise<void> => {
	if (isWeb2Backend()) {
		await acceptFriendRequestWeb2(currentRelation.key);

		return;
	}

	await functions.acceptFriendRequest({ relationId: currentRelation.key });
};

export const rejectFriendRequest = async ({
	currentRelation
}: {
	currentRelation: Doc<Relation> | { key: string };
}): Promise<void> => {
	if (isWeb2Backend()) {
		await rejectFriendRequestWeb2(currentRelation.key);

		return;
	}

	await functions.rejectFriendRequest({ relationId: currentRelation.key });
};

/**
 * Cancels a friend request previously sent by the caller. The satellite
 * enforces atomicity via a version-locked delete: if the recipient
 * accepts or rejects between the FE click and the canister write, the
 * cancel traps and the user gets an error; there is no race window
 * where both a cancel and an accept succeed.
 */
export const cancelFriendRequest = async ({
	currentRelation
}: {
	currentRelation: Doc<Relation> | { key: string };
}): Promise<void> => {
	if (isWeb2Backend()) {
		await cancelFriendRequestWeb2(currentRelation.key);

		return;
	}

	await functions.cancelFriendRequest({ relationId: currentRelation.key });
};

/**
 * Removes a friend relation and rebalances group admins so groups don't end up
 * pointing at a no-longer-friend pair.
 */
export const unfriendUser = async (params: {
	sender: PrincipalText;
	target: PrincipalText;
}): Promise<void> => {
	if (isWeb2Backend()) {
		// The group-admin rebalance is part of the leagues domain, still on the
		// on-chain backend; it is wired into the web2 unfriend when that domain
		// swaps. The API delete is the whole friendship removal in this mode.
		await unfriendUserWeb2(params.target);

		return;
	}

	const relationId = [params.sender, params.target].sort().join('#');

	const doc = await getDoc<Relation>({
		collection: Collection.RELATIONS,
		key: relationId
	});

	if (isNullish(doc)) {
		throw new Error('Relation does not exist');
	}

	try {
		await deleteDoc({
			collection: Collection.RELATIONS,
			doc
		});

		await syncGroupAdminsAfterUnfriend({ userA: params.sender, userB: params.target });
	} catch (e: unknown) {
		console.error('Failed to unfriend', e);
		throw e;
	}
};

export const followUser = async ({
	target
}: {
	target: PrincipalText;
	sender: PrincipalText;
}): Promise<void> => {
	if (isWeb2Backend()) {
		await followUserWeb2(target);

		return;
	}

	await functions.followUser({ target });
};

export const unfollowUser = async (params: {
	sender: PrincipalText;
	target: PrincipalText;
}): Promise<void> => {
	if (isWeb2Backend()) {
		await unfollowUserWeb2(params.target);

		return;
	}

	const relationId = toRelationId(params);

	const doc = await getDoc<Relation>({
		collection: Collection.RELATIONS,
		key: relationId
	});

	if (isNullish(doc)) {
		throw new Error('Relation does not exist');
	}

	try {
		await deleteDoc({
			collection: Collection.RELATIONS,
			doc
		});
	} catch (e: unknown) {
		console.error('Failed to unfollow', e);
	}
};
