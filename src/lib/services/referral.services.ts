import { functions } from '#declarations/satellite/satellite.api.ts';
import type { ReferralListItem } from '#lib/types/referral.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	claimReferralFriendship as claimReferralFriendshipWeb2,
	getMyReferralCode as getMyReferralCodeWeb2,
	listMyReferrals as listMyReferralsWeb2,
	lookupReferralCode as lookupReferralCodeWeb2,
	redeemReferralCode as redeemReferralCodeWeb2,
	settleReferralPayout as settleReferralPayoutWeb2,
	Web2ApiError
} from '#lib/web2/client.ts';
import { getWeb2User } from '#lib/web2/session.ts';
import { fromWireReferral } from '#satellite/utils/wire-format.utils.ts';
import { isNullish } from '@dfinity/utils';
import type { PrincipalText } from '@junobuild/schema';

/**
 * The HTTP routes fold the satellite's trap reasons into the `{ error }`
 * envelope; rethrow them as the Error message so the onboarding drain's
 * reason matching (`existing_user_no_bonus`, "already redeemed", ...) stays
 * shared between transports.
 */
const rethrowReferralReason = (err: unknown): never => {
	if (err instanceof Web2ApiError && err.status === 400) {
		throw new Error(err.code);
	}

	throw err;
};

/**
 * Thin actor wrappers around the satellite referral endpoints. UI for the registration flow
 * (entering a code) and the "Your code / Friends you referred" panel will land in a follow-up
 * PR: this file exists so those surfaces can import a typed service without re-introducing the
 * `fromWire…` conversion plumbing inline.
 */

/**
 * Returns the caller's auto-generated referral code, if it has already been assigned. The code is
 * assigned by the satellite profile hook on first profile create; if a returning user is missing
 * one (e.g. signed in before the feature shipped), the next profile write backfills it.
 */
export const getMyReferralCode = async (): Promise<string | undefined> => {
	// The HTTP route assigns a code on first read, so the returning-user
	// backfill wait described above never applies on that transport.
	if (isWeb2Backend()) {
		return await getMyReferralCodeWeb2();
	}

	const { code } = await functions.getMyReferralCode();

	return code;
};

/**
 * Resolves a referral code to its owner principal (or `undefined` if unknown / malformed). Used
 * by the FE to render a "Referred by …" preview before the user confirms redemption.
 */
export const lookupReferralCode = async ({
	code
}: {
	code: string;
}): Promise<PrincipalText | undefined> => {
	// web2 resolves to the owner's account id, the same `owner` string the
	// swapped profile reads key on, so the landing preview renders unchanged.
	if (isWeb2Backend()) {
		return await lookupReferralCodeWeb2(code);
	}

	const { owner } = await functions.lookupReferralCode({ code });

	return owner;
};

/**
 * Submits a referral code redemption for the current caller. The satellite enforces:
 * - one-time per referee (the call traps on a second invocation),
 * - the caller must have a profile,
 * - the profile must be younger than {@link REFERRAL_SIGNUP_WINDOW_MS}: older accounts trap
 *   with {@link REFERRAL_EXISTING_USER_REASON} and should fall back to
 *   {@link claimReferralFriendship},
 * - self-referrals are rejected,
 * - the code must exist.
 *
 * On success the satellite also writes a bilateral confirmed friendship between referrer and
 * referee. Both VXP bonuses are paid out asynchronously by the post-write hook.
 */
export const redeemReferralCode = async ({ code }: { code: string }): Promise<void> => {
	if (isWeb2Backend()) {
		try {
			await redeemReferralCodeWeb2(code);
		} catch (err: unknown) {
			rethrowReferralReason(err);
		}

		return;
	}

	await functions.redeemReferralCode({ code });
};

/**
 * Drives (or retries) the VXP payout for a referral row, keyed by the referee principal. The redeem
 * call already pays out inline; this is the self-heal / retry path for a payout that failed or that
 * predates the inline-payout fix. Idempotent server-side: safe to call for one's own principal on
 * every load.
 */
export const settleReferral = async ({ referee }: { referee: PrincipalText }): Promise<void> => {
	// `referee` is the account id in this mode; the route lets a non-admin
	// caller target only their own row, which is the sole FE use case.
	if (isWeb2Backend()) {
		await settleReferralPayoutWeb2(referee);

		return;
	}

	await functions.settleReferral({ referee });
};

/**
 * Friendship-only path for users who use a referral link past the signup grace period or who
 * have already redeemed a different code. No VXP transfer; only writes a bilateral confirmed
 * friendship between the caller and the code owner. Idempotent if a relation already exists.
 *
 * The satellite still validates the code shape, looks up the owner, and rejects self-referrals.
 */
export const claimReferralFriendship = async ({ code }: { code: string }): Promise<void> => {
	if (isWeb2Backend()) {
		try {
			await claimReferralFriendshipWeb2(code);
		} catch (err: unknown) {
			rethrowReferralReason(err);
		}

		return;
	}

	await functions.claimReferralFriendship({ code });
};

/**
 * Lists every redemption where the caller is the referrer, newest-first. Includes records
 * over the {@link REFERRAL_MAX_PAID} cap (those rows have `withinReferrerCap === false` and no
 * referrer payout) so the FE can show the full monitoring view.
 */
export const listMyReferrals = async (): Promise<ReferralListItem[]> => {
	if (isWeb2Backend()) {
		const items = await listMyReferralsWeb2();

		// The route lists rows where the caller IS the referrer, so the wire
		// omits the referrer id; restore it from the session account. A missing
		// session means the caller raced the /me probe: fail fast rather than
		// emitting rows with a blank owner.
		const referrer = getWeb2User()?.id;

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
	}

	const { items } = await functions.listMyReferrals();

	return items.map(fromWireReferral);
};
