import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';

/**
 * Total VXP granted per user as the new-user starter (onboarding reserve): a single
 * **1,500 VXP** grant at registration. Sized to ~3 daily goals so a new user can reach their
 * first prediction → resolution → payout loop before hitting any wall.
 *
 * The starter is granted in full on registration (milestone 1). The two call-gated milestones
 * (`m2`/`m3`) are retained at **0** — the payout path skips any milestone whose amount is ≤ 0 —
 * so there is no engagement-gated drip. Making predictions is rewarded by gameplay payouts, the
 * first-call achievement, and the referral bonus instead.
 */
export const NEW_USER_VXP_TOTAL_BASE_UNITS = vxpBaseUnits(1500);

const MILESTONE_1_VXP = vxpBaseUnits(1500);
const MILESTONE_2_VXP = vxpBaseUnits(0);

export const newUserVxpAmountMilestone1BaseUnits = (): bigint => MILESTONE_1_VXP;

export const newUserVxpAmountMilestone2BaseUnits = (): bigint => MILESTONE_2_VXP;

// Computed as the remainder so the three milestones sum exactly to `NEW_USER_VXP_TOTAL_BASE_UNITS`.
export const newUserVxpAmountMilestone3BaseUnits = (): bigint =>
	NEW_USER_VXP_TOTAL_BASE_UNITS -
	newUserVxpAmountMilestone1BaseUnits() -
	newUserVxpAmountMilestone2BaseUnits();
