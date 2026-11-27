// Social feed: activities plus per-activity like reactions.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { UUID_RE } from '../lib/constants';
import { logger } from '../lib/logger';
import { fanOutResolvedResults } from './resolved-results';

export const ACTIVITY_TYPES = [
	'trade',
	'settlement',
	'comment',
	'follow',
	'upvote',
	'downvote'
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const isActivityType = (value: string): value is ActivityType =>
	(ACTIVITY_TYPES as readonly string[]).includes(value);

/** Upper bound on an activity title; the longest the app writes is a
 * `Market created: ` prefix on a series title of at most 128 characters. */
export const ACTIVITY_TITLE_MAX_LENGTH = 500;

/** Upper bound on activity details. The longest the app writes is a series
 * description, at most 1024 characters on chain; doubled because the request
 * schema counts UTF-16 code units and one character can take two. */
export const ACTIVITY_DETAILS_MAX_LENGTH = 2048;

/** Upper bound on the market id an activity or a reaction carries. Registry
 * series ids are 64-character SHA-256 hex; the cap leaves headroom without
 * letting a caller store an arbitrary string. */
export const ACTIVITY_MARKET_ID_MAX_LENGTH = 128;

/** Upper bound on the denormalized activityTitle a reaction may carry, so a
 * liker cannot bloat the row the inbox card reads. It copies the activity
 * title, so it shares that bound. */
export const ACTIVITY_REACTION_TITLE_MAX_LENGTH = ACTIVITY_TITLE_MAX_LENGTH;

export class ActivityValidationError extends Error {}

/** Typed failure for a reaction addressed at an activity that does not
 * exist, so the route can answer it as a 404 rather than a fault. */
export class ActivityNotFoundError extends Error {
	constructor() {
		super('Activity does not exist.');
	}
}

export interface Activity {
	key: string;
	type: ActivityType;
	user: string;
	targetUser?: string;
	marketId?: string;
	title: string;
	details?: string;
	timestamp: number;
}

interface ActivityRow {
	key: string;
	user_id: string;
	type: ActivityType;
	target_user: string | null;
	market_id: string | null;
	title: string;
	details: string | null;
	timestamp_ms: string;
}

const shapeActivity = (row: ActivityRow): Activity => ({
	key: row.key,
	type: row.type,
	user: row.user_id,
	targetUser: row.target_user ?? undefined,
	marketId: row.market_id ?? undefined,
	title: row.title,
	details: row.details ?? undefined,
	timestamp: Number(row.timestamp_ms)
});

/** The activity doc key: `${user}#${timestamp}#${type}`, the one stable
 * identifier reactions address an activity by. */
export const activityKey = ({
	userId,
	timestamp,
	type
}: {
	userId: string;
	timestamp: number;
	type: ActivityType;
}): string => `${userId}#${timestamp}#${type}`;

/** Splits `${user}#${timestamp}#${type}` and validates every segment: the
 * user segment is a user id, the timestamp is a canonical safe integer and
 * the type is known. Returns undefined for any malformed key. */
export const parseActivityKey = (
	key: string
): { userId: string; timestamp: number; type: ActivityType } | undefined => {
	const parts = key.split('#');

	if (parts.length !== 3) {
		return;
	}

	const [userSegment, timestampSegment, typeSegment] = parts;

	if (isNullish(userSegment) || isNullish(timestampSegment) || isNullish(typeSegment)) {
		return;
	}

	if (!UUID_RE.test(userSegment)) {
		return;
	}

	const timestamp = Number(timestampSegment);

	if (!Number.isSafeInteger(timestamp) || `${timestamp}` !== timestampSegment) {
		return;
	}

	if (!isActivityType(typeSegment)) {
		return;
	}

	return { userId: userSegment, timestamp, type: typeSegment };
};

/**
 * Records an activity for the session user. The actor is the caller by
 * construction (impersonation is impossible), and the structural rules the
 * feed relies on still hold: a known type, a canonical safe-integer
 * timestamp, and the `${user}#${timestamp}#${type}` key shape.
 *
 * A settlement activity additionally fans out resolved-result rows from the
 * clearing settlement plan, best-effort and detached so a plan-read hiccup
 * never disrupts the resolver's write. Only a settling role may post one; the
 * route enforces that before calling here.
 */
export const createActivity = async ({
	userId,
	type,
	targetUser,
	marketId,
	title,
	details,
	timestamp
}: {
	userId: string;
	type: string;
	targetUser?: string;
	marketId?: string;
	title: string;
	details?: string;
	timestamp: number;
}): Promise<Activity> => {
	if (!isActivityType(type)) {
		throw new ActivityValidationError('Unknown activity type.');
	}

	if (!Number.isSafeInteger(timestamp)) {
		throw new ActivityValidationError('Activity timestamp must be a safe integer.');
	}

	const key = activityKey({ userId, timestamp, type });

	const rows = await query<ActivityRow>(
		`insert into activities (key, user_id, type, target_user, market_id, title, details, timestamp_ms)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 returning key, user_id, type, target_user, market_id, title, details, timestamp_ms::text`,
		[key, userId, type, targetUser ?? null, marketId ?? null, title, details ?? null, timestamp]
	);
	const [row] = rows;

	if (isNullish(row)) {
		throw new Error('activity insert returned no row');
	}

	const activity = shapeActivity(row);

	if (activity.type === 'settlement' && nonNullish(activity.marketId)) {
		// Detached on purpose: the fan-out reads the on-chain settlement plan
		// and must never delay or fail the activity write itself.
		fanOutResolvedResults({ marketId: activity.marketId }).catch((err) => {
			logger.error(`resolved-results fan-out failed for ${activity.marketId}:`, err);
		});
	}

	return activity;
};

/** Most-recent activities, ordered by insertion time, optionally filtered
 * to one type (the settlement-labels read). */
export const listActivities = async ({
	limit,
	type
}: {
	limit: number;
	type?: ActivityType;
}): Promise<Activity[]> => {
	if (limit <= 0) {
		return [];
	}

	const rows = nonNullish(type)
		? await query<ActivityRow>(
				`select key, user_id, type, target_user, market_id, title, details, timestamp_ms::text
				 from activities where type = $1 order by created_at desc limit $2`,
				[type, limit]
			)
		: await query<ActivityRow>(
				`select key, user_id, type, target_user, market_id, title, details, timestamp_ms::text
				 from activities order by created_at desc limit $1`,
				[limit]
			);

	return rows.map(shapeActivity);
};

// Reactions

export interface ActivityReaction {
	activityKey: string;
	liker: string;
	timestamp: number;
	activityTitle: string;
	marketId?: string;
}

interface ReactionRow {
	activity_key: string;
	liker: string;
	timestamp_ms: string;
	activity_title: string;
	market_id: string | null;
}

const shapeReaction = (row: ReactionRow): ActivityReaction => ({
	activityKey: row.activity_key,
	liker: row.liker,
	timestamp: Number(row.timestamp_ms),
	activityTitle: row.activity_title,
	marketId: row.market_id ?? undefined
});

const validateReaction = ({
	activityKey: key,
	timestamp,
	activityTitle
}: {
	activityKey: string;
	timestamp: number;
	activityTitle: string;
}): void => {
	if (isNullish(parseActivityKey(key))) {
		throw new ActivityValidationError(
			'Activity reaction key must be `${user}#${timestamp}#${type}` with a known type.'
		);
	}

	if (!Number.isSafeInteger(timestamp)) {
		throw new ActivityValidationError('Activity reaction timestamp must be a safe integer.');
	}

	if (activityTitle.length > ACTIVITY_REACTION_TITLE_MAX_LENGTH) {
		throw new ActivityValidationError(
			`Activity reaction activityTitle must be a string of at most ${ACTIVITY_REACTION_TITLE_MAX_LENGTH} characters.`
		);
	}
};

/**
 * Records one like per (activity, liker): re-liking an already-liked
 * activity is a no-op. The liked activity must exist
 * ({@link ActivityNotFoundError} otherwise).
 */
export const likeActivity = async ({
	likerId,
	activityKey: key,
	timestamp,
	activityTitle,
	marketId
}: {
	likerId: string;
	activityKey: string;
	timestamp: number;
	activityTitle: string;
	marketId?: string;
}): Promise<void> => {
	validateReaction({ activityKey: key, timestamp, activityTitle });

	await tx(async (q) => {
		// A structurally valid key can still address an activity that never
		// existed; guard inside the transaction so no reaction row can ever be
		// created for a phantom activity.
		const existing = await q<{ key: string }>(`select key from activities where key = $1`, [key]);

		if (isNullish(existing[0])) {
			throw new ActivityNotFoundError();
		}

		await q(
			`insert into activity_reactions (activity_key, liker, timestamp_ms, activity_title, market_id)
			 values ($1, $2, $3, $4, $5)
			 on conflict (activity_key, liker) do nothing`,
			[key, likerId, timestamp, activityTitle, marketId ?? null]
		);
	});
};

/** Removes the caller's own like. Unliking something never liked is a no-op. */
export const unlikeActivity = async ({
	likerId,
	activityKey: key
}: {
	likerId: string;
	activityKey: string;
}): Promise<void> => {
	await query(`delete from activity_reactions where activity_key = $1 and liker = $2`, [
		key,
		likerId
	]);
};

/** Removes every like `likerId` gave, inside the caller's transaction. */
export const deleteReactionsBy = async ({
	likerId,
	q
}: {
	likerId: string;
	q: TxQuery;
}): Promise<void> => {
	await q(`delete from activity_reactions where liker = $1`, [likerId]);
};

/** The most-recent reactions across all users, bounded. */
export const listReactions = async ({ limit }: { limit: number }): Promise<ActivityReaction[]> => {
	if (limit <= 0) {
		return [];
	}

	const rows = await query<ReactionRow>(
		`select activity_key, liker, timestamp_ms::text, activity_title, market_id
		 from activity_reactions order by created_at desc limit $1`,
		[limit]
	);

	return rows.map(shapeReaction);
};

/** The most-recent likes on `authorId`'s own activities, bounded: the
 * like-received inbox, read through the activity owner instead of a scan of
 * the global window, so an older like is not lost behind newer ones elsewhere.
 * The key-prefix match is what reaches `activity_reactions_owner_created_idx`
 * (an activity key starts with its owner's id); the join to `activities`
 * still decides ownership. */
export const listReceivedReactions = async ({
	authorId,
	limit
}: {
	authorId: string;
	limit: number;
}): Promise<ActivityReaction[]> => {
	if (limit <= 0) {
		return [];
	}

	const rows = await query<ReactionRow>(
		`select r.activity_key, r.liker, r.timestamp_ms::text, r.activity_title, r.market_id
		 from activity_reactions r
		 join activities a on a.key = r.activity_key
		 where split_part(r.activity_key, '#', 1) = $1::text and a.user_id = $1::uuid
		 order by r.created_at desc limit $2`,
		[authorId, limit]
	);

	return rows.map(shapeReaction);
};
