import { Collection } from '#lib/constants/collections.constants.ts';
import { USER_STATS_RECENT_LIMIT, type UserStatsDoc } from '#lib/types/user-stats.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `user_stats`. The collection caches the
 * caller's Dash aggregates — per-category accuracy + recent
 * settlements. Writes are scoped to one's own row.
 *
 *  1. **Collection scope.** No-op for any other collection.
 *  2. **Key shape.** Doc key must equal the embedded `owner`
 *     principal — a single canonical row per user.
 *  3. **Owner binds caller.** Only the user themselves can write
 *     their dashboard cache (mirrors the affiliation-stats and
 *     league-stats invariants).
 *  4. **Counters non-negative.** Sanity: `calls` and `wins` per
 *     category must be ≥ 0, and `wins ≤ calls`.
 *  5. **Recent list bounded.** The recent-settlement array can't
 *     grow past {@link USER_STATS_RECENT_LIMIT} so a malicious or
 *     buggy writer can't bloat the doc.
 */
export const assertSetUserStats = ({
	caller,
	data: {
		collection,
		key,
		data: { proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.USER_STATS) {
		return;
	}

	const proposedDoc = decodeDocData<UserStatsDoc>(proposed.data);

	if (key !== proposedDoc.owner) {
		throw new Error(`user_stats key "${key}" must match embedded owner "${proposedDoc.owner}".`);
	}

	try {
		Principal.fromText(proposedDoc.owner);
	} catch {
		throw new Error('user_stats owner must be a valid principal text.');
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	if (proposedDoc.owner !== callerText) {
		throw new Error('user_stats owner must match the caller principal.');
	}

	for (const [tag, bucket] of Object.entries(proposedDoc.categoryStats)) {
		if (bucket.calls < 0 || bucket.wins < 0) {
			throw new Error(`user_stats categoryStats[${tag}] counters must be non-negative.`);
		}

		if (bucket.wins > bucket.calls) {
			throw new Error(`user_stats categoryStats[${tag}] wins cannot exceed calls.`);
		}
	}

	if (proposedDoc.recentSettlements.length > USER_STATS_RECENT_LIMIT) {
		throw new Error(
			`user_stats recentSettlements length (${proposedDoc.recentSettlements.length}) exceeds limit ${USER_STATS_RECENT_LIMIT}.`
		);
	}

	// Per-settlement realized payout is a finite, non-negative VXP amount
	// (the Oracle insight only ever surfaces a win's "+{vxp} VXP"), and the
	// contrarian flag must be a real boolean. This doc is user-writable, so
	// reject missing / non-numeric / non-finite vxp and non-boolean flags
	// before a corrupt row can reach the UI.
	for (const settlement of proposedDoc.recentSettlements) {
		if (
			typeof settlement.vxp !== 'number' ||
			!Number.isFinite(settlement.vxp) ||
			settlement.vxp < 0
		) {
			throw new Error('user_stats recentSettlements vxp must be a finite non-negative number.');
		}

		if (typeof settlement.contrarian !== 'boolean') {
			throw new Error('user_stats recentSettlements contrarian must be a boolean.');
		}
	}
};
