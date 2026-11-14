import type { Principal } from '@icp-sdk/core/principal';

/**
 * Categories of server-fired VXP award. Each maps to a separate satellite
 * trigger:
 *
 *  - `streak`: daily-call streak hits a milestone (3 / 7 / 14 / 30).
 *  - `calibration`: recovering user (available balance below the
 *                      recovery floor) correctly called a finalised Vici
 *                      binary market. One reward per market.
 *  - `referral`: referrer is credited on a referee's onboarding
 *                      completion. Capped per calendar month.
 *  - `worlds_podium`: recipient's school finished top-3 in the monthly
 *                      battle. Awarded at month rollover.
 *  - `achievement`: an Album achievement was unlocked for the first
 *                      time; mints the achievement's catalog XP value as
 *                      real VXP. One-time per account (the
 *                      `unlockedAchievements` array is append-only).
 *  - `comeback`: one-time top-up for a returning user whose stack
 *                      ran dry (away ≥ N days, balance below the floor).
 *  - `flow_milestone`: user's lifetime call count crossed a volume
 *                      milestone (10 / 100 / 500 / 1000). Once per
 *                      threshold ever.
 *  - `flow_overtime`: user reached the Flow daily hard cap (overtime
 *                      finish). Once per local day; bounded by a rolling wall-clock cap.
 *  - `league_founder`: user founded a league. One reward per league they
 *                      own (keyed by league id), capped per account.
 */
export type VxpAwardType =
	| 'streak'
	| 'calibration'
	| 'referral'
	| 'worlds_podium'
	| 'tournament_prize'
	| 'achievement'
	| 'comeback'
	| 'flow_milestone'
	| 'flow_overtime'
	| 'league_founder';

/**
 * Payout lifecycle for a single award. Once `paid`, the doc is immutable
 * (enforced by `assertSetVxpAward`).
 */
export type VxpAwardStatus = 'pending' | 'paid' | 'failed';

/**
 * Persisted shape stored in the `vxp_awards` collection. Doc key is
 * `${recipient}/${awardType}/${awardKey}`: collisions on retry are
 * natural idempotency.
 *
 * Amounts and ledger block indexes are stored as decimal strings so the
 * doc serialises cleanly through JSON (Juno doesn't persist native
 * bigints).
 */
export interface VxpAwardDoc {
	/** Principal text of the recipient. Encoded in the doc key too. */
	recipient: string;
	/** Award category: drives which satellite trigger fired it. */
	awardType: VxpAwardType;
	/**
	 * Stable sub-identifier within `awardType`. Encoded in the doc key too.
	 *
	 *  - `streak`: one of `'streak_3' | 'streak_7' | 'streak_14' | 'streak_30'`.
	 *  - `calibration`: the resolved market's `seriesId` (one per market).
	 *  - `referral`: the referee principal text.
	 *  - `worlds_podium`: `'<YYYY-MM>_gold' | '<YYYY-MM>_silver' | '<YYYY-MM>_bronze'`.
	 *  - `flow_milestone`: the crossed threshold as text: `'10' | '100' | '500' | '1000'`.
	 *  - `flow_overtime`: the Flow daily-counter day key
	 *                     `'<YYYY-MM-DD>'` (the client local day `recordFlowSwipe` uses).
	 *  - `league_founder`: the founded league's id (one per league owned).
	 */
	awardKey: string;
	/** Payout amount in VXP base units, decimal string. */
	amountBaseUnits: string;
	/** Lifecycle status. Transitions `pending → paid | failed` only. */
	status: VxpAwardStatus;
	/** When the award became eligible (ms since epoch). */
	earnedAtMs: number;
	/** When the ledger transfer completed (ms since epoch). Set on `paid`. */
	paidAtMs?: number;
	/** Ledger block index of the payout, decimal string. Set on `paid`. */
	blockIndex?: string;
	/** Short reason the payout failed. Set on `failed`. */
	errorMessage?: string;
}

/**
 * Builds the canonical doc key for an award. Used both at the assert site
 * (to validate the key matches the embedded fields) and at the write
 * site so callers can't drift.
 */
export const vxpAwardKey = ({
	recipient,
	awardType,
	awardKey
}: {
	recipient: Principal | string;
	awardType: VxpAwardType;
	awardKey: string;
}): string => {
	const recipientText = typeof recipient === 'string' ? recipient : recipient.toText();

	return `${recipientText}/${awardType}/${awardKey}`;
};
