// Award-trigger composition for the two client-write surfaces the economy
// hangs off: profile writes and trade activities. Routes call these AFTER
// the domain write commits, mirroring the post-write hook model the awards
// were designed around (only client writes fired hooks; internal server
// writes never did). Every branch is idempotent and best-effort: an award
// hiccup logs, it never fails the domain write.

import { logger } from '../lib/logger';
import { runAchievementAwardTrigger } from './achievements';
import { runComebackRestoreTrigger } from './comeback';
import { runFlowMilestoneTrigger } from './flow';
import { runOnboardingProfileTrigger, runOnboardingTradeTrigger } from './onboarding';
import { countExecutedPredictions } from './predictions';
import { runReferralTradeTrigger } from './referral';
import { runStreakAwardTrigger } from './streak';

/** The slice of the profile the award triggers read, captured before and
 * after the write. */
export interface ProfileAwardSlice {
	dailyStreak: number;
	totalTrades: number;
	unlockedAchievements: string[];
	lastActiveDay?: string;
}

/**
 * Post-write triggers for a profile upsert: registration grant, streak
 * milestones, flow lifetime milestones, achievement unlocks and the
 * comeback restore, each off the before/after delta. A missing before means
 * a brand-new profile (deltas run against the zero slice).
 */
export const runProfileAwardTriggers = async ({
	userId,
	before,
	after
}: {
	userId: string;
	before: ProfileAwardSlice | undefined;
	after: ProfileAwardSlice;
}): Promise<void> => {
	try {
		await runOnboardingProfileTrigger({ userId });

		await runStreakAwardTrigger({
			userId,
			prevDailyStreak: before?.dailyStreak ?? 0,
			nextDailyStreak: after.dailyStreak
		});

		await runFlowMilestoneTrigger({
			userId,
			prevTotalTrades: before?.totalTrades ?? 0,
			nextTotalTrades: after.totalTrades
		});

		await runAchievementAwardTrigger({
			userId,
			prevUnlocked: before?.unlockedAchievements ?? [],
			nextUnlocked: after.unlockedAchievements
		});

		await runComebackRestoreTrigger({
			userId,
			prevLastActiveDay: before?.lastActiveDay,
			nextLastActiveDay: after.lastActiveDay
		});
	} catch (err) {
		logger.error(`profile award triggers failed for ${userId}:`, err);
	}
};

/**
 * Post-write triggers for a TRADE activity: the onboarding call-count
 * milestones and the referral first-prediction settlement. The activity is
 * only the nudge: the lifetime count is the user's executed fills in the
 * engine, so a posted activity without a real trade unlocks nothing and a
 * replayed trigger converges instead of double-counting.
 */
export const runTradeActivityTriggers = async ({ userId }: { userId: string }): Promise<void> => {
	try {
		const tradeCount = await countExecutedPredictions({ userId });

		if (tradeCount <= 0) {
			return;
		}

		await runOnboardingTradeTrigger({ userId, tradeCount });
		await runReferralTradeTrigger({ userId });
	} catch (err) {
		logger.error(`trade activity award triggers failed for ${userId}:`, err);
	}
};
