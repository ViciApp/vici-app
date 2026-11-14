// Comeback restore: a one-time top-up for a returning user whose stack ran
// dry. Fires off the profile write's lastActiveDay jump (that field only
// advances when the user predicts on a new day, so the trigger is
// re-engagement, not mere app-open), and only tops a genuinely depleted
// balance up TO the target. The single fixed comeback/restore award key is
// the anti-farming bound: at most once per account, ever.

import { isNullish, nonNullish } from '@dfinity/utils';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { DAY_IN_MS } from '../lib/time';
import { getAward, grantAward } from './awards';
import {
	COMEBACK_AWAY_DAYS,
	COMEBACK_BALANCE_FLOOR_BASE_UNITS,
	COMEBACK_RESTORE_TARGET_BASE_UNITS
} from './constants';
import { getVxpBalance } from './payout';

const COMEBACK_AWARD_KEY = 'restore';

/** Whole days between two YYYY-MM-DD day strings (UTC-anchored), undefined
 * when either is missing/unparseable or the span is negative (clock skew or
 * a backdated day must not satisfy the absence gate). */
export const daysBetween = ({
	fromDay,
	toDay
}: {
	fromDay: string;
	toDay: string;
}): number | undefined => {
	const fromMs = Date.parse(`${fromDay}T00:00:00Z`);
	const toMs = Date.parse(`${toDay}T00:00:00Z`);

	if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
		return;
	}

	return Math.floor((toMs - fromMs) / DAY_IN_MS);
};

/** Profile-write trigger: grants the restore when the lastActiveDay gap
 * reaches the absence threshold and the ledger balance sits below the floor.
 * Never throws; a hiccup is logged and the trigger can fire again later. */
export const runComebackRestoreTrigger = async ({
	userId,
	prevLastActiveDay,
	nextLastActiveDay
}: {
	userId: string;
	prevLastActiveDay: string | undefined;
	nextLastActiveDay: string | undefined;
}): Promise<void> => {
	try {
		// Both endpoints of the gap are needed: a brand-new profile cannot be a
		// return.
		if (isNullish(prevLastActiveDay) || isNullish(nextLastActiveDay)) {
			return;
		}

		const gap = daysBetween({ fromDay: prevLastActiveDay, toDay: nextLastActiveDay });

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

		const balance = await getVxpBalance(userId);

		// Only restore a genuinely depleted stack, and only up to the target.
		if (balance >= COMEBACK_BALANCE_FLOOR_BASE_UNITS) {
			return;
		}

		const amount = COMEBACK_RESTORE_TARGET_BASE_UNITS - balance;

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
