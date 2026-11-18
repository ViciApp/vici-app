/**
 * Onboarding milestones, in award order:
 * - `m1`: registration (profile created)
 * - `m2`: first trade
 * - `m3`: fifth trade
 *
 * Splits live in `vxp-onboarding.constants.ts`.
 */
export type VxpNewUserMilestoneKey = 'm1' | 'm2' | 'm3';

export type VxpMilestonePayoutStatus = 'none' | 'owed' | 'processing' | 'paid';

export interface VxpMilestoneState {
	status: VxpMilestonePayoutStatus;
	/**
	 * Amount owed or paid, in ICRC base units (smallest indivisible).
	 */
	amountBaseUnits: string;
	/**
	 * ICRC ledger block index of the successful transfer. Present only when
	 * `status === 'paid'`.
	 */
	blockIndex?: string;
	/**
	 * Last ledger error when status is `owed` (retry on next trade).
	 */
	lastError?: string;
}

/**
 * Per-user new-user VXP ladder (Juno `vxp_onboarding` collection).
 * `tradeCount` counts qualifying trade activities processed by the satellite hook (not registration).
 */
export interface VxpOnboardingDoc {
	version: 1;
	tradeCount: number;
	milestones: Record<VxpNewUserMilestoneKey, VxpMilestoneState>;
	/**
	 * After the first full scan of `profiles` + `activities`, we only increment `tradeCount`
	 * on new trades (avoids recounting on every request).
	 */
	legacyOnboardingSynced?: boolean;
}
