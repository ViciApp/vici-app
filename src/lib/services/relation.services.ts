import type { KeyedDoc } from '#lib/types/keyed-doc.ts';
import type { FriendRequestOutcome, Relation } from '#lib/types/relation.ts';
import {
	acceptFriendRequest as acceptFriendRequestWeb2,
	cancelFriendRequest as cancelFriendRequestWeb2,
	followUser as followUserWeb2,
	rejectFriendRequest as rejectFriendRequestWeb2,
	searchProfiles as searchProfilesWeb2,
	sendFriendRequest as sendFriendRequestWeb2,
	unfriendUser as unfriendUserWeb2
} from '#lib/web2/client.ts';
import type { PrincipalText } from '@dfinity/zod-schemas';

/** Matches a bare account id (uuid) pasted into the add-friend input, so a
 * user can be targeted by id as well as by `@handle`. */
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the add-friend input to an account id. The Friends UI accepts an
 * `@handle` (nickname) or a raw account id, while the API only takes the id.
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

	// An input of just `@` (or whitespace) would otherwise search with an empty
	// query, which matches every profile: a needlessly heavy read from one
	// malformed click.
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

export const sendFriendRequest = async ({
	target,
	sender
}: {
	target: string;
	sender: PrincipalText;
}): Promise<FriendRequestOutcome> =>
	sendFriendRequestWeb2(await resolveTargetUserId({ input: target, sender }));

export const acceptFriendRequest = async ({
	currentRelation
}: {
	currentRelation: KeyedDoc<Relation> | { key: string };
}): Promise<void> => {
	await acceptFriendRequestWeb2(currentRelation.key);
};

export const rejectFriendRequest = async ({
	currentRelation
}: {
	currentRelation: KeyedDoc<Relation> | { key: string };
}): Promise<void> => {
	await rejectFriendRequestWeb2(currentRelation.key);
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
	await cancelFriendRequestWeb2(currentRelation.key);
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
	await unfriendUserWeb2(params.target);
};

export const followUser = async ({
	target
}: {
	target: PrincipalText;
	sender: PrincipalText;
}): Promise<void> => {
	await followUserWeb2(target);
};
