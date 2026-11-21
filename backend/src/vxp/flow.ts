// Flow VXP awards, the two Flow earn surfaces:
//
//  - flow_milestone: reaching a lifetime call-count boundary
//    (10 / 100 / 500 / 1000), once each ever, off the caller's executed
//    predictions in the engine (never the profile's client-written
//    totalTrades), evaluated on each trade activity.
//  - flow_overtime: finishing a day at the Flow daily hard cap, minted
//    inline from the flow-swipe endpoint, once per day key, bounded by a
//    rolling wall-clock cap because the day key is client-supplied and only
//    shape-checked.

import { nonNullish } from '@dfinity/utils';
import { logger } from '../lib/logger';
import { getAward, grantAward, grantCappedAward } from './awards';
import {
	parseVxp,
	VXP_FLOW_MILESTONES,
	VXP_FLOW_OVERTIME_BONUS,
	VXP_FLOW_OVERTIME_ROLLING_CAP,
	VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS
} from './constants';

const FLOW_MILESTONES: readonly number[] = Object.freeze(
	Object.keys(VXP_FLOW_MILESTONES)
		.map((k) => Number(k))
		.sort((a, b) => a - b)
);

/** Milestone boundaries the lifetime call count just crossed on this write;
 * empty for the common case. */
export const flowMilestonesCrossed = ({ prev, next }: { prev: number; next: number }): number[] => {
	if (next <= prev) {
		return [];
	}

	return FLOW_MILESTONES.filter((m) => prev < m && m <= next);
};

/** Trade-activity trigger: credits every lifetime-call milestone the
 * executed prediction count has reached, each once ever via its award key. */
export const runFlowMilestoneTrigger = async ({
	userId,
	executedPredictions
}: {
	userId: string;
	executedPredictions: number;
}): Promise<void> => {
	for (const milestone of flowMilestonesCrossed({ prev: 0, next: executedPredictions })) {
		try {
			await grantAward({
				userId,
				awardType: 'flow_milestone',
				awardKey: milestone.toString(),
				amountBaseUnits: parseVxp(VXP_FLOW_MILESTONES[milestone] ?? 0),
				memo: `vxp:flow_milestone:${milestone}`
			});
		} catch (err) {
			logger.error(`flow milestone grant failed (${milestone} for ${userId}):`, err);
		}
	}
};

export type FlowOvertimeOutcome = 'minted' | 'recorded' | 'already' | 'rate_limited' | 'failed';

/**
 * Mints the overtime bonus for dayKey, called inline once the daily counter
 * reaches the hard cap. Idempotent per day via the flow_overtime/<dayKey>
 * award key, and bounded by the rolling wall-clock cap (counted off the
 * server-stamped row creation time) so a client replaying forged day keys
 * cannot farm it. The cap is strict: concurrent mints are serialized. Never throws: a payout failure is logged and recorded on
 * the award row, leaving the swipe counter result intact.
 */
export const mintFlowOvertime = async ({
	userId,
	dayKey
}: {
	userId: string;
	dayKey: string;
}): Promise<FlowOvertimeOutcome> => {
	try {
		// Idempotent per day: skip before the rolling-window count. A failed
		// mint goes on to the grant, which reopens it ahead of the cap.
		const existing = await getAward({ userId, awardType: 'flow_overtime', awardKey: dayKey });

		if (nonNullish(existing) && existing.status !== 'failed') {
			return 'already';
		}

		const outcome = await grantCappedAward({
			userId,
			awardType: 'flow_overtime',
			awardKey: dayKey,
			amountBaseUnits: parseVxp(VXP_FLOW_OVERTIME_BONUS),
			memo: `vxp:flow_overtime:${dayKey}`,
			caps: [
				{
					max: VXP_FLOW_OVERTIME_ROLLING_CAP,
					windowMs: VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS,
					reason: 'rate_limited'
				}
			]
		});

		if (outcome.outcome === 'capped') {
			logger.info(
				`flow overtime rate-limited for ${userId} (day ${dayKey}, cap ${VXP_FLOW_OVERTIME_ROLLING_CAP})`
			);

			return 'rate_limited';
		}

		switch (outcome.outcome) {
			case 'paid':
				return 'minted';
			case 'recorded':
				return 'recorded';
			case 'already':
				return 'already';
			default:
				return 'failed';
		}
	} catch (err) {
		logger.error(`flow overtime mint failed for ${userId} (day ${dayKey}):`, err);

		return 'failed';
	}
};
