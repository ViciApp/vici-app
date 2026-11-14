import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import type { ActivityReactionCount } from '#lib/types/social.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { OnDeleteDocContext, OnSetDocContext } from '@junobuild/functions';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

const nowMs = (): number => Number(time() / MILLISECOND_IN_NANOSECONDS);

/**
 * A satellite controller principal, used as the `caller` for writes to the controllers-scoped
 * `activity_reaction_counts` collection: the liker is not a controller, so the counter is moved as
 * an admin (the `*DocStore` APIs enforce the collection rule against the caller they're given).
 */
const adminCaller = (): Uint8Array => controllerCaller('reaction-count rollup');

/**
 * The liked activity's doc key from a reaction doc key. A reaction is keyed
 * `${author}#${timestamp}#${type}#${liker}` (see `assertSetActivityReaction`), so the activity key
 * is the first three `#`-segments. Returns `undefined` for a malformed key (defensive: the assert
 * already enforces the shape on write).
 */
const activityKeyFromReactionKey = (reactionKey: string): string | undefined => {
	const parts = reactionKey.split('#');

	return parts.length === 4 ? parts.slice(0, 3).join('#') : undefined;
};

/**
 * Move an activity's like counter by `delta`, floored at 0. Version-locked read-modify-write as
 * admin. Best-effort: a rare version race under concurrent likes on the same activity is logged and
 * swallowed (the reaction doc is the source of truth, and the admin `recomputeActivityReactionCounts`
 * endpoint re-derives exact counts), mirroring the analytics rollup's bump.
 */
const bumpCount = ({ activityKey, delta }: { activityKey: string; delta: number }): void => {
	try {
		const admin = adminCaller();

		const existing = getDocStore({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: activityKey,
			caller: admin
		});

		const current = isNullish(existing)
			? 0
			: decodeDocData<ActivityReactionCount>(existing.data).count;

		const next: ActivityReactionCount = {
			activityKey,
			count: Math.max(0, current + delta),
			updatedAtMs: nowMs()
		};

		setDocStore({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: activityKey,
			caller: admin,
			doc: {
				data: encodeDocData(next),
				version: existing?.version
			}
		});
	} catch (err: unknown) {
		logError({
			message: 'reaction_count_bump_failed',
			detail: { activityKey, delta, error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

/**
 * `onSetDoc` for `activity_reactions`: increment the activity's like counter, but only on a genuine
 * CREATE (`before` absent). An update (a re-`setDoc` of an existing like) leaves the count unchanged,
 * so a double-like can't double-count.
 */
export const onActivityReactionSet = (ctx: OnSetDocContext): void => {
	const {
		data: {
			collection,
			key,
			data: { before }
		}
	} = ctx;

	if (collection !== Collection.ACTIVITY_REACTIONS || nonNullish(before)) {
		return;
	}

	const activityKey = activityKeyFromReactionKey(key);

	if (nonNullish(activityKey)) {
		bumpCount({ activityKey, delta: 1 });
	}
};

/**
 * `onDeleteDoc` for `activity_reactions`: decrement the activity's like counter (floored at 0) when
 * a like is removed (an unlike).
 */
export const onActivityReactionDelete = (ctx: OnDeleteDocContext): void => {
	const {
		data: { collection, key }
	} = ctx;

	if (collection !== Collection.ACTIVITY_REACTIONS) {
		return;
	}

	const activityKey = activityKeyFromReactionKey(key);

	if (nonNullish(activityKey)) {
		bumpCount({ activityKey, delta: -1 });
	}
};

/**
 * Admin-only corrective: re-derive every activity's exact like count from `activity_reactions` and
 * overwrite the counter docs. Heals any drift from a concurrent-like version race and backfills
 * counts for likes that predate the rollup hooks. Admin-gated (mirrors `sweepExpiredDeletions`).
 *
 * Single pass over both collections: fine at current volume; a very large reaction set would want
 * pagination (noted as the scale caveat in the spec).
 */
export const recomputeActivityReactionCountsFn = (): { recomputed: number } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Only an admin can recompute reaction counts.');
	}

	const admin = adminCaller();

	// Tally exact like counts per activity from the reaction docs.
	const { items: reactionItems } = listDocsStore({
		collection: Collection.ACTIVITY_REACTIONS,
		caller: admin,
		params: {}
	});

	const tally = new Map<string, number>();

	for (const [reactionKey] of reactionItems) {
		// Derive the activity key from the doc KEY, not the payload, so a malformed reaction body
		// doesn't drop a like from the exact recount (the key shape is assert-enforced on write).
		const activityKey = activityKeyFromReactionKey(reactionKey);

		if (nonNullish(activityKey)) {
			tally.set(activityKey, (tally.get(activityKey) ?? 0) + 1);
		}
	}

	// Reconcile every counter doc to its exact tally, including existing docs whose activity now has
	// zero likes (set to 0 so a drifted-up count is corrected down).
	const { items: countItems } = listDocsStore({
		collection: Collection.ACTIVITY_REACTION_COUNTS,
		caller: admin,
		params: {}
	});

	const keys = new Set<string>(tally.keys());

	for (const [countKey] of countItems) {
		keys.add(countKey);
	}

	const now = nowMs();
	let recomputed = 0;

	for (const activityKey of keys) {
		const existing = getDocStore({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: activityKey,
			caller: admin
		});

		const target = tally.get(activityKey) ?? 0;

		let current: number | undefined;

		if (nonNullish(existing)) {
			try {
				current = decodeDocData<ActivityReactionCount>(existing.data).count;
			} catch {
				// Malformed counter doc: don't let it abort the repair; treat as needing a rewrite.
				current = undefined;
			}
		}

		// Only write docs that are off-target: skip the ones already exact.
		if (current !== target) {
			const next: ActivityReactionCount = { activityKey, count: target, updatedAtMs: now };

			setDocStore({
				collection: Collection.ACTIVITY_REACTION_COUNTS,
				key: activityKey,
				caller: admin,
				doc: {
					data: encodeDocData(next),
					version: existing?.version
				}
			});

			recomputed += 1;
		}
	}

	return { recomputed };
};
