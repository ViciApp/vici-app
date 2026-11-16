// Award-trigger composition for the write surfaces the economy hangs off:
// profile writes and trade activities. Routes call these AFTER
// the domain write commits, mirroring the post-write hook model the awards
// were designed around. Only the registration grant rides the profile write:
// every other award reads server-side truth (the engine's fills and
// settlements, the recorded activity days, the league rosters), never a
// client-written profile field. Every branch is idempotent and best-effort:
// an award hiccup logs, it never fails the domain write.

import { nonNullish } from '@dfinity/utils';
import type { ClearingDid } from '../declarations';
import { getTradeHistory } from '../engine/clearing';
import { logger } from '../lib/logger';
import {
	activityVerifiedAchievements,
	engineAchievementFacts,
	engineVerifiedAchievements,
	grantAchievementAwards,
	ownsQualifyingLeague
} from './achievements';
import { dailyStreakOf, listActivityDays, recordActivityDays } from './activity-days';
import { runComebackRestoreTrigger } from './comeback';
import { runFlowMilestoneTrigger } from './flow';
import { runOnboardingProfileTrigger, runOnboardingTradeTrigger } from './onboarding';
import { executedFillDays, executedPredictionCount } from './predictions';
import { runReferralTradeTrigger } from './referral';
import { runStreakAwardTrigger } from './streak';

/** Post-write trigger for a profile upsert: the registration grant. */
export const runProfileAwardTriggers = async ({ userId }: { userId: string }): Promise<void> => {
	try {
		await runOnboardingProfileTrigger({ userId });
	} catch (err) {
		logger.error(`profile award triggers failed for ${userId}:`, err);
	}
};

/**
 * The awards that hang off the recorded activity days, run after new days
 * were recorded: the streak milestones and marathon off the derived streak,
 * league-founder off the rosters, and the comeback when the newest recorded
 * day is one this write added after a long enough absence.
 */
const runActivityDayAwards = async ({
	userId,
	recordedDays
}: {
	userId: string;
	recordedDays: readonly string[];
}): Promise<void> => {
	const days = await listActivityDays({ userId });
	const dailyStreak = dailyStreakOf(days);

	await runStreakAwardTrigger({ userId, dailyStreak });

	const latest = days.at(-1);

	if (nonNullish(latest) && recordedDays.includes(latest)) {
		await runComebackRestoreTrigger({ userId, previousActiveDay: days.at(-2), activeDay: latest });
	}

	await grantAchievementAwards({
		userId,
		achievementIds: activityVerifiedAchievements({
			dailyStreak,
			ownsQualifyingLeague: await ownsQualifyingLeague({ userId })
		})
	});
};

const runEngineHistoryAwards = async ({
	userId,
	events,
	executedPredictions
}: {
	userId: string;
	events: readonly ClearingDid.Event[];
	executedPredictions: number;
}): Promise<void> => {
	await runFlowMilestoneTrigger({ userId, executedPredictions });

	await grantAchievementAwards({
		userId,
		achievementIds: engineVerifiedAchievements(
			engineAchievementFacts({ events, executedPredictions })
		)
	});

	const recordedDays = await recordActivityDays({ userId, dayKeys: executedFillDays(events) });

	await runActivityDayAwards({ userId, recordedDays });
};

/**
 * Post-write triggers for a TRADE activity. The activity is only the nudge:
 * every figure comes from the user's trade history in the engine, so a posted
 * activity without a real trade unlocks nothing and a replayed trigger
 * converges instead of double-counting. Runs the onboarding call-count
 * milestones and the referral first-prediction settlement, the Flow lifetime
 * milestones and the engine-verified achievements, and records the fill days
 * that drive the streak and the comeback.
 */
export const runTradeActivityTriggers = async ({ userId }: { userId: string }): Promise<void> => {
	try {
		const events = await getTradeHistory({ userId });
		const tradeCount = executedPredictionCount(events);

		if (tradeCount <= 0) {
			return;
		}

		await runOnboardingTradeTrigger({ userId, tradeCount });
		await runReferralTradeTrigger({ userId });
		await runEngineHistoryAwards({ userId, events, executedPredictions: tradeCount });
	} catch (err) {
		logger.error(`trade activity award triggers failed for ${userId}:`, err);
	}
};
