import type { VxpMilestoneState } from '#lib/types/vxp-onboarding.ts';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Row in the `referral_codes` collection: reverse lookup from code → owner.
 *
 * - **Key**: the referral code (uppercase Crockford base32, fixed length: see
 *   {@link REFERRAL_CODE_LENGTH}).
 * - **Owner**: principal text of the user the code belongs to. Each user has exactly one code.
 */
export interface ReferralCodeDoc {
	owner: PrincipalText;
}

/**
 * Row in the `referrals` collection: one record per redemption. Key is the **referee** principal,
 * which enforces one-time redemption per user at the datastore layer.
 *
 * Payout state mirrors the `vxp_onboarding` ladder (`VxpMilestoneState`) so the same retry-friendly
 * status machine (`none | owed | processing | paid`) drives the ICRC transfer.
 */
export interface ReferralDoc {
	version: 1;
	referrer: PrincipalText;
	code: string;
	redeemedAtMs: number;
	/**
	 * `true` if, at hook time, this redemption earned the referrer a positive (tiered) reward, i.e.
	 * the referrer was still within the lifetime hard cap ({@link REFERRAL_MAX_PAID}) and the monthly
	 * cap. `false` for monitoring-only rows (over either cap, no transfer fires).
	 */
	withinReferrerCap: boolean;
	/**
	 * One-time VXP payout to the new user (referee). Always attempted (the referee bonus is not
	 * capped: every redeemed user gets it once).
	 */
	refereePayout: VxpMilestoneState;
	/**
	 * VXP payout to the referrer. Only transitions out of `none` when `withinReferrerCap` is
	 * `true`.
	 */
	referrerPayout: VxpMilestoneState;
}

/**
 * Row shape returned by `listMyReferrals`. Combines the stored {@link ReferralDoc} with the
 * doc key (the referee's principal text) so the FE can render the per-friend list without a
 * second lookup. Not stored: synthesised in the satellite query handler.
 */
export interface ReferralListItem extends ReferralDoc {
	referee: PrincipalText;
}
