// Achievement-unlock awards: the achievement's catalog XP value is minted as
// real, spendable VXP once per account (the achievement/<id> award key is the
// idempotency). An unlock is decided here, from the server's own data: the
// engine's fills and settlements, the recorded activity days and the league
// rosters. The profile's client-written unlockedAchievements never mints.
//
// top-decile, sharpest-eye and bold-caller are not evaluated: their
// conditions rest on client-computed leaderboard and monthly figures the
// server cannot check, so they mint nothing here (see docs/ai/economy.md).

import { isNullish, nonNullish } from '@dfinity/utils';
import type { ClearingDid } from '../declarations';
import { listMyLeagues } from '../leagues/leagues';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { grantAward } from './awards';
import type { CallSide } from './calibration';
import {
	ACHIEVEMENT_ACCURACY_GATE_CALLS,
	ACHIEVEMENT_XP,
	CONTRARIAN_PRICE_THRESHOLD,
	CONTRARIAN_WIN_TARGET,
	LEAGUE_FOUNDER_MIN_MEMBERS,
	MARATHON_DAILY_STREAK_TARGET,
	ON_FIRE_STREAK_TARGET,
	ORACLE_ACCURACY_TARGET,
	ORACLE_TRADES_TARGET,
	parseVxp
} from './constants';
import { heldBinaryPosition } from './predictions';

/** What the engine history proves about a user's calls and settlements. */
export interface EngineAchievementFacts {
	executedPredictions: number;
	settledCount: number;
	wins: number;
	/** Consecutive winning settlements, most recent first. */
	currentWinStreak: number;
	/** Winning binary settlements whose held side was entered at or below the
	 * contrarian price. */
	contrarianWins: number;
}

const isWinningSettlement = ({ event_type, qty }: ClearingDid.Event): boolean =>
	'Settled' in event_type && qty > ZERO;

/** The side a binary settlement paid: a Settled event's price is the
 * settlement price (1 for YES, 0 for NO), never the price a call was taken
 * at. An Outcome settlement carries the engine's placeholder 1 at zero
 * decimals instead; its fills hold no outcome id, so the outcome a caller
 * held cannot be told from the others and it is never judged. */
const settledBinarySide = ({ price: { decimal } }: ClearingDid.Event): CallSide | undefined => {
	if (decimal.value === ZERO) {
		return 'NO';
	}

	if (decimal.decimals > 0 && decimal.value === BigInt(10) ** BigInt(decimal.decimals)) {
		return 'YES';
	}
};

/** A win on a side the market priced as a long shot when the caller took it:
 * judged on the entry price of the position held into settlement, side-aware. */
const isContrarianWin =
	(events: readonly ClearingDid.Event[]) =>
	(settlement: ClearingDid.Event): boolean => {
		const paidSide = settledBinarySide(settlement);

		if (isNullish(paidSide)) {
			return false;
		}

		const held = heldBinaryPosition({ events, seriesId: settlement.series_id });

		return held?.side === paidSide && held.entryPrice <= CONTRARIAN_PRICE_THRESHOLD;
	};

/** The settlement figures of a trade history: a settlement's signed qty is
 * its realized cashflow, so a positive one is a win. */
export const engineAchievementFacts = ({
	events,
	executedPredictions
}: {
	events: readonly ClearingDid.Event[];
	executedPredictions: number;
}): EngineAchievementFacts => {
	const settled = events
		.filter(({ event_type }) => 'Settled' in event_type)
		.sort((a, b) => Number(b.timestamp - a.timestamp));
	const firstNonWin = settled.findIndex((event) => !isWinningSettlement(event));
	const wins = settled.filter(isWinningSettlement);

	return {
		executedPredictions,
		settledCount: settled.length,
		wins: wins.length,
		currentWinStreak: firstNonWin === -1 ? settled.length : firstNonWin,
		contrarianWins: wins.filter(isContrarianWin(events)).length
	};
};

/** Achievements the engine history unlocks. */
export const engineVerifiedAchievements = (facts: EngineAchievementFacts): string[] => {
	const accuracy = facts.settledCount > 0 ? (facts.wins / facts.settledCount) * 100 : 0;
	const unlocked: string[] = [];

	if (facts.executedPredictions > 0) {
		unlocked.push('first-call');
	}

	if (
		facts.executedPredictions >= ACHIEVEMENT_ACCURACY_GATE_CALLS &&
		facts.executedPredictions >= ORACLE_TRADES_TARGET &&
		accuracy >= ORACLE_ACCURACY_TARGET
	) {
		unlocked.push('oracle');
	}

	if (facts.currentWinStreak >= ON_FIRE_STREAK_TARGET) {
		unlocked.push('on-fire');
	}

	if (facts.contrarianWins >= CONTRARIAN_WIN_TARGET) {
		unlocked.push('contrarian');
	}

	return unlocked;
};

/** Achievements the activity days and league rosters unlock. */
export const activityVerifiedAchievements = ({
	dailyStreak,
	ownsQualifyingLeague
}: {
	dailyStreak: number;
	ownsQualifyingLeague: boolean;
}): string[] => [
	...(dailyStreak >= MARATHON_DAILY_STREAK_TARGET ? ['marathon'] : []),
	...(ownsQualifyingLeague ? ['league-founder'] : [])
];

/** Whether the user owns a league with enough members for league-founder. */
export const ownsQualifyingLeague = async ({ userId }: { userId: string }): Promise<boolean> =>
	(await listMyLeagues(userId)).some(
		({ league, role, memberCount }) =>
			role === 'owner' && league.ownerUserId === userId && memberCount >= LEAGUE_FOUNDER_MIN_MEMBERS
	);

/** Mints the catalog value of every given achievement, once each ever.
 * Unknown ids and non-positive values mint nothing; a failure on one does not
 * block the others. */
export const grantAchievementAwards = async ({
	userId,
	achievementIds
}: {
	userId: string;
	achievementIds: readonly string[];
}): Promise<void> => {
	const payable = achievementIds.filter((id) => {
		const xp: number | undefined = ACHIEVEMENT_XP[id];

		return nonNullish(xp) && xp > 0;
	});

	for (const achievementId of payable) {
		try {
			await grantAward({
				userId,
				awardType: 'achievement',
				awardKey: achievementId,
				amountBaseUnits: parseVxp(ACHIEVEMENT_XP[achievementId] ?? 0),
				memo: `vxp:achievement:${achievementId}`
			});
		} catch (err) {
			logger.error(`achievement award grant failed (${achievementId} for ${userId}):`, err);
		}
	}
};
