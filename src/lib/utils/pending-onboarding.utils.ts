import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';

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
		const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);
		const parsed: Record<string, unknown> = ((): Record<string, unknown> => {
			if (isNullish(raw)) {
				return {};
			}

			try {
				const v: unknown = JSON.parse(raw);

				return typeof v === 'object' && nonNullish(v) ? (v as Record<string, unknown>) : {};
			} catch {
				return {};
			}
		})();

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
