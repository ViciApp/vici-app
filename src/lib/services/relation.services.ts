import type { KeyedDoc } from '#lib/types/keyed-doc.ts';
import type { FriendRequestOutcome, Relation } from '#lib/types/relation.ts';
import {
	acceptFriendRequest as acceptFriendRequestApi,
	cancelFriendRequest as cancelFriendRequestApi,
	followUser as followUserApi,
	getProfileByHandle as getProfileByHandleApi,
	rejectFriendRequest as rejectFriendRequestApi,
	sendFriendRequest as sendFriendRequestApi,
	unfriendUser as unfriendUserApi
} from '#lib/api-client/client.ts';
import { nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@dfinity/zod-schemas';

/** Matches a bare account id (uuid) pasted into the add-friend input, so a
 * user can be targeted by id as well as by `@handle`. */
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the add-friend input to an account id. The Friends UI accepts an
 * `@handle` (resolved through the by-handle lookup, lookalikes included, so
 * `@antonio.ventilii` finds `antonioventilii`) or a raw account id, while the
 * API only takes the id.
 *
 * Throws a typed `Error` with one of these codes on the message; the caller
 * is expected to map them to i18n strings:
 *   - `not_found`: nickname didn't match any profile
 *   - `self`: input resolves to the caller
 */
const resolveTargetUserId = async ({
	input,
	sender
}: {
	input: string;
	sender: PrincipalText;
}): Promise<PrincipalText> => {
	const stripped = input.replace(/^@+/, '').trim();

	// An input of just `@` (or whitespace) names nobody.
	if (stripped === '') {
		throw new Error('not_found');
	}

	const match = await getProfileByHandleApi(stripped);

	if (nonNullish(match)) {
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

export const sendFriendRequest = async ({
	target,
	sender
}: {
	target: string;
	sender: PrincipalText;
}): Promise<FriendRequestOutcome> =>
	sendFriendRequestApi(await resolveTargetUserId({ input: target, sender }));

export const acceptFriendRequest = async ({
	currentRelation
}: {
	currentRelation: KeyedDoc<Relation> | { key: string };
}): Promise<void> => {
	await acceptFriendRequestApi(currentRelation.key);
};

export const rejectFriendRequest = async ({
	currentRelation
}: {
	currentRelation: KeyedDoc<Relation> | { key: string };
}): Promise<void> => {
	await rejectFriendRequestApi(currentRelation.key);
};

/**
 * Cancels a friend request previously sent by the caller. If the recipient
 * accepts or rejects between the click and the write, the cancel fails and
 * the user gets an error; there is no race window where both a cancel and an
 * accept succeed.
 */
export const cancelFriendRequest = async ({
	currentRelation
}: {
	currentRelation: KeyedDoc<Relation> | { key: string };
}): Promise<void> => {
	await cancelFriendRequestApi(currentRelation.key);
};

/**
 * Removes a friend relation. Group admins are not rebalanced: that edits
 * icdc-core registry groups (market groups, not leagues) with user-signed
 * registry calls, and the API has no registry-group route, so the friendship
 * delete is the whole removal.
 */
export const unfriendUser = async (params: {
	sender: PrincipalText;
	target: PrincipalText;
}): Promise<void> => {
	await unfriendUserApi(params.target);
};

export const followUser = async ({
	target
}: {
	target: PrincipalText;
	sender: PrincipalText;
}): Promise<void> => {
	await followUserApi(target);
};
