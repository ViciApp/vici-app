import { Collection } from '#lib/constants/collections.constants.ts';
import { FRIEND_REQUEST_REJECTED_COOLDOWN_MS } from '#lib/constants/relation.constants.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import type { FriendRequestOutcome, Relation } from '#lib/types/relation.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	deleteDocStore,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';
import type { PrincipalText } from '@junobuild/schema';

export const listFriends = (): Relation[] => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const { items } = listDocsStore({
		collection: Collection.RELATIONS,
		caller,
		params: {}
	});

	return items
		.map(([_, item]) => decodeDocData<Relation>(item.data))
		.filter(
			(r) =>
				r.category === RelationCategory.FRIEND &&
				r.state === RelationState.ACTIVE &&
				r.participants.includes(callerText)
		);
};

export const listFollowers = (): Relation[] => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const { items } = listDocsStore({
		collection: Collection.RELATIONS,
		caller,
		params: {}
	});

	return items
		.map(([_, item]) => decodeDocData<Relation>(item.data))
		.filter(
			(r) =>
				r.category === RelationCategory.FOLLOW &&
				r.state === RelationState.ACTIVE &&
				r.participants[1] === callerText
		);
};

export const listFollowing = (): Relation[] => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const { items } = listDocsStore({
		collection: Collection.RELATIONS,
		caller,
		params: {}
	});

	return items
		.map(([_, item]) => decodeDocData<Relation>(item.data))
		.filter(
			(r) =>
				r.category === RelationCategory.FOLLOW &&
				r.state === RelationState.ACTIVE &&
				r.participants[0] === callerText
		);
};

export const checkFriendship = ({
	userA,
	userB
}: {
	userA: PrincipalText;
	userB: PrincipalText;
}): boolean => {
	const caller = msgCaller();

	const relationId = [userA, userB].sort().join('#');

	const doc = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	if (isNullish(doc)) {
		return false;
	}

	const relation = decodeDocData<Relation>(doc.data);

	return relation.category === RelationCategory.FRIEND && relation.state === RelationState.ACTIVE;
};

export const listFriendRequests = (): Relation[] => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const { items } = listDocsStore({
		collection: Collection.RELATIONS,
		caller,
		params: {}
	});

	return items
		.map(([_, item]) => decodeDocData<Relation>(item.data))
		.filter(
			(r) =>
				r.category === RelationCategory.FRIEND &&
				r.state === RelationState.PENDING &&
				r.participants[1] === callerText
		);
};

/**
 * Lists pending friend requests where the caller is the **sender**
 * (`participants[0]`). Mirror of {@link listFriendRequests}, which only
 * surfaces requests where the caller is the recipient.
 */
export const listSentFriendRequests = (): Relation[] => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const { items } = listDocsStore({
		collection: Collection.RELATIONS,
		caller,
		params: {}
	});

	return items
		.map(([_, item]) => decodeDocData<Relation>(item.data))
		.filter(
			(r) =>
				r.category === RelationCategory.FRIEND &&
				r.state === RelationState.PENDING &&
				r.participants[0] === callerText
		);
};

export const sendFriendRequest = ({ target }: { target: PrincipalText }): FriendRequestOutcome => {
	const caller = msgCaller();

	const sender = caller.toText();

	const relationId = [sender, target].sort().join('#');

	const existingDoc = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	const writePendingRequest = (version?: bigint): void => {
		const relation: Relation = {
			category: RelationCategory.FRIEND,
			state: RelationState.PENDING,
			participants: [sender, target]
		};

		setDocStore({
			collection: Collection.RELATIONS,
			key: relationId,
			doc: {
				version,
				data: encodeDocData(relation)
			},
			caller
		});
	};

	if (isNullish(existingDoc)) {
		writePendingRequest();

		return { status: 'sent' };
	}

	const existing = decodeDocData<Relation>(existingDoc.data);

	if (existing.category !== RelationCategory.FRIEND) {
		throw new Error(`Relation already exists with category: ${existing.category}`);
	}

	if (existing.state === RelationState.ACTIVE) {
		return { status: 'already_friends' };
	}

	if (existing.state === RelationState.PENDING) {
		// The other user already sent us a pending friend request: rather than
		// surfacing an error, treat our outgoing request as an acceptance of
		// theirs. The recipient of the existing request is `participants[1]`,
		// so this only applies when the caller is on the receiving end.
		if (existing.participants[1] === sender) {
			setDocStore({
				collection: Collection.RELATIONS,
				key: relationId,
				doc: {
					version: existingDoc.version,
					data: encodeDocData({
						...existing,
						state: RelationState.ACTIVE
					})
				},
				caller
			});

			return { status: 'auto_accepted' };
		}

		return { status: 'already_pending' };
	}

	if (existing.state === RelationState.REJECTED) {
		// The rejecter (`participants[1]` of the rejected request) may
		// re-initiate at any time; the rejected sender only after the
		// cooldown. The reject write is the last write a REJECTED doc
		// receives, so the Juno-managed `updated_at` is the rejection time.
		const isRejecter = existing.participants[1] === sender;
		const rejectedAtMs = nonNullish(existingDoc.updated_at)
			? Number(existingDoc.updated_at / 1_000_000n)
			: undefined;
		const retryAtMs = nonNullish(rejectedAtMs)
			? rejectedAtMs + FRIEND_REQUEST_REJECTED_COOLDOWN_MS
			: undefined;

		const nowMs = Number(time() / 1_000_000n);

		if (!isRejecter && nonNullish(retryAtMs) && nowMs < retryAtMs) {
			return { status: 'rejected_cooldown', retryAtMs };
		}

		writePendingRequest(existingDoc.version);

		return { status: 'sent' };
	}

	throw new Error(`Friend request already exists with state: ${existing.state}`);
};

export const acceptFriendRequest = ({ relationId }: { relationId: string }): void => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const doc = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	if (isNullish(doc)) {
		throw new Error('Relation does not exist');
	}

	const relation = decodeDocData<Relation>(doc.data);

	if (relation.participants[1] !== callerText) {
		throw new Error('Only the recipient can accept a friend request.');
	}

	setDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		doc: {
			version: doc.version,
			data: encodeDocData({
				...relation,
				state: RelationState.ACTIVE
			})
		},
		caller
	});
};

/**
 * Cancels a friend request the caller previously sent.
 *
 * Atomicity: the cancel only succeeds if the relation is still
 * {@link RelationState.PENDING} **and** its on-chain `version` matches the
 * one we just read. If the recipient accepted/rejected in the meantime,
 * the doc's `version` was bumped, `deleteDocStore` traps with a
 * version-mismatch error, and the cancel is rejected — exactly the
 * "nanosecond" race the caller asked us to guard against. We also
 * deliberately do **not** "transition to a CANCELLED state" because that
 * would be a second write that itself races with the recipient's accept;
 * a versioned delete is the only single-write, conflict-detecting move
 * the Juno datastore exposes.
 */
export const cancelFriendRequest = ({ relationId }: { relationId: string }): void => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const doc = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	if (isNullish(doc)) {
		throw new Error('Relation does not exist');
	}

	const relation = decodeDocData<Relation>(doc.data);

	if (relation.category !== RelationCategory.FRIEND) {
		throw new Error('Only friend requests can be cancelled.');
	}

	if (relation.participants[0] !== callerText) {
		throw new Error('Only the sender can cancel a friend request.');
	}

	if (relation.state !== RelationState.PENDING) {
		throw new Error(`Cannot cancel a request in state "${relation.state}".`);
	}

	deleteDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		doc: {
			version: doc.version
		},
		caller
	});
};

export const rejectFriendRequest = ({ relationId }: { relationId: string }): void => {
	const caller = msgCaller();

	const callerText = caller.toText();

	const doc = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	if (isNullish(doc)) {
		throw new Error('Relation does not exist');
	}

	const relation = decodeDocData<Relation>(doc.data);

	if (relation.participants[1] !== callerText) {
		throw new Error('Only the recipient can reject a friend request.');
	}

	setDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		doc: {
			version: doc.version,
			data: encodeDocData({
				...relation,
				state: RelationState.REJECTED
			})
		},
		caller
	});
};

export const followUser = ({ target }: { target: PrincipalText }): void => {
	const caller = msgCaller();

	const sender = caller.toText();

	const relationId = `follow#${sender}#${target}`;

	const relation: Relation = {
		category: RelationCategory.FOLLOW,
		state: RelationState.ACTIVE,
		participants: [sender, target]
	};

	setDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		doc: {
			data: encodeDocData(relation)
		},
		caller
	});
};
