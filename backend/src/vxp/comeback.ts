// Comeback restore: a one-time top-up for a returning user whose stack ran
// dry. Fires when a newly recorded activity day (an executed fill, dated by
// the engine, never the profile's client-written lastActiveDay) follows the
// previous recorded day by the absence threshold, so the trigger is a real
// prediction after an absence, not mere app-open, and only tops a genuinely
// depleted balance up TO the target. The single fixed
// comeback/restore award key is the anti-farming bound: at most once per
// account, ever.

import { isNullish, nonNullish } from '@dfinity/utils';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { daysBetween } from '../lib/time';
import { getAward, grantAward } from './awards';
import {
	COMEBACK_AWAY_DAYS,
	COMEBACK_BALANCE_FLOOR_BASE_UNITS,
	COMEBACK_RESTORE_TARGET_BASE_UNITS
} from './constants';
import { getVxpHoldings } from './payout';

const COMEBACK_AWARD_KEY = 'restore';

/** Activity-day trigger: grants the restore when the gap between the
 * previous and the newly recorded active day reaches the absence threshold
 * and the user's holdings (wallet plus deposited) sit below the floor. Never
 * throws; a hiccup is logged. */
export const runComebackRestoreTrigger = async ({
	userId,
	previousActiveDay,
	activeDay
}: {
	userId: string;
	previousActiveDay: string | undefined;
	activeDay: string | undefined;
}): Promise<void> => {
	try {
		// Both endpoints of the gap are needed: a first-ever active day cannot
		// be a return.
		if (isNullish(previousActiveDay) || isNullish(activeDay)) {
			return;
		}

		const gap = daysBetween({ fromDay: previousActiveDay, toDay: activeDay });

		if (isNullish(gap) || gap < COMEBACK_AWAY_DAYS) {
			return;
		}

		// One-time per account: skip before any ledger work.
		const existing = await getAward({
			userId,
			awardType: 'comeback',
			awardKey: COMEBACK_AWARD_KEY
		});

		if (nonNullish(existing)) {
			return;
		}

		const holdings = await getVxpHoldings(userId);

		// Only restore a genuinely depleted stack, and only up to the target.
		if (holdings >= COMEBACK_BALANCE_FLOOR_BASE_UNITS) {
			return;
		}

		const amount = COMEBACK_RESTORE_TARGET_BASE_UNITS - holdings;

		if (amount <= ZERO) {
			return;
		}

		await grantAward({
			userId,
			awardType: 'comeback',
			awardKey: COMEBACK_AWARD_KEY,
			amountBaseUnits: amount,
			memo: `vxp:comeback:${COMEBACK_AWARD_KEY}`
		});
	} catch (err) {
		logger.error(`comeback restore trigger failed for ${userId}:`, err);
	}
};
