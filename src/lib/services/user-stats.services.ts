import type * as ClearingDid from '#declarations/clearing/clearing.d.ts';
import { USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { MACRO_IDS, primaryMacro, type MacroId } from '#lib/constants/market-taxonomy.constants.ts';
import type { MarketMetadata } from '#lib/types/market-metadata.ts';
import {
	USER_STATS_RECENT_LIMIT,
	type CategoryStatsBucket,
	type RecentSettlementSnapshot,
	type UserStatsDoc
} from '#lib/types/user-stats.ts';
import { CONTRARIAN_PRICE_THRESHOLD } from '#lib/utils/achievements.utils.ts';
import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
import { eventExecutionPrice, isSettledEvent } from '#lib/utils/resolved-position.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { getUserStats as getUserStatsWeb2 } from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';
import { getDoc, setDoc } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

/**
 * FE service for the per-user dashboard cache. The cache is computed
 * from the user's clearing history + the in-memory market-metadata
 * store, then persisted to the `USER_STATS` collection so subsequent
 * Dash mounts can read it in a single `getDoc`.
 *
 * Compute path:
 *  1. `calculateAndSyncStats` finishes aggregating wins / totals.
 *  2. It hands the same `history` array to `computeUserStatsSnapshot`
 *     along with the market-metadata map.
 *  3. The result is `setDoc`'d under `USER_STATS[principal]`. The
 *     satellite assert restricts writes to the principal themselves,
 *     so the user can only update their own row.
 *
 * Read path:
 *  - `loadMyUserStats(principal)` resolves to `UserStatsDoc | undefined`.
 *    Returns `undefined` when no doc exists yet (the very first sync
 *    hasn't run).
 *
 * Slight refresh delay (per the design decision) — the Dash reads
 * whatever the last sync persisted; a market resolving moments before
 * mount won't show up until the next sync completes. Acceptable
 * trade-off for instant page loads.
 */

const emptyCategoryStats = (): Record<string, CategoryStatsBucket> => {
	const out: Record<string, CategoryStatsBucket> = {};

	for (const macro of MACRO_IDS) {
		out[macro] = { calls: 0, wins: 0 };
	}

	return out;
};

const macroForSeries = ({
	seriesId,
	metadata
}: {
	seriesId: string;
	metadata: Record<string, MarketMetadata> | undefined;
}): MacroId | '' => {
	const meta = metadata?.[seriesId];

	if (isNullish(meta)) {
		return '';
	}

	return primaryMacro(meta.tags) ?? '';
};

/**
 * Realized VXP for a single settlement — the signed cashflow the clearing
 * `Settled` event carries on its `qty` field, in `USD_DECIMALS` base units
 * (see `settledEventToResolvedPosition` and the `ResolvedPosition` docs).
 * Clamped to ≥ 0 so only a win's positive payout reaches the Oracle insight.
 *
 * Kept at full precision (no rounding) — a heavy-favourite win clears for a
 * real sub-1 VXP amount (the cashflow itself is below one point), and
 * rounding here would zero it before the Oracle insight headline ever sees
 * it ("+0 VXP"). The display layer rounds via `formatWholeVxpMagnitude`,
 * which surfaces a sub-1 win as `<1`.
 */
const settlementVxp = (event: ClearingDid.Event): number =>
	Math.max(0, decimalFixedValueToNumber({ value: event.qty, decimals: USD_DECIMALS }));

/**
 * Build a `UserStatsDoc` payload from raw clearing history plus the
 * in-memory market-metadata map. Pure function — no IO.
 *
 *  - `calls` per category = settled trades where the user took a
 *    position in a market of that tag.
 *  - `wins` per category = settled trades the user won (qty > 0).
 *  - `recentSettlements` = the last {@link USER_STATS_RECENT_LIMIT}
 *    settlement events in chronological-descending order.
 */
export const computeUserStatsSnapshot = ({
	owner,
	history,
	metadata,
	nowMs
}: {
	owner: PrincipalText;
	history: ClearingDid.Event[];
	metadata: Record<string, MarketMetadata> | undefined;
	nowMs: number;
}): UserStatsDoc => {
	const categoryStats = emptyCategoryStats();

	const settled = history.filter(isSettledEvent);

	for (const event of settled) {
		const macro = macroForSeries({ seriesId: event.series_id, metadata });

		// Skip untagged markets (they aren't in any category bucket);
		// the categories tile only renders the known macros anyway.
		if (macro !== '') {
			const bucket = categoryStats[macro];
			bucket.calls += 1;

			if (event.qty > ZERO) {
				bucket.wins += 1;
			}
		}
	}

	// Recent settlements — newest first.
	const recentSettlements: RecentSettlementSnapshot[] = [...settled]
		.sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
		.slice(0, USER_STATS_RECENT_LIMIT)
		.map((event) => {
			const win = event.qty > ZERO;

			return {
				marketId: event.series_id,
				tag: macroForSeries({ seriesId: event.series_id, metadata }),
				win,
				settledAtMs: Number(event.timestamp / 1_000_000n),
				vxp: settlementVxp(event),
				// Contrarian = a win the market priced as a long shot (the
				// user's side cleared at ≤ the long-shot threshold), i.e. they
				// were right against the crowd. Same rule the `contrarian`
				// achievement counts on.
				contrarian: win && eventExecutionPrice(event) <= CONTRARIAN_PRICE_THRESHOLD
			};
		});

	return {
		owner,
		categoryStats,
		recentSettlements,
		computedAtMs: nowMs
	};
};

/**
 * Persist a `UserStatsDoc` snapshot for the caller. Performs a
 * read-modify-write so the version stamp stays in lockstep with the
 * datastore; safe to call from `calculateAndSyncStats` on every
 * sync.
 *
 * Failures are logged and rethrown — the caller (`calculateAndSyncStats`)
 * already runs in a try/catch shape that surfaces partial failures
 * without aborting the wider profile sync.
 */
export const persistMyUserStats = async (snapshot: UserStatsDoc): Promise<void> => {
	const existing = await getDoc<UserStatsDoc>({
		collection: Collection.USER_STATS,
		key: snapshot.owner
	});

	await setDoc<UserStatsDoc>({
		collection: Collection.USER_STATS,
		doc: {
			key: snapshot.owner,
			data: snapshot,
			version: existing?.version
		}
	});
};

/**
 * Load the caller's dashboard cache. Returns `undefined` when no
 * snapshot exists yet — the FE renders a "pull-to-refresh" hint in
 * that branch.
 */
export const loadMyUserStats = async (
	principal: PrincipalText
): Promise<UserStatsDoc | undefined> => {
	if (isWeb2Backend()) {
		return getUserStatsWeb2();
	}

	const doc = await getDoc<UserStatsDoc>({
		collection: Collection.USER_STATS,
		key: principal
	});

	return doc?.data;
};
