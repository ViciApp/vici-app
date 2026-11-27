import {
	ApiError,
	claimReferralFriendship as claimReferralFriendshipApi,
	getMyReferralCode as getMyReferralCodeApi,
	listMyReferrals as listMyReferralsApi,
	lookupReferralCode as lookupReferralCodeApi,
	redeemReferralCode as redeemReferralCodeApi
} from '#lib/api-client/client.ts';
import { getSessionUser } from '#lib/api-client/session.ts';
import type { ReferralListItem } from '#lib/types/referral.ts';
import { isNullish } from '@dfinity/utils';
import type { PrincipalText } from '@dfinity/zod-schemas';

/**
 * The HTTP routes fold the referral rejection reasons into the `{ error }`
 * envelope; rethrow them as the Error message so the onboarding drain can
 * match on the reason (`existing_user_no_bonus`, "already redeemed", ...).
 */
const rethrowReferralReason = (err: unknown): never => {
	if (err instanceof ApiError && err.status === 400) {
		throw new Error(err.code);
	}

	throw err;
};

/**
 * Returns the caller's referral code. The route assigns one on first read, so
 * a returning user who predates the feature still gets a code.
 */
export const getMyReferralCode = async (): Promise<string | undefined> =>
	await getMyReferralCodeApi();

/**
 * Resolves a referral code to its owner's account id (or `undefined` if unknown / malformed),
 * the same `owner` string profile reads key on. Used by the FE to render a "Referred by …"
 * preview before the user confirms redemption.
 */
export const lookupReferralCode = async ({
	code
}: {
	code: string;
}): Promise<PrincipalText | undefined> => await lookupReferralCodeApi(code);

/**
 * Submits a referral code redemption for the current caller. The API enforces:
 * - one-time per referee (a second redemption is rejected),
 * - the caller must have a profile,
 * - the profile must be younger than {@link REFERRAL_SIGNUP_WINDOW_MS}: older accounts are
 *   rejected with {@link REFERRAL_EXISTING_USER_REASON} and should fall back to
 *   {@link claimReferralFriendship},
 * - self-referrals are rejected,
 * - the code must exist.
 *
 * On success the API also writes a bilateral confirmed friendship between referrer and
 * referee and pays both VXP bonuses.
 */
export const redeemReferralCode = async ({ code }: { code: string }): Promise<void> => {
	try {
		await redeemReferralCodeApi(code);
	} catch (err: unknown) {
		rethrowReferralReason(err);
	}
};

/**
 * Friendship-only path for users who use a referral link past the signup grace period or who
 * have already redeemed a different code. No VXP transfer; only writes a bilateral confirmed
 * friendship between the caller and the code owner. Idempotent if a relation already exists.
 *
 * The API still validates the code shape, looks up the owner, and rejects self-referrals.
 */
export const claimReferralFriendship = async ({ code }: { code: string }): Promise<void> => {
	try {
		await claimReferralFriendshipApi(code);
	} catch (err: unknown) {
		rethrowReferralReason(err);
	}
};

/**
 * Lists every redemption where the caller is the referrer, newest-first. Includes records
 * over the {@link REFERRAL_MAX_PAID} cap (those rows have `withinReferrerCap === false` and no
 * referrer payout) so the FE can show the full monitoring view.
 */
export const listMyReferrals = async (): Promise<ReferralListItem[]> => {
	const items = await listMyReferralsApi();

	// The route lists rows where the caller IS the referrer, so the wire
	// omits the referrer id; restore it from the session account. A missing
	// session means the caller raced the /me probe: fail fast rather than
	// emitting rows with a blank owner.
	const referrer = getSessionUser()?.id;

	if (isNullish(referrer)) {
		throw new Error('Not authenticated');
	}

	return items.map((item) => ({
		version: 1,
		referee: item.referee,
		referrer,
		code: item.code,
		redeemedAtMs: item.redeemedAtMs,
		withinReferrerCap: item.withinReferrerCap,
		refereePayout: item.refereePayout,
		referrerPayout: item.referrerPayout
	}));
};
