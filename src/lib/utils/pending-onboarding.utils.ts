import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
import {
	hasPendingReferralCode,
	pendingPayloadOf,
	withPendingInviter,
	type PendingInviter
} from '#lib/utils/pending-inviter.utils.ts';
import { browser } from '$app/env';
import { nonNullish } from '@dfinity/utils';

/**
 * Rewrites the signed-out pending-onboarding payload (`PENDING_ONBOARDING_STORAGE_KEY`) through
 * `update`, keeping whatever an earlier surface stashed. Best-effort: storage may be unavailable
 * (private mode) or hold garbage, and signup still works without the stash.
 */
const updatePendingStash = (
	update: (payload: Record<string, unknown>) => Record<string, unknown> | undefined
): void => {
	if (!browser) {
		return;
	}

	try {
		const next = update(pendingPayloadOf(localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY)));

		if (nonNullish(next)) {
			localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(next));
		}
	} catch {
		// Swallowed by design: attribution never breaks the visit.
	}
};

/**
 * Credits `inviter` on sign-up. Last touch wins between the channels: a challenge link replaces a
 * stashed referral code and the other way round. With `keepExisting`, a payload that already
 * holds a referral code is left alone: the `?ref=` capture of a share link, first referrer wins
 * among codes, still replaces a challenge link.
 */
export const stashInviterForSignup = ({
	inviter,
	keepExisting = false
}: {
	inviter: PendingInviter;
	keepExisting?: boolean;
}): void => {
	updatePendingStash((payload) =>
		keepExisting && hasPendingReferralCode(payload)
			? undefined
			: withPendingInviter({ payload, inviter })
	);
};

/**
 * Merge a league-invite capture into the signed-out pending-onboarding
 * payload (`PENDING_ONBOARDING_STORAGE_KEY`), preserving whatever an earlier
 * surface already stashed. The signup drain (`(app)/+layout.svelte`) redeems
 * the payload once the new account's profile exists.
 *
 * The league invite always overwrites (latest link wins). Its referral code
 * is first-referrer-wins among codes (an earlier invite or `?ref=` capture
 * is kept) and, like every invite, replaces a stashed challenge link.
 */
export const stashLeagueInviteForSignup = ({
	inviteCode,
	referralCode
}: {
	inviteCode: string;
	referralCode?: string;
}): void => {
	updatePendingStash((payload) => {
		const next = { ...payload, leagueInvite: inviteCode };

		return nonNullish(referralCode) && !hasPendingReferralCode(next)
			? withPendingInviter({ payload: next, inviter: { referralCode } })
			: next;
	});
};
