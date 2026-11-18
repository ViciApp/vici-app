// New-user onboarding grants: m1 (the full 1,500 VXP starter) on profile
// registration, m2/m3 at the first and fifth trade. m2/m3 are currently 0
// VXP by design (no engagement-gated drip), and the grant path skips
// non-positive amounts entirely, so only m1 mints today; the trade
// thresholds stay wired so a future non-zero m2/m3 needs only a constant
// change.

import { logger } from '../lib/logger';
import { grantAward } from './awards';
import {
	ONBOARDING_M2_TRADE_COUNT,
	ONBOARDING_M3_TRADE_COUNT,
	ONBOARDING_MILESTONE_AMOUNTS
} from './constants';

export type OnboardingMilestone = 'm1' | 'm2' | 'm3';

const grantMilestone = async ({
	userId,
	milestone
}: {
	userId: string;
	milestone: OnboardingMilestone;
}): Promise<void> => {
	try {
		await grantAward({
			userId,
			awardType: 'onboarding',
			awardKey: milestone,
			amountBaseUnits: ONBOARDING_MILESTONE_AMOUNTS[milestone],
			memo: `vxp:new-user:${milestone}`
		});
	} catch (err) {
		logger.error(`onboarding ${milestone} grant failed for ${userId}:`, err);
	}
};

/** Profile-write trigger: the registration grant (m1). Idempotent, so it can
 * run on every profile write; existing users simply collide on the key. */
export const runOnboardingProfileTrigger = ({ userId }: { userId: string }): Promise<void> =>
	grantMilestone({ userId, milestone: 'm1' });

/**
 * Trade-activity trigger: m2 once the lifetime trade count reaches 1, m3 at
 * 5. Uses at-least comparisons (not equality) so a user importing history or
 * skipping counts still receives every milestone they qualify for.
 */
export const runOnboardingTradeTrigger = async ({
	userId,
	tradeCount
}: {
	userId: string;
	tradeCount: number;
}): Promise<void> => {
	if (tradeCount >= ONBOARDING_M2_TRADE_COUNT) {
		await grantMilestone({ userId, milestone: 'm2' });
	}

	if (tradeCount >= ONBOARDING_M3_TRADE_COUNT) {
		await grantMilestone({ userId, milestone: 'm3' });
	}
};
