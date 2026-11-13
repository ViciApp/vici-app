// Social graph: friendships (one row per unordered pair, mutual once
// ACTIVE) and follows (one row per directed edge). The friendship state
// machine mirrors the client contract exactly, including the auto-accept
// on a crossing request and the rejected-sender cooldown.

import { isNullish } from '@dfinity/utils';
import { query, tx } from '../db/client';

export type RelationCategory = 'FRIEND' | 'follow' | 'GROUP';
export type RelationState = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'BLOCKED';

/** How long a rejected friend-request sender must wait before re-sending to
 * the same person. The rejecter is exempt and may re-initiate at any time. */
export const FRIEND_REQUEST_REJECTED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Client-facing relation shape: participants keeps [sender, target] order. */
export interface Relation {
	key: string;
	category: RelationCategory;
	state: RelationState;
	participants: [string, string];
}

export type FriendRequestOutcome =
	| { status: 'sent' }
	| { status: 'already_friends' }
	| { status: 'already_pending' }
	| { status: 'auto_accepted' }
	| { status: 'rejected_cooldown'; retryAtMs: number };

export class RelationError extends Error {}

interface RelationRow {
	key: string;
	category: RelationCategory;
	state: RelationState;
	participant_one: string;
	participant_two: string;
	updated_at: Date;
}

const shapeRelation = (row: RelationRow): Relation => ({
	key: row.key,
	category: row.category,
	state: row.state,
	participants: [row.participant_one, row.participant_two]
});

/** Canonical friendship key: the unordered pair, sorted, joined by '#'. */
export const friendRelationKey = (userA: string, userB: string): string =>
	[userA, userB].sort().join('#');

/** Canonical follow key: one directed edge per (follower, target). */
export const followRelationKey = ({ sender, target }: { sender: string; target: string }): string =>
	`follow#${sender}#${target}`;

const listRelations = async (where: string, params: unknown[]): Promise<Relation[]> => {
	const rows = await query<RelationRow>(
		`select key, category, state, participant_one, participant_two, updated_at
		 from relations where ${where}`,
		params
	);

	return rows.map(shapeRelation);
};

export const listFriends = (userId: string): Promise<Relation[]> =>
	listRelations(
		`category = 'FRIEND' and state = 'ACTIVE' and (participant_one = $1 or participant_two = $1)`,
		[userId]
	);

export const listFollowers = (userId: string): Promise<Relation[]> =>
	listRelations(`category = 'follow' and state = 'ACTIVE' and participant_two = $1`, [userId]);

export const listFollowing = (userId: string): Promise<Relation[]> =>
	listRelations(`category = 'follow' and state = 'ACTIVE' and participant_one = $1`, [userId]);

/** Pending friend requests where the caller is the recipient. */
export const listFriendRequests = (userId: string): Promise<Relation[]> =>
	listRelations(`category = 'FRIEND' and state = 'PENDING' and participant_two = $1`, [userId]);

/** Pending friend requests where the caller is the sender. */
export const listSentFriendRequests = (userId: string): Promise<Relation[]> =>
	listRelations(`category = 'FRIEND' and state = 'PENDING' and participant_one = $1`, [userId]);

export const checkFriendship = async ({
	userA,
	userB
}: {
	userA: string;
	userB: string;
}): Promise<boolean> => {
	const rows = await query<{ ok: boolean }>(
		`select exists (
		   select 1 from relations
		   where key = $1 and category = 'FRIEND' and state = 'ACTIVE'
		 ) as ok`,
		[friendRelationKey(userA, userB)]
	);

	return rows[0]?.ok === true;
};

/**
 * Friend-request send with the full outcome contract:
 *
 * - no relation yet: create PENDING, 'sent'.
 * - existing non-FRIEND relation: error.
 * - ACTIVE: 'already_friends'.
 * - PENDING sent by the caller: 'already_pending'; PENDING sent by the
 *   other side: activate it, 'auto_accepted' (a crossing request is an
 *   acceptance, not an error).
 * - REJECTED: the rejecter may re-initiate at any time; the rejected sender
 *   only after {@link FRIEND_REQUEST_REJECTED_COOLDOWN_MS} (the reject
 *   write is the last write a REJECTED row receives, so its updated_at is
 *   the rejection time). Inside the window: 'rejected_cooldown' with the
 *   retry timestamp.
 *
 * Runs in one transaction with the pair row locked, so a crossing send /
 * accept serializes instead of double-writing.
 */
export const sendFriendRequest = async ({
	senderId,
	targetId
}: {
	senderId: string;
	targetId: string;
}): Promise<FriendRequestOutcome> => {
	if (senderId === targetId) {
		throw new RelationError('Cannot send a friend request to yourself.');
	}

	const key = friendRelationKey(senderId, targetId);

	return await tx(async (q) => {
		const rows = await q<RelationRow>(
			`select key, category, state, participant_one, participant_two, updated_at
			 from relations where key = $1 for update`,
			[key]
		);
		const [existing] = rows;

		const writePendingRequest = async (): Promise<void> => {
			await q(
				`insert into relations (key, category, state, participant_one, participant_two, updated_at)
				 values ($1, 'FRIEND', 'PENDING', $2, $3, now())
				 on conflict (key) do update set
				   state = 'PENDING',
				   participant_one = excluded.participant_one,
				   participant_two = excluded.participant_two,
				   updated_at = now()`,
				[key, senderId, targetId]
			);
		};

		if (isNullish(existing)) {
			await writePendingRequest();

			return { status: 'sent' };
		}

		if (existing.category !== 'FRIEND') {
			throw new RelationError(`Relation already exists with category: ${existing.category}`);
		}

		if (existing.state === 'ACTIVE') {
			return { status: 'already_friends' };
		}

		if (existing.state === 'PENDING') {
			// The other user already sent a pending request: treat this outgoing
			// request as an acceptance of theirs. The recipient of the existing
			// request is participant_two, so this only applies when the caller
			// is on the receiving end.
			if (existing.participant_two === senderId) {
				await q(`update relations set state = 'ACTIVE', updated_at = now() where key = $1`, [key]);

				return { status: 'auto_accepted' };
			}

			return { status: 'already_pending' };
		}

		if (existing.state === 'REJECTED') {
			const isRejecter = existing.participant_two === senderId;
			const rejectedAtMs = existing.updated_at.getTime();
			const retryAtMs = rejectedAtMs + FRIEND_REQUEST_REJECTED_COOLDOWN_MS;
			const nowMs = Date.now();

			if (!isRejecter && nowMs < retryAtMs) {
				return { status: 'rejected_cooldown', retryAtMs };
			}

			await writePendingRequest();

			return { status: 'sent' };
		}

		throw new RelationError(`Friend request already exists with state: ${existing.state}`);
	});
};

/** Only the recipient can accept; the row transitions to ACTIVE. */
export const acceptFriendRequest = async ({
	relationId,
	callerId
}: {
	relationId: string;
	callerId: string;
}): Promise<void> => {
	await tx(async (q) => {
		const rows = await q<RelationRow>(
			`select key, category, state, participant_one, participant_two, updated_at
			 from relations where key = $1 for update`,
			[relationId]
		);
		const [relation] = rows;

		if (isNullish(relation)) {
			throw new RelationError('Relation does not exist');
		}

		if (relation.participant_two !== callerId) {
			throw new RelationError('Only the recipient can accept a friend request.');
		}

		await q(`update relations set state = 'ACTIVE', updated_at = now() where key = $1`, [
			relationId
		]);
	});
};

/** Only the recipient can reject; the row transitions to REJECTED and its
 * updated_at becomes the cooldown anchor. */
export const rejectFriendRequest = async ({
	relationId,
	callerId
}: {
	relationId: string;
	callerId: string;
}): Promise<void> => {
	await tx(async (q) => {
		const rows = await q<RelationRow>(
			`select key, category, state, participant_one, participant_two, updated_at
			 from relations where key = $1 for update`,
			[relationId]
		);
		const [relation] = rows;

		if (isNullish(relation)) {
			throw new RelationError('Relation does not exist');
		}

		if (relation.participant_two !== callerId) {
			throw new RelationError('Only the recipient can reject a friend request.');
		}

		await q(`update relations set state = 'REJECTED', updated_at = now() where key = $1`, [
			relationId
		]);
	});
};

/**
 * Cancels a friend request the caller previously sent. The cancel only
 * succeeds while the relation is still PENDING: the delete is conditioned
 * on the state inside the same transaction that read it, so a concurrent
 * accept/reject wins the race and the cancel is rejected instead of
 * silently removing an already-answered request.
 */
export const cancelFriendRequest = async ({
	relationId,
	callerId
}: {
	relationId: string;
	callerId: string;
}): Promise<void> => {
	await tx(async (q) => {
		const rows = await q<RelationRow>(
			`select key, category, state, participant_one, participant_two, updated_at
			 from relations where key = $1 for update`,
			[relationId]
		);
		const [relation] = rows;

		if (isNullish(relation)) {
			throw new RelationError('Relation does not exist');
		}

		if (relation.category !== 'FRIEND') {
			throw new RelationError('Only friend requests can be cancelled.');
		}

		if (relation.participant_one !== callerId) {
			throw new RelationError('Only the sender can cancel a friend request.');
		}

		if (relation.state !== 'PENDING') {
			throw new RelationError(`Cannot cancel a request in state "${relation.state}".`);
		}

		await q(`delete from relations where key = $1 and state = 'PENDING'`, [relationId]);
	});
};

/** Removes an ACTIVE (or any) friendship the caller is part of. */
export const unfriendUser = async ({
	callerId,
	targetId
}: {
	callerId: string;
	targetId: string;
}): Promise<void> => {
	const key = friendRelationKey(callerId, targetId);

	const rows = await query<{ key: string }>(
		`delete from relations
		 where key = $1 and category = 'FRIEND' and (participant_one = $2 or participant_two = $2)
		 returning key`,
		[key, callerId]
	);

	if (isNullish(rows[0])) {
		throw new RelationError('Relation does not exist');
	}
};

/** Idempotent follow: re-following refreshes the ACTIVE edge. */
export const followUser = async ({
	senderId,
	targetId
}: {
	senderId: string;
	targetId: string;
}): Promise<void> => {
	if (senderId === targetId) {
		throw new RelationError('Cannot follow yourself.');
	}

	await query(
		`insert into relations (key, category, state, participant_one, participant_two, updated_at)
		 values ($1, 'follow', 'ACTIVE', $2, $3, now())
		 on conflict (key) do update set state = 'ACTIVE', updated_at = now()`,
		[followRelationKey({ sender: senderId, target: targetId }), senderId, targetId]
	);
};

/** Removes the caller's own follow edge. */
export const unfollowUser = async ({
	senderId,
	targetId
}: {
	senderId: string;
	targetId: string;
}): Promise<void> => {
	const rows = await query<{ key: string }>(
		`delete from relations where key = $1 and participant_one = $2 returning key`,
		[followRelationKey({ sender: senderId, target: targetId }), senderId]
	);

	if (isNullish(rows[0])) {
		throw new RelationError('Relation does not exist');
	}
};
