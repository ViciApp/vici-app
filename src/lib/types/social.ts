import type { ActivityType } from '#lib/enums/social.ts';
import type { PrincipalText } from '@junobuild/schema';

export interface Activity {
	type: ActivityType;
	user: PrincipalText;
	targetUser?: PrincipalText;
	marketId?: string;
	title: string;
	details?: string;
	timestamp: number;
}

/**
 * A single like on a friend-feed activity. One doc per `(activity, liker)` in the
 * `activity_reactions` collection, keyed `${actor}#${timestamp}#${type}#${liker}`: the liked
 * activity's doc key (see `logActivity`) plus the liker. `activityTitle` / `marketId` are
 * denormalized copies of the liked activity's fields, written so the like-received inbox card can
 * render without re-fetching the activity; spec A (counts + persistence) doesn't read them.
 */
export interface ActivityReaction {
	activityKey: string;
	liker: PrincipalText;
	timestamp: number;
	activityTitle: string;
	marketId?: string;
}

/**
 * Upper bound on the denormalized `activityTitle` an `activity_reactions` doc may carry: enforced
 * by `assertSetActivityReaction` so a liker can't bloat the doc with an oversized title.
 */
export const ACTIVITY_REACTION_TITLE_MAX_LENGTH = 500;

/**
 * Per-activity like-count rollup doc (collection `activity_reaction_counts`), keyed by the activity
 * doc key (`${author}#${timestamp}#${type}` = a reaction's `activityKey`). Maintained server-side by
 * the reaction hooks; read by the feed to render the like count in O(1) instead of tallying the
 * reaction page. `count` is floored at 0.
 */
export interface ActivityReactionCount {
	activityKey: string;
	count: number;
	updatedAtMs: number;
}

/**
 * Per-participant resolved-result row (collection `resolved_results`), one per `(owner, market)`
 * resolved call, keyed `${owner}#${marketId}`. Written server-side at resolution time by the
 * satellite hook from the clearing settlement plan (controllers-write), so a user cannot forge it.
 * Read friend-scoped by the digest consumer over an owner-prefix scan.
 *
 * `netVxp` is the participant's realized net cashflow in `USD_DECIMALS` base units, signed (negative
 * for a loss); `outcome` mirrors its sign. `side` is the market outcome the participant held (the
 * settlement outcome id, or `YES`/`NO` derived from a binary net position). `resolvedAtMs` is the
 * resolution time in epoch milliseconds: the retention cleanup prunes on it.
 */
export interface ResolvedResult {
	owner: PrincipalText;
	marketId: string;
	title: string;
	side: string;
	outcome: 'win' | 'loss';
	netVxp: number;
	resolvedAtMs: number;
}
