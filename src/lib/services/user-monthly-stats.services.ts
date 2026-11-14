import type * as ClearingDid from '#declarations/clearing/clearing.d.ts';
import { functions } from '#declarations/satellite/satellite.api.ts';
import { ZERO } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	MONTHLY_CONSENSUS_LIMIT,
	userMonthlyStatsKey,
	type UserMonthlyStatsDoc
} from '#lib/types/user-monthly-stats.ts';
import { monthAnchorFromMs, previousMonthAnchor } from '#lib/utils/month-anchor.utils.ts';
import { eventExecutionPrice, isSettledEvent } from '#lib/utils/resolved-position.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { getDoc, setDoc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

/**
 * FE service for the per-user, per-month gameplay stats that back the two
 * monthly album awards (sharpest-eye, bold-caller).
 *
 * Populate approach: CLIENT-WRITE (chosen over an `onProfileSet` hook):
 * `calculateAndSyncStats` already fetches the user's full clearing history,
 * so it re-derives each month's counters + consensus samples here and
 * persists them to the caller's own `USER_MONTHLY_STATS[${owner}/${YYYY-MM}]`
 * row. This mirrors the proven `USER_STATS` client-write + assert pattern.
 * Juno has no scheduler, so the month rollover is lazy: a new month's doc is
 * simply written under a new key the first time a sync runs in that month,
 * and `getMonthlyLeaderboard` aggregates whatever docs exist for the
 * requested month.
 *
 * Integrity trade-off: the satellite assert (`assertSetUserMonthlyStats`)
 * restricts writes to the caller's own row and enforces structural sanity
 * (`monthWins <= monthCalls`, bounded consensus array, values in [0, 1]), but
 * it does NOT re-derive the counters from real history; a determined user
 * could inflate their own monthly numbers. The award carries no VXP payout
 * (cosmetic album tile), so this matches the existing `user_stats` posture
 * rather than warranting a server-side recompute.
 */

interface MonthBucket {
	monthCalls: number;
	monthWins: number;
	/** Consensus-at-call prices, newest first (so the cap keeps recent values). */
	consensus: number[];
}

/**
 * Bucket the user's settled clearing history by calendar month (UTC),
 * computing per-month calls / wins and the consensus-at-call price for each
 * settled call. A settled event's `price` is the price the user took their
 * side at: the same value the `contrarian` achievement reads as the
 * consensus-at-call. Pure: no IO.
 */
export const bucketMonthlyStats = (history: ClearingDid.Event[]): Record<string, MonthBucket> => {
	const settled = history
		.filter(isSettledEvent)
		// Newest first so, once a month's consensus array hits the cap, the
		// retained samples are the most recent calls.
		.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

	const buckets: Record<string, MonthBucket> = {};

	for (const event of settled) {
		const settledAtMs = Number(event.timestamp / 1_000_000n);
		const anchor = monthAnchorFromMs(settledAtMs);

		const bucket = (buckets[anchor] ??= { monthCalls: 0, monthWins: 0, consensus: [] });

		bucket.monthCalls += 1;

		if (event.qty > ZERO) {
			bucket.monthWins += 1;
		}

		if (bucket.consensus.length < MONTHLY_CONSENSUS_LIMIT) {
			const price = eventExecutionPrice(event);

			// Skip non-finite prices (NaN / ±Infinity from a malformed event)
			// before clamping: Math.max/min leave NaN intact, so we'd otherwise
			// push NaN into the consensus array and corrupt the median.
			if (Number.isFinite(price)) {
				// Clamp into [0, 1]: the assert rejects out-of-range values, and a
				// consensus price is a probability by construction.
				bucket.consensus.push(Math.max(0, Math.min(1, price)));
			}
		}
	}

	return buckets;
};

/**
 * Persist the caller's monthly-stats doc for `monthAnchor`. Read-modify-write
 * so the version stamp stays in lockstep with the datastore. Safe to call on
 * every sync.
 */
const persistMonth = async (doc: UserMonthlyStatsDoc): Promise<void> => {
	const key = userMonthlyStatsKey({ owner: doc.owner, monthAnchor: doc.monthAnchor });
	const existing = await getDoc<UserMonthlyStatsDoc>({
		collection: Collection.USER_MONTHLY_STATS,
		key
	});

	await setDoc<UserMonthlyStatsDoc>({
		collection: Collection.USER_MONTHLY_STATS,
		doc: {
			key,
			data: doc,
			version: existing?.version
		}
	});
};

/**
 * Re-derive and persist the caller's monthly-stats docs from clearing
 * history. To keep the write count bounded (and because only the current and
 * just-closed months matter for the live + most-recent awards) we persist at
 * most the current month and the prior month's docs. Returns the set of
 * month anchors that were written so the caller can evaluate award placement
 * for the just-closed month.
 *
 * Best-effort per month: a failed write is logged and skipped so one month's
 * failure doesn't abort the wider profile sync.
 */
export const syncMyMonthlyStats = async ({
	owner,
	history,
	nowMs
}: {
	owner: PrincipalText;
	history: ClearingDid.Event[];
	nowMs: number;
}): Promise<{ currentAnchor: string; priorAnchor: string }> => {
	const buckets = bucketMonthlyStats(history);

	const currentAnchor = monthAnchorFromMs(nowMs);
	const priorAnchor = previousMonthAnchor(nowMs);

	// Persist only months with resolved calls: there's nothing to rank in an
	// empty month and no reason to write an empty row.
	const monthsToWrite = [currentAnchor, priorAnchor].filter((anchor) => {
		const bucket = buckets[anchor];

		return nonNullish(bucket) && bucket.monthCalls > 0;
	});

	for (const anchor of monthsToWrite) {
		const bucket = buckets[anchor];

		try {
			await persistMonth({
				owner,
				monthAnchor: anchor,
				monthCalls: bucket.monthCalls,
				monthWins: bucket.monthWins,
				monthConsensus: bucket.consensus,
				updatedAtMs: nowMs
			});
		} catch (err: unknown) {
			console.error(`syncMyMonthlyStats: failed to persist ${anchor}`, err);
		}
	}

	return { currentAnchor, priorAnchor };
};

/**
 * Result of evaluating the caller's standing in a completed month's monthly
 * leaderboard. `sharpestEyeTier` is the gold/silver/bronze tier the caller
 * placed at (or `undefined` if not top-3); `wonBoldCaller` is whether the
 * caller won (or tied for) that month's bold-caller award.
 */
export interface MonthlyAwardStanding {
	sharpestEyeTier?: 'gold' | 'silver' | 'bronze';
	wonBoldCaller: boolean;
}

const PLACEMENT_TIER: Record<number, 'gold' | 'silver' | 'bronze'> = {
	1: 'gold',
	2: 'silver',
	3: 'bronze'
};

/**
 * Read the completed month's leaderboard and resolve the caller's award
 * standing. Best-effort: a failed read resolves to "no placement" so a
 * transient error never rescinds an already-persisted tier (unlocks are
 * sticky on the profile side).
 */
export const evaluateMonthlyAwards = async ({
	owner,
	monthAnchor
}: {
	owner: PrincipalText;
	monthAnchor: string;
}): Promise<MonthlyAwardStanding> => {
	try {
		const { items, boldCallers } = await functions.getMonthlyLeaderboard({ monthAnchor });

		const podium = items.find((entry) => entry.owner === owner);
		const sharpestEyeTier = podium ? PLACEMENT_TIER[podium.placement] : undefined;
		const wonBoldCaller = boldCallers.some((entry) => entry.owner === owner);

		return { sharpestEyeTier, wonBoldCaller };
	} catch (err: unknown) {
		console.error('evaluateMonthlyAwards: failed to read monthly leaderboard', err);

		return { wonBoldCaller: false };
	}
};

/**
 * Tier rank for "keep the best" comparisons: higher wins.
 */
const TIER_RANK: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };

/**
 * Returns the better of two sharpest-eye tiers (gold > silver > bronze).
 * `undefined` inputs are treated as "no tier"; when both are absent the
 * result is `undefined`. Used to keep the profile's `sharpestEyeBestTier`
 * monotonic so a worse later placement never demotes the best ever.
 */
export const bestSharpestEyeTier = ({
	current,
	candidate
}: {
	current: string | undefined;
	candidate: string | undefined;
}): string | undefined => {
	const rankCurrent = current ? (TIER_RANK[current] ?? 0) : 0;
	const rankCandidate = candidate ? (TIER_RANK[candidate] ?? 0) : 0;

	return rankCurrent >= rankCandidate ? current : candidate;
};
