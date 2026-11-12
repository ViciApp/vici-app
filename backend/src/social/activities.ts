// Social feed: activities plus per-activity like reactions with a
// transactional count rollup, so the feed renders like counts in O(1)
// without tallying the reaction pages.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx } from '../db/client';
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

/** Upper bound on the denormalized activityTitle a reaction may carry, so a
 * liker cannot bloat the row the inbox card reads. */
export const ACTIVITY_REACTION_TITLE_MAX_LENGTH = 500;

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
 * never disrupts the resolver's write.
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
		fanOutResolvedResults({
			marketId: activity.marketId,
			fallbackTitle: activity.title
		}).catch((err) => {
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
 * Records one like per (activity, liker) and moves the rollup counter in
 * the SAME transaction. Only a genuine create bumps the count: re-liking an
 * already-liked activity is a no-op, so a double-like cannot double-count.
 * The liked activity must exist ({@link ActivityNotFoundError} otherwise).
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
		// existed; guard inside the transaction so no reaction row or rollup
		// increment can ever be created for a phantom activity.
		const existing = await q<{ key: string }>(`select key from activities where key = $1`, [key]);

		if (isNullish(existing[0])) {
			throw new ActivityNotFoundError();
		}

		const inserted = await q<{ activity_key: string }>(
			`insert into activity_reactions (activity_key, liker, timestamp_ms, activity_title, market_id)
			 values ($1, $2, $3, $4, $5)
			 on conflict (activity_key, liker) do nothing
			 returning activity_key`,
			[key, likerId, timestamp, activityTitle, marketId ?? null]
		);

		if (isNullish(inserted[0])) {
			return;
		}

		await q(
			`insert into activity_reaction_counts (activity_key, count, updated_at_ms)
			 values ($1, 1, $2)
			 on conflict (activity_key) do update set
			   count = activity_reaction_counts.count + 1,
			   updated_at_ms = excluded.updated_at_ms`,
			[key, Date.now()]
		);
	});
};

/** Removes the caller's own like and decrements the counter (floored at 0)
 * in the same transaction. Unliking something never liked is a no-op. */
export const unlikeActivity = async ({
	likerId,
	activityKey: key
}: {
	likerId: string;
	activityKey: string;
}): Promise<void> => {
	await tx(async (q) => {
		const deleted = await q<{ activity_key: string }>(
			`delete from activity_reactions where activity_key = $1 and liker = $2 returning activity_key`,
			[key, likerId]
		);

		if (isNullish(deleted[0])) {
			return;
		}

		await q(
			`update activity_reaction_counts
			 set count = greatest(0, count - 1), updated_at_ms = $2
			 where activity_key = $1`,
			[key, Date.now()]
		);
	});
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

export interface ActivityReactionCount {
	activityKey: string;
	count: number;
	updatedAtMs: number;
}

/** Rollup counters for the given activity keys. */
export const getReactionCounts = async ({
	activityKeys
}: {
	activityKeys: string[];
}): Promise<ActivityReactionCount[]> => {
	if (activityKeys.length === 0) {
		return [];
	}

	const rows = await query<{ activity_key: string; count: number; updated_at_ms: string }>(
		`select activity_key, count, updated_at_ms::text
		 from activity_reaction_counts where activity_key = any($1)`,
		[activityKeys]
	);

	return rows.map((row) => ({
		activityKey: row.activity_key,
		count: row.count,
		updatedAtMs: Number(row.updated_at_ms)
	}));
};

/**
 * Admin corrective: re-derive every activity's exact like count from the
 * reaction rows and overwrite the counters, healing any drift and zeroing
 * counters whose activity no longer has likes. Returns the number of
 * counters that were off-target.
 */
export const recomputeActivityReactionCounts = async (): Promise<{ recomputed: number }> =>
	await tx(async (q) => {
		const nowMs = Date.now();

		const reconciled = await q<{ activity_key: string }>(
			`insert into activity_reaction_counts (activity_key, count, updated_at_ms)
			 select activity_key, count(*), $1 from activity_reactions group by activity_key
			 on conflict (activity_key) do update set
			   count = excluded.count,
			   updated_at_ms = excluded.updated_at_ms
			 where activity_reaction_counts.count is distinct from excluded.count
			 returning activity_key`,
			[nowMs]
		);

		const zeroed = await q<{ activity_key: string }>(
			`update activity_reaction_counts c
			 set count = 0, updated_at_ms = $1
			 where c.count <> 0
			   and not exists (select 1 from activity_reactions r where r.activity_key = c.activity_key)
			 returning c.activity_key`,
			[nowMs]
		);

		return { recomputed: reconciled.length + zeroed.length };
	});
