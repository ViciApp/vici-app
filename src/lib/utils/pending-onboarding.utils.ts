import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';

// The stashed payload as an object; `{}` when absent or garbage. Throws only
// when storage itself is unavailable, which callers swallow.
const readPendingPayload = (): Record<string, unknown> => {
	const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);

	if (isNullish(raw)) {
		return {};
	}

	try {
		const v: unknown = JSON.parse(raw);

		return typeof v === 'object' && nonNullish(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

/**
 * Merge a league-invite capture into the signed-out pending-onboarding
 * payload (`PENDING_ONBOARDING_STORAGE_KEY`), preserving whatever an earlier
 * surface already stashed. The signup drain (`(app)/+layout.svelte`) redeems
 * the payload once the new account's profile exists.
 *
 * Merge rules mirror the signed-out capture semantics everywhere else:
 * the league invite always overwrites (latest link wins), while a referral
 * code is first-referrer-wins: a code stashed by an earlier `?ref=` capture
 * (e.g. a market share) is never replaced.
 *
 * Best-effort: storage may be unavailable (private mode) or hold garbage:
 * signup still works without the stash, the user can join manually with the
 * code afterwards.
 */
export const stashLeagueInviteForSignup = ({
	inviteCode,
	referralCode
}: {
	inviteCode: string;
	referralCode?: string;
}): void => {
	if (!browser) {
		return;
	}

	try {
		const parsed = readPendingPayload();

		parsed.leagueInvite = inviteCode;

		const hasReferral = typeof parsed.referralCode === 'string' && parsed.referralCode.length > 0;

		if (nonNullish(referralCode) && !hasReferral) {
			parsed.referralCode = referralCode;
		}

		localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(parsed));
	} catch {
		// Swallowed by design: see the doc comment.
	}
};

/**
 * The referral code a `?ref=` param carries, normalized, or `undefined` when
 * there is none or it is not a code: a share link falls back to the
 * sharer's handle while their code loads, and a handle fails the pattern.
 */
export const referralCodeFromSearch = (search: string): string | undefined => {
	const normalized = new URLSearchParams(search).get('ref')?.toUpperCase().trim();

	return nonNullish(normalized) && REFERRAL_CODE_REGEX.test(normalized) ? normalized : undefined;
};

/**
 * Stash a share link's referral code (`?ref=`) into the signed-out
 * pending-onboarding payload, so the sign-up drain redeems it once the new
 * account's profile exists. First referrer wins: a code already pending is
 * never replaced (the server also enforces one redemption per referee and
 * no self-referral). Best-effort, like the league stash above.
 */
export const stashSharedReferralForSignup = (code: string): void => {
	if (!browser) {
		return;
	}

	try {
		const parsed = readPendingPayload();

		if (typeof parsed.referralCode === 'string' && parsed.referralCode.length > 0) {
			return;
		}

		parsed.referralCode = code;
		localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(parsed));
	} catch {
		// Swallowed by design: attribution must never break navigation.
	}
};
