import { j, PrincipalTextSchema } from '@junobuild/schema';

/**
 * Args for {@link redeemReferralCode}. Code is normalised to uppercase by the satellite before
 * lookup, so pasting either case from the FE works.
 */
export const RedeemReferralCodeArgsSchema = j.strictObject({
	code: j.string()
});

/**
 * Args for {@link lookupReferralCode}. Used by the FE to render a "Referred by …" preview before
 * the user submits the redemption.
 */
export const LookupReferralCodeArgsSchema = j.strictObject({
	code: j.string()
});

/**
 * Args for {@link claimReferralFriendship}. Same shape as the redeem call, code-only, but the
 * outcome is a friendship write, never a VXP payout. Used by existing users who use an invite
 * link past the signup-window grace period.
 */
export const ClaimReferralFriendshipArgsSchema = j.strictObject({
	code: j.string()
});

/**
 * Args for {@link settleReferral}. Keyed by the referee principal (the referral row key). Drives,
 * or retries: the VXP payout for that row; used by the FE to self-heal a payout that failed or
 * predates the inline-payout fix, and for operator backfills.
 */
export const SettleReferralArgsSchema = j.strictObject({
	referee: PrincipalTextSchema
});
