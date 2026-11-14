import { Collection } from '#lib/constants/collections.constants.ts';
import { track } from '#lib/services/analytics.services.ts';
import type { Activity, ActivityReaction, ActivityReactionCount } from '#lib/types/social.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	getActivityReactionCounts as getActivityReactionCountsWeb2,
	likeActivity as likeActivityWeb2,
	listActivities as listActivitiesWeb2,
	listActivityReactions as listActivityReactionsWeb2,
	unlikeActivity as unlikeActivityWeb2
} from '#lib/web2/client.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { deleteDoc, getDoc, listDocs, setDoc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Record a failed reaction read as an observable `app_error` event rather than
 * letting it vanish behind a console line. These reads hydrate the global shell
 * at startup, so a silent fallback would mask a persistent misconfiguration
 * (e.g. a read-permission or schema regression) as an empty feed forever; the
 * tracked event keeps the failure (and its rate) visible in the cockpit.
 * `track` is fire-and-forget and never throws, so this can't re-break startup.
 */
const trackReactionReadFailure = ({
	collection,
	operation,
	err
}: {
	collection: string;
	operation: string;
	err: unknown;
}): void => {
	console.error(`Failed to load ${collection} (${operation})`, err);
	track({ name: 'app_error', source: collection, label: operation });
};

/**
 * Cap on the count-on-read reaction scan. One bounded `listDocs` per feed mount tallies likes
 * client-side (see the persistence spec); past this window counts under-report, which is the
 * documented ceiling that the deferred rollup-counter follow-up removes.
 */
export const ACTIVITY_REACTIONS_READ_LIMIT = 1000;

/**
 * The liked activity's own doc key: `${user}#${timestamp}#${type}`, the shape `logActivity` writes.
 * `getGlobalActivities` drops the doc key, so it's reconstructed from the `Activity` fields (the
 * satellite assert guarantees that exact shape). Shared so the service, store, and component agree.
 */
export const activityReactionKey = ({ activity }: { activity: Activity }): string =>
	`${activity.user}#${activity.timestamp}#${activity.type}`;

const reactionDocKey = ({
	activity,
	liker
}: {
	activity: Activity;
	liker: PrincipalText;
}): string => `${activityReactionKey({ activity })}#${liker}`;

export const likeActivity = async ({
	activity,
	liker
}: {
	activity: Activity;
	liker: PrincipalText;
}): Promise<void> => {
	const activityKey = activityReactionKey({ activity });

	// The HTTP route derives the liker from the session (the passed `liker`
	// is that same account id) and maintains the count rollup transactionally
	// with the write; the denormalized title/marketId ride along for the
	// like-received inbox card exactly as on the satellite doc.
	if (isWeb2Backend()) {
		await likeActivityWeb2({
			activityKey,
			timestamp: Date.now(),
			activityTitle: activity.title,
			marketId: activity.marketId
		});

		return;
	}

	await setDoc<ActivityReaction>({
		collection: Collection.ACTIVITY_REACTIONS,
		doc: {
			key: reactionDocKey({ activity, liker }),
			data: {
				activityKey,
				liker,
				timestamp: Date.now(),
				activityTitle: activity.title,
				// Denormalized for the like-received inbox card (spec B); omit when absent rather than
				// persisting an explicit `undefined`.
				...(nonNullish(activity.marketId) ? { marketId: activity.marketId } : {})
			}
		}
	});
};

export const unlikeActivity = async ({
	activity,
	liker
}: {
	activity: Activity;
	liker: PrincipalText;
}): Promise<void> => {
	// Idempotent server-side: unliking an absent row is a clean success,
	// matching the missing-doc early return below.
	if (isWeb2Backend()) {
		await unlikeActivityWeb2({ activityKey: activityReactionKey({ activity }) });

		return;
	}

	const doc = await getDoc<ActivityReaction>({
		collection: Collection.ACTIVITY_REACTIONS,
		key: reactionDocKey({ activity, liker })
	});

	if (isNullish(doc)) {
		return;
	}

	await deleteDoc({
		collection: Collection.ACTIVITY_REACTIONS,
		doc
	});
};

/**
 * The most-recent reactions across all users, bounded by {@link ACTIVITY_REACTIONS_READ_LIMIT}.
 * Counts + the caller's own likes are tallied client-side from this single page (count-on-read).
 *
 * Hydrated at startup by `LoaderGlobalActivities` (global shell, no identity required), so a read
 * failure degrades to an empty page rather than an unhandled rejection: the feed renders without
 * persisted likes. This tolerates the window where a fresh FE bundle is live before its collection
 * config has been applied to the satellite, plus any transient query reject, but the failure is
 * tracked (see {@link trackReactionReadFailure}), never silently swallowed.
 */
export const getActivityReactions = async ({
	limit = ACTIVITY_REACTIONS_READ_LIMIT,
	certified = false
}: { limit?: number; certified?: boolean } = {}): Promise<ActivityReaction[]> => {
	if (limit <= 0) {
		return [];
	}

	try {
		if (isWeb2Backend()) {
			return await listActivityReactionsWeb2({ limit });
		}

		const { items } = await listDocs<ActivityReaction>({
			collection: Collection.ACTIVITY_REACTIONS,
			filter: {
				order: { field: 'created_at', desc: true },
				paginate: { limit }
			},
			options: { certified }
		});

		return items.map(({ data }) => data);
	} catch (err: unknown) {
		trackReactionReadFailure({ collection: Collection.ACTIVITY_REACTIONS, operation: 'list', err });

		return [];
	}
};

/**
 * Cap on the received-reactions scan: likes on the viewer's OWN calls (the like-received inbox
 * source). Scoped to one author's activities by the key prefix, so this is a small set even when the
 * global feed is busy.
 */
export const RECEIVED_REACTIONS_READ_LIMIT = 200;

/**
 * Every like on `author`'s own activities. The reaction doc key is `${author}#${ts}#${type}#${liker}`,
 * so the author (the liked call's owner) is the key prefix; a single key-prefix `listDocs` returns
 * all likes on their calls, bounded and scoped to that author (not the global feed window). Backs
 * the like-received inbox card; `author` is the viewer's principal.
 */
export const getReceivedActivityReactions = async ({
	author,
	limit = RECEIVED_REACTIONS_READ_LIMIT,
	certified = false
}: {
	author: PrincipalText;
	limit?: number;
	certified?: boolean;
}): Promise<ActivityReaction[]> => {
	if (limit <= 0) {
		return [];
	}

	try {
		// No author-scoped reactions read exists on the HTTP API yet, so filter
		// the recent global window by the activity-key author prefix (`author`
		// is the account id there and ids never contain `#`). Same bounded
		// under-reporting as the on-chain window scans on this surface.
		if (isWeb2Backend()) {
			const window = await listActivityReactionsWeb2({ limit: ACTIVITY_REACTIONS_READ_LIMIT });

			return window
				.filter(({ activityKey }) => activityKey.startsWith(`${author}#`))
				.slice(0, limit);
		}

		const { items } = await listDocs<ActivityReaction>({
			collection: Collection.ACTIVITY_REACTIONS,
			filter: {
				// Principal text is `[a-z0-9-]` only, so it carries no regex metacharacters; a bare `^…#`
				// prefix matches exactly the author segment (principals never contain `#`).
				matcher: { key: `^${author}#` },
				order: { field: 'created_at', desc: true },
				paginate: { limit }
			},
			options: { certified }
		});

		return items.map(({ data }) => data);
	} catch (err: unknown) {
		trackReactionReadFailure({
			collection: Collection.ACTIVITY_REACTIONS,
			operation: 'list_received',
			err
		});

		return [];
	}
};

/** Cap on the like-count rollup read for the feed. */
export const ACTIVITY_REACTION_COUNTS_READ_LIMIT = 1000;

/**
 * Per-activity like counts from the server-maintained `activity_reaction_counts` rollup, as a
 * `Map<activityKey, count>`. One bounded read replaces the former count-on-read tally over the
 * reaction page: the count is O(1) per activity regardless of total likes. Ordered by `updated_at`
 * so the most-recently-liked activities (which the feed shows) are within the window. Which of these
 * the viewer liked is still derived separately from the reaction docs.
 */
export const getActivityReactionCounts = async ({
	limit = ACTIVITY_REACTION_COUNTS_READ_LIMIT,
	certified = false
}: { limit?: number; certified?: boolean } = {}): Promise<Map<string, number>> => {
	if (limit <= 0) {
		return new Map();
	}

	try {
		// The HTTP counts read is key-addressed, so derive the keys from the
		// recent activity window first (the feed only renders counts for the
		// activities inside it; 500 is the activity route's list cap). Two
		// requests, same O(1)-per-activity result.
		if (isWeb2Backend()) {
			const activities = await listActivitiesWeb2({ limit: Math.min(limit, 500) });
			const activityKeys = activities.map(
				({ user, timestamp, type }) => `${user}#${timestamp}#${type}`
			);

			if (activityKeys.length === 0) {
				return new Map();
			}

			const counts = await getActivityReactionCountsWeb2({ activityKeys });

			return new Map(counts.map(({ activityKey, count }) => [activityKey, count]));
		}

		const { items } = await listDocs<ActivityReactionCount>({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			filter: {
				order: { field: 'updated_at', desc: true },
				paginate: { limit }
			},
			options: { certified }
		});

		return new Map(items.map(({ data }) => [data.activityKey, data.count]));
	} catch (err: unknown) {
		trackReactionReadFailure({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			operation: 'list',
			err
		});

		return new Map();
	}
};
