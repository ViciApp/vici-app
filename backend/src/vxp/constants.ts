// VXP economy tunables, mirrored 1:1 from the app's shared contract. The
// server is authoritative for every actual credit; the app surfaces the same
// numbers as UI previews. All amounts flow through parseVxp so a whole-VXP
// figure can never be booked as base units (VXP has 4 decimals; a raw
// BigInt(50) would under-pay by 10^4).

import { ZERO } from '../lib/constants';
import { DAY_IN_MS } from '../lib/time';

/** VXP ledger precision: 1 VXP = 10^4 base units. */
export const VXP_DECIMALS = 4;

const VXP_BASE_UNITS_PER_WHOLE = BigInt(10) ** BigInt(VXP_DECIMALS);

/** Whole-VXP figure to ledger base units. */
export const parseVxp = (wholeVxp: number): bigint =>
	BigInt(Math.round(wholeVxp)) * VXP_BASE_UNITS_PER_WHOLE;

/** Base units back to a whole-VXP display number (analytics values). */
export const vxpFromBaseUnits = (baseUnits: bigint): number =>
	Number(baseUnits) / Number(VXP_BASE_UNITS_PER_WHOLE);

// Onboarding: the new-user starter is a single 1,500 VXP grant at
// registration (m1). m2/m3 are retained at 0 so there is no engagement-gated
// drip; the payout path skips any milestone whose amount is not positive.
export const ONBOARDING_MILESTONE_AMOUNTS: Readonly<Record<'m1' | 'm2' | 'm3', bigint>> =
	Object.freeze({
		m1: parseVxp(1500),
		m2: ZERO,
		m3: ZERO
	});

/** Trade counts at which onboarding m2 / m3 become owed. */
export const ONBOARDING_M2_TRADE_COUNT = 1;
export const ONBOARDING_M3_TRADE_COUNT = 5;

/** Streak-milestone bonuses in whole VXP, keyed by the daily-streak count
 * the user just hit. */
export const VXP_STREAK_BONUSES: Readonly<Record<number, number>> = Object.freeze({
	3: 50,
	7: 150,
	14: 400,
	30: 1000
});

/** Flow volume milestones in whole VXP, keyed by the lifetime call-count
 * threshold crossed. Once each ever; calls 1 and 25 are deliberately not
 * milestones. */
export const VXP_FLOW_MILESTONES: Readonly<Record<number, number>> = Object.freeze({
	10: 50,
	100: 100,
	500: 250,
	1000: 500
});

/** Flow overtime bonus (whole VXP), once per day key at the daily hard cap. */
export const VXP_FLOW_OVERTIME_BONUS = 25;

/** Rolling wall-clock window bounding overtime mints: the day key is
 * client-supplied and only shape-checked, so real time (row creation) is the
 * anti-farming boundary, not the claimed day. */
export const VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS = 7 * DAY_IN_MS;

/** Max overtime mints inside the rolling window: just above the natural
 * once-per-calendar-day rate so a legitimate daily player is never blocked. */
export const VXP_FLOW_OVERTIME_ROLLING_CAP = 8;

/** Calibration reward, paid once per finalised Vici binary market a
 * recovering user calls correctly. */
export const VXP_CALIBRATION_REWARD_BASE_UNITS = parseVxp(20);

/** The reward only pays while the caller's balance is below this floor: it
 * is a recovery nudge, not an income stream. */
export const CALIBRATION_RECOVERY_FLOOR_BASE_UNITS = parseVxp(100);

/** Rolling calibration caps, counted off the caller's award rows. */
export const CALIBRATION_DAILY_CAP = 15;
export const CALIBRATION_HOURLY_CAP = 6;

// Comeback restore: a one-time top-up for a returning user whose stack ran
// dry (away at least COMEBACK_AWAY_DAYS, balance below the floor); the
// balance is topped up TO the target, not BY it.
export const COMEBACK_RESTORE_TARGET_BASE_UNITS = parseVxp(250);
export const COMEBACK_BALANCE_FLOOR_BASE_UNITS = parseVxp(100);
export const COMEBACK_AWAY_DAYS = 7;

/** League-founder reward, once per league founded, keyed by league id. */
export const VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS = parseVxp(100);

/** Founding a league is free, so an uncapped per-league payout would be an
 * unbounded mint; this per-account cap bounds the total. */
export const VXP_LEAGUE_FOUNDER_MAX_AWARDS = 100;

/** Worlds podium prizes (whole VXP) for the monthly battle top-3. */
export const VXP_WORLDS_PODIUM = Object.freeze({
	gold: 400,
	silver: 200,
	bronze: 100
} as const);

/** Tournament prizes (whole VXP) per place; both semifinal losers earn the
 * bronze tier independently. */
export const TOURNAMENT_PRIZE_TIERS: ReadonlyArray<{ place: 1 | 2 | 3; vxp: number }> = [
	{ place: 1, vxp: 5000 },
	{ place: 2, vxp: 2500 },
	{ place: 3, vxp: 1000 }
] as const;

/** Achievement catalog XP (whole VXP) per achievement id, mirrored from the
 * app's Album catalog: an unlock mints its value as real, spendable VXP. */
export const ACHIEVEMENT_XP: Readonly<Record<string, number>> = Object.freeze({
	contrarian: 400,
	marathon: 800,
	'first-call': 50,
	'on-fire': 200,
	oracle: 500,
	'league-founder': 300,
	'top-decile': 1000,
	'sharpest-eye': 750,
	'bold-caller': 600
});

/** Flat referee bonus: every eligible new sign-up gets it exactly once. */
export const REFERRAL_VXP_BONUS_BASE_UNITS = parseVxp(500);

/** Hard lifetime cap on the number of paid redemptions per referrer. */
export const REFERRAL_MAX_PAID = 1000;

/**
 * Diminishing referrer-reward curve, keyed by the referrer's count of PRIOR
 * paid redemptions. Each tier covers an inclusive 1-based redemption-index
 * range; the reward shrinks as a code is reused and drops to zero past
 * REFERRAL_MAX_PAID, encoding the hard cap as part of the curve.
 */
const REFERRAL_REWARD_TIERS: ReadonlyArray<{ throughIndex: number; amount: bigint }> = [
	{ throughIndex: 5, amount: parseVxp(500) },
	{ throughIndex: 10, amount: parseVxp(250) },
	{ throughIndex: 20, amount: parseVxp(100) },
	{ throughIndex: REFERRAL_MAX_PAID, amount: parseVxp(50) }
];

/** The next redemption's referrer reward given the prior paid count; ZERO
 * once the hard cap is reached. Authoritative on the server only. */
export const referrerRewardBaseUnits = (priorPaidCount: number): bigint => {
	const redemptionIndex = priorPaidCount + 1;

	for (const { throughIndex, amount } of REFERRAL_REWARD_TIERS) {
		if (redemptionIndex <= throughIndex) {
			return amount;
		}
	}

	return ZERO;
};
