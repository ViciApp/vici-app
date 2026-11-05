import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { ACTIVITY_REACTION_TITLE_MAX_LENGTH, type ActivityReaction } from '#lib/types/social.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

const ACTIVITY_TYPES: readonly string[] = Object.values(ActivityType);

/**
 * Write-time guard for the `activity_reactions` collection — one doc per `(activity, liker)`. The
 * collection is public-write (each user persists their own like), and a like can be read back by
 * anyone (counts + the like-received inbox card), so without a guard a client could `set_doc` a
 * reaction attributed to **another** principal (feed spoofing) or under a malformed key. This assert
 * binds every reaction to its writer, mirroring {@link assertSetActivity}:
 *
 *  - `data.liker` MUST equal the caller — no liking as someone else.
 *  - the doc key must be `${actor}#${timestamp}#${type}#${liker}`: the liked activity's own doc key
 *    (the shape `logActivity` writes, so the embedded segments stay trustworthy) plus the caller.
 *  - `data.activityKey` MUST equal the key's embedded `${actor}#${timestamp}#${type}` prefix.
 *  - `data.timestamp` must be a safe integer; the denormalized `activityTitle` is a bounded string
 *    and `marketId`, when present, a string — so a liker can't bloat the doc the inbox card reads.
 *
 * Deletes (unlike) are owner-scoped by Juno on this public collection, so a liker can only remove
 * their own reaction; no delete assert is needed.
 */
export const assertSetActivityReaction = ({
	caller,
	data: {
		collection,
		key,
		data: { proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.ACTIVITY_REACTIONS) {
		return;
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	let reaction: ActivityReaction;

	try {
		reaction = decodeDocData<ActivityReaction>(proposed.data);
	} catch {
		throw new Error('Invalid activity reaction payload.');
	}

	if (reaction.liker !== callerText) {
		throw new Error('Activity reaction liker must match the caller.');
	}

	// Key is the liked activity's doc key (`${actor}#${timestamp}#${type}`) plus the liker. Principals,
	// numeric timestamps, and `ActivityType` tokens never contain `#`, so the split is exactly four.
	const parts = key.split('#');

	if (parts.length !== 4) {
		throw new Error('Activity reaction key must be `${actor}#${timestamp}#${type}#${liker}`.');
	}

	const [actor, timestampSegment, type, likerSegment] = parts;

	if (likerSegment !== callerText) {
		throw new Error('Activity reaction key liker segment must be the caller.');
	}

	try {
		Principal.fromText(actor);
	} catch {
		throw new Error('Activity reaction actor segment must be a valid principal.');
	}

	// Must be the canonical `${timestamp}` `logActivity` writes — a safe integer whose string form
	// round-trips (rejects leading zeros / oversized values), mirroring `assertSetActivity`.
	const timestampValue = Number(timestampSegment);

	if (!Number.isSafeInteger(timestampValue) || `${timestampValue}` !== timestampSegment) {
		throw new Error('Activity reaction key timestamp segment must be a canonical safe integer.');
	}

	if (!ACTIVITY_TYPES.includes(type)) {
		throw new Error('Activity reaction key type segment must be a known activity type.');
	}

	if (reaction.activityKey !== `${actor}#${timestampSegment}#${type}`) {
		throw new Error('Activity reaction activityKey must match the key prefix.');
	}

	if (!Number.isSafeInteger(reaction.timestamp)) {
		throw new Error('Activity reaction timestamp must be a safe integer.');
	}

	if (
		typeof reaction.activityTitle !== 'string' ||
		reaction.activityTitle.length > ACTIVITY_REACTION_TITLE_MAX_LENGTH
	) {
		throw new Error(
			`Activity reaction activityTitle must be a string of at most ${ACTIVITY_REACTION_TITLE_MAX_LENGTH} characters.`
		);
	}

	if (nonNullish(reaction.marketId) && typeof reaction.marketId !== 'string') {
		throw new Error('Activity reaction marketId must be a string.');
	}
};
