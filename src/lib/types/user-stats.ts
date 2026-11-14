import type { PrincipalText } from '@junobuild/schema';

/**
 * Per-category accuracy bucket. The Dash renders one of these per
 * market category the user has called on.
 */
export interface CategoryStatsBucket {
	calls: number;
	wins: number;
}

/**
 * Compact snapshot of one settled call. The Dash's "Past history"
 * tile renders these in chronological order.
 */
export interface RecentSettlementSnapshot {
	/** Series / market id the user called on. */
	marketId: string;
	/**
	 * Market category key: the primary macro of the market's taxonomy
	 * (see `primaryMacro`). `''` if the market carries no classifying micro.
	 * Kept as an open `string` while the frontend transitions from the legacy
	 * flat tags to the macro/micro taxonomy.
	 */
	tag: string;
	/** `true` if the user's side matched the resolved outcome. */
	win: boolean;
	/** UTC ms timestamp of the settlement event. */
	settledAtMs: number;
	/**
	 * Realized VXP for this settlement: the clearing `Settled` event's
	 * signed `qty` (the realized cashflow, in `USD_DECIMALS` units), clamped
	 * to `≥ 0` so only a win's positive payout is carried. Stored at full
	 * precision; the Oracle insight rounds for display via
	 * `formatWholeVxpMagnitude` (a sub-1 favourite win reads "<1"), so this
	 * is no longer pre-rounded to a whole number.
	 */
	vxp: number;
	/**
	 * `true` when the user took this side against the crowd: a win whose
	 * execution price priced their side as a long shot (≤
	 * `CONTRARIAN_PRICE_THRESHOLD`). Lets the Oracle insight tag the call
	 * a "contrarian win" vs a plain "best call". Mirrors the long-shot
	 * rule the `contrarian` achievement counts on.
	 */
	contrarian: boolean;
}

/**
 * Per-user dashboard cache. Stored under `USER_STATS` keyed by the
 * caller's principal. The FE writes this from `calculateAndSyncStats`
 * after re-aggregating the user's clearing history.
 *
 * `categoryStats` is keyed by market category (macro id); missing
 * categories render as "0 calls" on the Dash. `recentSettlements` is capped at
 * {@link USER_STATS_RECENT_LIMIT} so the doc stays bounded.
 */
export interface UserStatsDoc {
	owner: PrincipalText;
	categoryStats: Record<string, CategoryStatsBucket>;
	recentSettlements: RecentSettlementSnapshot[];
	/** UTC ms timestamp of the last sync. Lets the FE show "as of …". */
	computedAtMs: number;
}

/**
 * Recent-settlements cap. 10 fits the Dash history tile comfortably
 * and keeps the doc payload tight (~600 bytes worst case).
 */
export const USER_STATS_RECENT_LIMIT = 10;
