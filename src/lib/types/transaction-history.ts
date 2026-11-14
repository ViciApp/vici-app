import type { MarketId } from '#lib/types/market.ts';

/**
 * Award tag decoded from a bonus transfer's ledger memo
 * (`vxp:<tag>:<key>`, written by the satellite payout helper in
 * `src/satellite/services/vxp-payout.services.ts`). `unknown` covers transfers
 * that predate the memo format or carry an unrecognized tag; they still
 * render as a generic reward rather than disappearing.
 */
export type TransactionHistoryBonusTag =
	| 'achievement'
	| 'calibration'
	| 'comeback'
	| 'league_founder'
	| 'new-user'
	| 'referral'
	| 'streak'
	| 'tournament_prize'
	| 'worlds_podium'
	| 'unknown';

export type TransactionHistoryKind =
	| 'bonus'
	| 'prediction'
	| 'won'
	| 'lost'
	| 'neutral'
	| 'liquidation'
	| 'received'
	| 'sent'
	| 'minted'
	| 'burned'
	/** Synthetic genesis marker: the account's zero-VXP starting point. */
	| 'joined';

export interface TransactionHistoryRow {
	id: string;
	kind: TransactionHistoryKind;
	/** Only set for `bonus` rows. */
	bonusTag?: TransactionHistoryBonusTag;
	/** Only set for clearing-sourced rows. */
	marketId?: MarketId;
	timestampNs: bigint;
	/**
	 * Signed total-VXP delta, clearing-margin base units. Zero for
	 * `prediction` rows: a fill reserves the user's own VXP without
	 * changing what they own.
	 */
	delta: bigint;
	/**
	 * Stake context for `prediction` rows: the margin moved into play by
	 * the fill (display only; the total-balance delta is zero).
	 */
	stake?: bigint;
	/** Running total balance after this event, clearing-margin units. */
	balance: bigint;
}

export type TransactionHistoryFilter = 'all' | 'predictions' | 'results' | 'bonuses';
