// League-founder reward: 100 VXP once per league a user founds, keyed by
// league id so retries are naturally idempotent. Founding a league is free,
// so the per-account cap bounds an otherwise unbounded mint. The league
// domain itself lands with the leagues phase; this exposes the award side so
// the create-league path (and its retroactive self-heal pass) can call it.

import { logger } from '../lib/logger';
import { grantCappedAward } from './awards';
import { VXP_LEAGUE_FOUNDER_MAX_AWARDS, VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS } from './constants';

export type FounderPayoutOutcome = 'paid' | 'recorded' | 'already' | 'capped' | 'failed';

/**
 * Grants the founder reward for one league. Idempotent per league; the
 * per-account cap is counted off the caller's own league_founder awards
 * (anything in flight consumes a slot), and racing creates are serialized,
 * so they cannot slip past it.
 */
export const grantLeagueFounderAward = async ({
	userId,
	leagueId
}: {
	userId: string;
	leagueId: string;
}): Promise<FounderPayoutOutcome> => {
	try {
		const outcome = await grantCappedAward({
			userId,
			awardType: 'league_founder',
			awardKey: leagueId,
			amountBaseUnits: VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS,
			memo: `vxp:league_founder:${leagueId}`,
			caps: [{ max: VXP_LEAGUE_FOUNDER_MAX_AWARDS, reason: 'capped' }]
		});

		if (outcome.outcome === 'capped') {
			logger.info(
				`league founder award capped for ${userId} (league ${leagueId}, cap ${VXP_LEAGUE_FOUNDER_MAX_AWARDS})`
			);

			return 'capped';
		}

		switch (outcome.outcome) {
			case 'paid':
				return 'paid';
			case 'recorded':
				return 'recorded';
			case 'already':
				return 'already';
			default:
				return 'failed';
		}
	} catch (err) {
		logger.error(`league founder award failed (${leagueId} for ${userId}):`, err);

		return 'failed';
	}
};

/**
 * Retroactive self-heal: pays any of the caller's owned leagues that still
 * lack a founder award, sequentially so the per-account cap holds across the
 * batch. Idempotent and safe to call on every Leagues-page mount; the
 * leagues phase passes the caller's owned league ids.
 */
export const settleFounderAwards = async ({
	userId,
	ownedLeagueIds
}: {
	userId: string;
	ownedLeagueIds: string[];
}): Promise<{ settled: number }> => {
	let settled = 0;

	for (const leagueId of ownedLeagueIds) {
		const outcome = await grantLeagueFounderAward({ userId, leagueId });

		if (outcome === 'paid' || outcome === 'recorded') {
			settled += 1;
		}
	}

	return { settled };
};
