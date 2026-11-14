import { DAY_IN_MS, ZERO } from '#lib/constants/app.constants.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';

/**
 * One-time VXP bonus awarded to the **referee** (the new user redeeming a code). Flat and
 * uncapped — every eligible new sign-up gets it exactly once. Sized in VXP base units via the
 * canonical `vxpBaseUnits` helper.
 *
 * The **referrer** reward is *not* flat: it follows the diminishing curve in
 * {@link referrerRewardBaseUnits}, so the longer-term incentive to spam-share a code decays.
 */
export const REFERRAL_VXP_BONUS_VALUE = 500;

export const REFERRAL_VXP_BONUS_BASE_UNITS = vxpBaseUnits(REFERRAL_VXP_BONUS_VALUE);

/**
 * Hard lifetime cap on the number of redemptions for which a single referrer is paid. Redemptions
 * beyond this cap are still recorded on the referrals collection (`withinReferrerCap = false`) so
 * we can monitor usage of widely-shared codes, but no transfer fires. Kept in lockstep with the
 * final bracket of {@link REFERRAL_REWARD_TIERS} — the curve yields `0` past this many prior paid
 * redemptions.
 */
export const REFERRAL_MAX_PAID = 1000;

/**
 * Diminishing referrer-reward curve, keyed by the referrer's count of **prior** paid redemptions
 * (lifetime). Each tier covers an inclusive redemption-index range and pays a fixed VXP amount; the
 * reward shrinks as a code is reused, then drops to zero past {@link REFERRAL_MAX_PAID}.
 *
 * Redemption index (1-based, per referrer):
 * - 1–5      → 500 VXP
 * - 6–10     → 250 VXP
 * - 11–20    → 100 VXP
 * - 21–1000  →  50 VXP
 * - >1000    →   0 VXP (hard cap)
 *
 * Expressed as `{ throughIndex, value }` upper bounds so the lookup is a simple ascending scan.
 */
const REFERRAL_REWARD_TIERS: ReadonlyArray<{ throughIndex: number; value: string }> = [
	{ throughIndex: 5, value: '500' },
	{ throughIndex: 10, value: '250' },
	{ throughIndex: 20, value: '100' },
	// Final (floor) bracket — its upper bound IS the hard cap, so derive it from
	// `REFERRAL_MAX_PAID` to keep the two structurally in lockstep (no duplicated literal).
	{ throughIndex: REFERRAL_MAX_PAID, value: '50' }
];

const REFERRAL_REWARD_TIER_BASE_UNITS: ReadonlyArray<{ throughIndex: number; value: bigint }> =
	REFERRAL_REWARD_TIERS.map(({ throughIndex, value }) => ({
		throughIndex,
		value: vxpBaseUnits(value)
	}));

/**
 * Pure tier lookup: given how many paid redemptions a referrer has *already* banked (lifetime),
 * returns the VXP base-unit reward for the *next* redemption. Returns `ZERO` once the referrer has
 * reached {@link REFERRAL_MAX_PAID}, encoding the hard cap as part of the curve so callers need
 * only check for a zero reward.
 *
 * Authoritative on the server only — the referrer's prior-paid count must come from the satellite's
 * own scan of the referrals collection, never from the client.
 */
export const referrerRewardBaseUnits = (priorPaidCount: number): bigint => {
	const redemptionIndex = priorPaidCount + 1;

	for (const { throughIndex, value } of REFERRAL_REWARD_TIER_BASE_UNITS) {
		if (redemptionIndex <= throughIndex) {
			return value;
		}
	}

	return ZERO;
};

/**
 * Cumulative referrer earnings for `creditedCount` credited redemptions, in VXP base units. The
 * i-th credited redemption (1-based) pays `referrerRewardBaseUnits(i - 1)`, so the total honours
 * the diminishing tier curve and its hard cap rather than assuming a flat per-friend reward.
 *
 * `creditedCount` follows the satellite's `countReferrerCredits` rule: rows whose
 * `referrerPayout.status` has left `none` (owed / processing / paid — anything in flight still
 * consumes a slot). Derivable client-side from `listMyReferrals`; cosmetic only — the satellite
 * remains authoritative on payout.
 */
export const cumulativeReferrerRewardBaseUnits = (creditedCount: number): bigint => {
	// Rewards are zero past the hard cap, so clamping (and flooring at 0) only bounds the loop —
	// it cannot change the sum.
	const cappedCount = Math.min(Math.max(creditedCount, 0), REFERRAL_MAX_PAID);

	let total = ZERO;

	for (let priorPaidCount = 0; priorPaidCount < cappedCount; priorPaidCount++) {
		total += referrerRewardBaseUnits(priorPaidCount);
	}

	return total;
};

/**
 * Display-side twin of {@link referrerRewardBaseUnits}: given how many paid redemptions a referrer
 * has *already* banked (lifetime), returns the *next* redemption's reward as a whole-VXP number for
 * copy. Reads the same {@link REFERRAL_REWARD_TIERS} table so the headline figure can never drift
 * from the on-chain payout. Returns `0` once the referrer has reached {@link REFERRAL_MAX_PAID}.
 *
 * The referrer's prior-paid count is the count of the caller's own redemption rows whose
 * `referrerPayout.status` has left `none` (owed / processing / paid) — the same rule the satellite's
 * authoritative tally (`countReferrerCredits`) applies before feeding `referrerRewardBaseUnits`.
 * Derivable client-side from `listMyReferrals`, no privileged query needed. The figure is cosmetic;
 * the satellite remains authoritative on payout.
 */
export const referrerRewardVxp = (priorPaidCount: number): number => {
	const redemptionIndex = priorPaidCount + 1;

	for (const { throughIndex, value } of REFERRAL_REWARD_TIERS) {
		if (redemptionIndex <= throughIndex) {
			return Number(value);
		}
	}

	return 0;
};

/**
 * Length of an auto-generated referral code. 8 chars over a 32-char alphabet = 40 bits of entropy,
 * which is enough to make collisions vanishingly rare while keeping codes short enough to share.
 */
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Crockford base32 alphabet (no `I`, `L`, `O`, `U` — removes ambiguity with `1`/`0` and the rude
 * vowel). The satellite always emits uppercase; redemption input is normalised to uppercase before
 * lookup so users can paste either case.
 */
export const REFERRAL_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Regex used by the satellite assertion to validate code format. Kept in lockstep with
 * {@link REFERRAL_CODE_ALPHABET} and {@link REFERRAL_CODE_LENGTH}.
 */
export const REFERRAL_CODE_REGEX = new RegExp(
	`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`
);

/**
 * How long after profile creation a user is still considered "newly signed up" for referral
 * redemption purposes. After this window elapses, `redeemReferralCodeFn` refuses with
 * `existing_user_no_bonus` — the user can still use the code via `claimReferralFriendshipFn`
 * to add the referrer as a friend, but no VXP bonus is paid.
 *
 * Sized so a user who clicks an invite, gets interrupted, and comes back the next morning
 * still gets the bonus; longer-delayed signups fall back to the friendship-only path.
 */
export const REFERRAL_SIGNUP_WINDOW_MS = DAY_IN_MS;

/**
 * Wire-level error reason returned by `redeemReferralCodeFn` when the caller's profile is older
 * than {@link REFERRAL_SIGNUP_WINDOW_MS}. The FE matches on this exact string to branch into the
 * friendship-only flow.
 */
export const REFERRAL_EXISTING_USER_REASON = 'existing_user_no_bonus';
