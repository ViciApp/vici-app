// Referral graph: code assignment, lookup, redemption and the friendship
// claim. Payout settlement lives in ../vxp/referral.ts (both sides settle on
// the referee's first prediction); this module only records the graph. All
// refusals are typed errors the routes answer as 400s, keeping the exact
// wire messages clients already match on.

import { isNullish, nonNullish } from '@dfinity/utils';
import { randomInt } from 'node:crypto';
import { query, type TxQuery } from '../db/client';
import { logger } from '../lib/logger';
import { DAY_IN_MS } from '../lib/time';
import { friendRelationKey } from '../social/relations';
import { hasAwardMarker } from '../vxp/award-markers';

/** Client-facing referral refusal; routes answer it as a 400 with the message. */
export class ReferralError extends Error {}

/** 8 chars over a 32-char alphabet = 40 bits, enough to make collisions
 * vanishingly rare while keeping codes short enough to share. */
export const REFERRAL_CODE_LENGTH = 8;

/** Crockford base32 (no I, L, O, U): removes 1/0 ambiguity and the rude
 * vowel. Codes are stored uppercase; input is normalized before lookup. */
export const REFERRAL_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const REFERRAL_CODE_REGEX = new RegExp(
	`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`
);

/** How long after profile creation a user still counts as newly signed up
 * for redemption purposes. Past the window the code still works via the
 * friendship-only claim, but no VXP bonus is owed. */
export const REFERRAL_SIGNUP_WINDOW_MS = DAY_IN_MS;

/** Wire-level refusal reason for a too-old profile; the client matches on
 * this exact string to branch into the friendship-only flow. */
export const REFERRAL_EXISTING_USER_REASON = 'existing_user_no_bonus';

const CODE_GENERATION_MAX_RETRIES = 8;

const generateReferralCode = (): string => {
	let code = '';

	// randomInt rejection-samples, so the draw stays uniform even if the
	// alphabet ever stops being a power-of-two length.
	for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
		code += REFERRAL_CODE_ALPHABET.charAt(randomInt(REFERRAL_CODE_ALPHABET.length));
	}

	return code;
};

const findOwnedCode = async (userId: string): Promise<string | undefined> => {
	const rows = await query<{ code: string }>(
		`select code from referral_codes where owner_user_id = $1`,
		[userId]
	);

	return rows[0]?.code;
};

/**
 * Idempotent: returns the caller's existing code if one is on record,
 * otherwise generates + writes a fresh one. The unique owner column makes a
 * concurrent double-assign collapse to one row; a code-key collision (or a
 * racing insert) falls through to the next attempt.
 */
export const getOrAssignReferralCode = async (userId: string): Promise<string> => {
	const existing = await findOwnedCode(userId);

	if (nonNullish(existing)) {
		return existing;
	}

	for (let attempt = 0; attempt < CODE_GENERATION_MAX_RETRIES; attempt++) {
		const code = generateReferralCode();
		const rows = await query<{ code: string }>(
			`insert into referral_codes (code, owner_user_id)
			 values ($1, $2)
			 on conflict do nothing
			 returning code`,
			[code, userId]
		);

		if (nonNullish(rows[0])) {
			return rows[0].code;
		}

		// Either the code key collided or a racing request assigned the owner
		// row first; a re-read resolves the latter.
		const raced = await findOwnedCode(userId);

		if (nonNullish(raced)) {
			return raced;
		}
	}

	throw new Error(`referral code generation exhausted after ${CODE_GENERATION_MAX_RETRIES} tries`);
};

/** The code in its stored form, or undefined when it cannot be one. */
export const normalizeReferralCode = (raw: string): string | undefined => {
	const normalized = raw.trim().toUpperCase();

	return REFERRAL_CODE_REGEX.test(normalized) ? normalized : undefined;
};

/** The code's owner, or undefined for an unknown / malformed code. */
export const lookupReferralCode = async (code: string): Promise<string | undefined> => {
	const normalized = normalizeReferralCode(code);

	if (isNullish(normalized)) {
		return;
	}

	const rows = await query<{ owner_user_id: string }>(
		`select owner_user_id from referral_codes where code = $1`,
		[normalized]
	);

	return rows[0]?.owner_user_id;
};

/**
 * Idempotently writes a confirmed bilateral friendship between referrer and
 * referee. Both parties already consented (one shared an invite link, the
 * other clicked it), so no request/accept dance. Never downgrades: an
 * existing relation in ANY state is left untouched (the key conflict is a
 * no-op).
 */
export const writeConfirmedFriendship = async ({
	referrerUserId,
	refereeUserId,
	q = query
}: {
	referrerUserId: string;
	refereeUserId: string;
	q?: TxQuery;
}): Promise<void> => {
	await q(
		`insert into relations (key, category, state, participant_one, participant_two)
		 values ($1, 'FRIEND', 'ACTIVE', $2, $3)
		 on conflict (key) do nothing`,
		[friendRelationKey(referrerUserId, refereeUserId), referrerUserId, refereeUserId]
	);
};

interface ResolvedCode {
	normalized: string;
	referrerUserId: string;
}

const resolveCodeForUser = async ({
	userId,
	code
}: {
	userId: string;
	code: string;
}): Promise<ResolvedCode> => {
	const normalized = normalizeReferralCode(code);

	if (isNullish(normalized)) {
		throw new ReferralError('Invalid referral code format.');
	}

	const referrerUserId = await lookupReferralCode(normalized);

	if (isNullish(referrerUserId)) {
		throw new ReferralError('Unknown referral code.');
	}

	if (referrerUserId === userId) {
		throw new ReferralError('You cannot redeem your own referral code.');
	}

	return { normalized, referrerUserId };
};

/** Why an account cannot be credited to a referrer: it already was, through
 * any channel (or a deleted account of the same identity collected the
 * referee bonus), it has no profile yet, or it signed up too long ago. */
export type ReferralIneligibility = 'already_redeemed' | 'no_profile' | 'outside_signup_window';

/**
 * The redemption rules every referral channel shares, checked before any
 * referrer is resolved: one redemption per referee ever and only within the
 * signup window. `undefined` when the account may be credited.
 */
export const referralIneligibility = async (
	userId: string
): Promise<ReferralIneligibility | undefined> => {
	const existing = await query<{ referee_user_id: string }>(
		`select referee_user_id from referrals where referee_user_id = $1`,
		[userId]
	);

	// A deleted account of the same identity that collected its referee bonus
	// counts as a redemption too: the bonus is one-time per person.
	if (
		nonNullish(existing[0]) ||
		(await hasAwardMarker({ userId, awardType: 'referral', awardKey: userId }))
	) {
		return 'already_redeemed';
	}

	const profileRows = await query<{ created_at: Date }>(
		`select created_at from profiles where user_id = $1`,
		[userId]
	);
	const [profile] = profileRows;

	if (isNullish(profile)) {
		return 'no_profile';
	}

	// Signup-window gate: only fresh sign-ups earn the VXP bonus. Existing
	// users who follow a referral link land in claimReferralFriendship
	// instead (friendship only, no VXP).
	if (Date.now() - profile.created_at.getTime() > REFERRAL_SIGNUP_WINDOW_MS) {
		return 'outside_signup_window';
	}
};

/**
 * Writes the one referrals row of an eligible referee plus the auto-confirmed
 * friendship, for any channel: a referral code, or a challenge link
 * (`challengeId`, with the challenger's own code). The referee primary key
 * makes a racing second redemption a no-op, so the first written row stands:
 * `false` tells the loser it credited nobody, and it writes no friendship,
 * since its referrer is not the one the row names.
 * NO payout fires here: the bonus is deferred to the referee's first
 * prediction (the trade trigger drives ../vxp/referral.ts), so sign-ups that
 * never engage reward nobody.
 */
export const writeReferralRedemption = async ({
	userId,
	referrerUserId,
	code,
	challengeId
}: {
	userId: string;
	referrerUserId: string;
	code: string;
	challengeId?: string;
}): Promise<boolean> => {
	const inserted = await query<{ referee_user_id: string }>(
		`insert into referrals (referee_user_id, referrer_user_id, code, redeemed_at_ms, challenge_id)
		 values ($1, $2, $3, $4, $5)
		 on conflict (referee_user_id) do nothing
		 returning referee_user_id`,
		[userId, referrerUserId, code, Date.now(), challengeId ?? null]
	);

	if (isNullish(inserted[0])) {
		return false;
	}

	await writeConfirmedFriendship({ referrerUserId, refereeUserId: userId });

	logger.info(
		`referral redeemed: referee ${userId}, referrer ${referrerUserId}, code ${code}${
			isNullish(challengeId) ? '' : ', through a challenge link'
		}`
	);

	return true;
};

const INELIGIBLE_REFERRAL_MESSAGES: Record<ReferralIneligibility, string> = {
	already_redeemed: 'You have already redeemed a referral code.',
	no_profile: 'Create your profile before redeeming a referral code.',
	outside_signup_window: REFERRAL_EXISTING_USER_REASON
};

/**
 * Records a redemption for a fresh sign-up: one per referee ever, only
 * within the signup window, never against the caller's own code.
 */
export const redeemReferralCode = async ({
	userId,
	code
}: {
	userId: string;
	code: string;
}): Promise<void> => {
	const ineligible = await referralIneligibility(userId);

	if (nonNullish(ineligible)) {
		throw new ReferralError(INELIGIBLE_REFERRAL_MESSAGES[ineligible]);
	}

	const { normalized, referrerUserId } = await resolveCodeForUser({ userId, code });

	const redeemed = await writeReferralRedemption({ userId, referrerUserId, code: normalized });

	if (!redeemed) {
		throw new ReferralError(INELIGIBLE_REFERRAL_MESSAGES.already_redeemed);
	}
};

/**
 * Friendship-only path for users who follow a referral link but are not
 * eligible for the VXP bonus (account past the signup window, or already
 * redeemed). Idempotent: an existing relation in any state stays as is.
 */
export const claimReferralFriendship = async ({
	userId,
	code
}: {
	userId: string;
	code: string;
}): Promise<void> => {
	const { referrerUserId } = await resolveCodeForUser({ userId, code });

	await writeConfirmedFriendship({ referrerUserId, refereeUserId: userId });
};

/** One side's payout state as surfaced on the referral list. */
export interface ReferralPayoutState {
	status: 'none' | 'owed' | 'paid';
	amountBaseUnits: string;
}

export interface ReferralListItem {
	referee: string;
	code: string;
	redeemedAtMs: number;
	withinReferrerCap: boolean;
	refereePayout: ReferralPayoutState;
	referrerPayout: ReferralPayoutState;
}

interface ReferralListRow {
	referee_user_id: string;
	code: string;
	redeemed_at_ms: string;
	within_referrer_cap: boolean | null;
	referee_status: string | null;
	referee_amount: string | null;
	referrer_status: string | null;
	referrer_amount: string | null;
}

const sidePayout = ({
	status,
	amount,
	fallback
}: {
	status: string | null;
	amount: string | null;
	fallback: ReferralPayoutState['status'];
}): ReferralPayoutState => {
	if (isNullish(status)) {
		return { status: fallback, amountBaseUnits: '0' };
	}

	return {
		status: status === 'paid' ? 'paid' : 'owed',
		amountBaseUnits: amount ?? '0'
	};
};

/**
 * Every redemption where the caller is the referrer, newest first, each row
 * joined with both sides' award state so the client can render payout
 * badges. An undecided cap slot reads as within-cap pending (the settlement
 * pass decides it on the referee's first trade).
 */
export const listMyReferrals = async (userId: string): Promise<ReferralListItem[]> => {
	const rows = await query<ReferralListRow>(
		`select r.referee_user_id, r.code, r.redeemed_at_ms::text, r.within_referrer_cap,
		        ra.status as referee_status, ra.amount_base_units::text as referee_amount,
		        rr.status as referrer_status, rr.amount_base_units::text as referrer_amount
		 from referrals r
		 left join vxp_awards ra
		   on ra.user_id = r.referee_user_id
		  and ra.award_type = 'referral'
		  and ra.award_key = r.referee_user_id::text
		 left join vxp_awards rr
		   on rr.user_id = r.referrer_user_id
		  and rr.award_type = 'referral'
		  and rr.award_key = r.referee_user_id::text
		 where r.referrer_user_id = $1
		 order by r.redeemed_at_ms desc`,
		[userId]
	);

	return rows.map((row) => ({
		referee: row.referee_user_id,
		code: row.code,
		redeemedAtMs: Number(row.redeemed_at_ms),
		// Undecided (null) reads as within-cap pending, matching the payout
		// mapping below; settlement flips it to false only when over cap.
		withinReferrerCap: row.within_referrer_cap !== false,
		// The referee bonus is owed unconditionally from redemption on; the
		// referrer side stays 'none' until the cap slot is decided in its favor.
		refereePayout: sidePayout({
			status: row.referee_status,
			amount: row.referee_amount,
			fallback: 'owed'
		}),
		referrerPayout:
			row.within_referrer_cap === false
				? { status: 'none', amountBaseUnits: '0' }
				: sidePayout({
						status: row.referrer_status,
						amount: row.referrer_amount,
						fallback: 'none'
					})
	}));
};
