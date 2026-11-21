import { Collection } from '#lib/constants/collections.constants.ts';
import type { ActivityReactionCount } from '#lib/types/social.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import {
	type KeysetWalk,
	type KeysetWalkArgs,
	walkKeysetPage
} from '#satellite/services/keyset-walk.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { OnDeleteDocContext, OnSetDocContext } from '@junobuild/functions';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	countDocsStore,
	decodeDocData,
	encodeDocData,
	getDocStore,
	setDocStore
} from '@junobuild/functions/sdk';

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
			updatedAtMs: timeMs()
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
 * Decrement the liked activity's counter (floored at 0) for a removed reaction. Hooks do not run
 * for a serverless `deleteDocStore`, so a satellite path that deletes reactions calls this itself.
 */
export const releaseReactionCount = (reactionKey: string): void => {
	const activityKey = activityKeyFromReactionKey(reactionKey);

	if (nonNullish(activityKey)) {
		bumpCount({ activityKey, delta: -1 });
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

	releaseReactionCount(key);
};

/**
 * How many counter docs one `recomputeActivityReactionCounts` call rewrites. Each rewrite is a
 * serverless write costing billions of instructions, so a call stays a few writes under the update
 * limit and the repair goes in rounds (see the bulk-rewrite budget note in
 * docs/ai/satellite/patterns.md).
 */
const RECOMPUTE_REACTION_COUNTS_BATCH = 5;

/** The exact like count of an activity: its reaction docs, keyed `${activityKey}#${liker}`. */
const countReactions = ({ activityKey, admin }: { activityKey: string; admin: Uint8Array }) =>
	Number(
		countDocsStore({
			collection: Collection.ACTIVITY_REACTIONS,
			caller: admin,
			params: { matcher: { key: `^${escapeRegex(activityKey)}#[^#]+$` } }
		})
	);

/**
 * The repair walks two collections in turn, so its cursor names the phase: `counts:` + a counter
 * key while it reconciles the existing counters, then `reactions:` + a reaction key while it creates
 * the counters missing for liked activities. The operator only passes it back.
 */
const COUNTS_PHASE = 'counts:';
const REACTIONS_PHASE = 'reactions:';

/**
 * Admin-only corrective: re-derive activities' exact like counts from `activity_reactions` and
 * overwrite the off-target counter docs, at most {@link RECOMPUTE_REACTION_COUNTS_BATCH} per call.
 * Heals any drift from a concurrent-like version race and backfills counts for likes that predate
 * the rollup hooks. Admin-gated (mirrors `sweepExpiredDeletions`).
 *
 * One call reads one keyset page ({@link walkKeysetPage}, at most `limit` docs) of one phase: first
 * the counter docs, each checked against its exact count (a counter whose activity has no like left
 * goes to 0), then the reaction docs, creating the counter of any liked activity that has none.
 * Returns how many counters it wrote and where it left off; the operator passes `nextAfterKey` back
 * as `afterKey` until `done`.
 */
export const recomputeActivityReactionCountsFn = ({ afterKey, limit }: KeysetWalkArgs = {}): {
	recomputed: number;
} & KeysetWalk => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Only an admin can recompute reaction counts.');
	}

	const admin = adminCaller();
	const now = timeMs();
	let recomputed = 0;

	const writeCount = ({
		activityKey,
		count,
		version
	}: {
		activityKey: string;
		count: number;
		version: bigint | undefined;
	}) => {
		const next: ActivityReactionCount = { activityKey, count, updatedAtMs: now };

		setDocStore({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: activityKey,
			caller: admin,
			doc: { data: encodeDocData(next), version }
		});

		recomputed += 1;
	};

	if (afterKey?.startsWith(REACTIONS_PHASE) === true) {
		const walk = walkKeysetPage({
			collection: Collection.ACTIVITY_REACTIONS,
			caller: admin,
			afterKey: afterKey.slice(REACTIONS_PHASE.length),
			limit,
			visit: ([reactionKey]) => {
				// The activity key comes from the doc KEY, not the payload, so a malformed reaction body
				// doesn't drop a like from the exact recount (the key shape is assert-enforced on write).
				const activityKey = activityKeyFromReactionKey(reactionKey);

				if (
					isNullish(activityKey) ||
					nonNullish(
						getDocStore({
							collection: Collection.ACTIVITY_REACTION_COUNTS,
							key: activityKey,
							caller: admin
						})
					)
				) {
					return 'kept';
				}

				if (recomputed >= RECOMPUTE_REACTION_COUNTS_BATCH) {
					return 'stop';
				}

				writeCount({
					activityKey,
					count: countReactions({ activityKey, admin }),
					version: undefined
				});

				return 'kept';
			}
		});

		return {
			recomputed,
			nextAfterKey: walk.done ? undefined : `${REACTIONS_PHASE}${walk.nextAfterKey ?? ''}`,
			done: walk.done
		};
	}

	const walk = walkKeysetPage({
		collection: Collection.ACTIVITY_REACTION_COUNTS,
		caller: admin,
		afterKey:
			afterKey?.startsWith(COUNTS_PHASE) === true ? afterKey.slice(COUNTS_PHASE.length) : '',
		limit,
		visit: ([activityKey, item]) => {
			const target = countReactions({ activityKey, admin });
			let current: number | undefined;

			try {
				current = decodeDocData<ActivityReactionCount>(item.data).count;
			} catch {
				// Malformed counter doc: don't let it abort the repair; treat as needing a rewrite.
				current = undefined;
			}

			if (current === target) {
				return 'kept';
			}

			if (recomputed >= RECOMPUTE_REACTION_COUNTS_BATCH) {
				return 'stop';
			}

			writeCount({ activityKey, count: target, version: item.version });

			return 'kept';
		}
	});

	return {
		recomputed,
		nextAfterKey: walk.done ? REACTIONS_PHASE : `${COUNTS_PHASE}${walk.nextAfterKey ?? ''}`,
		done: false
	};
};
