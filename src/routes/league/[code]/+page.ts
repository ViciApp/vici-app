import { SIGNED_IN_FLAG_KEY } from '#lib/constants/app.constants.ts';
import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
import { PublicPath } from '#lib/constants/routes.constants.ts';
import { LEAGUE_INVITE_CODE_REGEX } from '#lib/types/league.ts';
import { stashLeagueInviteForSignup } from '#lib/utils/pending-onboarding.utils.ts';
import { browser } from '$app/env';
import { resolve } from '$app/paths';
import { nonNullish } from '@dfinity/utils';
import { redirect, type LoadEvent } from '@sveltejs/kit';

/**
 * Signed-out fast path. Invite links are sent to people with a cold cache
 * and no session, and their destination is always the same: stash the codes
 * and land on `/signup`. That branch needs no auth and no satellite: yet
 * the page component can only take it after the boot gate lifts
 * (`initSatellite`) and the auth handshake settles (`authBusy`), several
 * seconds a first-time mobile visitor spends on a spinner.
 *
 * This load runs at navigation time, before any of that: a device that has
 * never signed in here carries no `SIGNED_IN_FLAG_KEY` hint, so it redirects
 * straight to signup. Devices WITH the hint (and the rare storage-read
 * failure, which can't tell) fall through to the page's auth-aware flow
 * unchanged: a hint can be stale, and only the settled handshake can say
 * whether to join directly instead.
 */
export const load = ({ params, url }: LoadEvent): void => {
	if (!browser) {
		return;
	}

	try {
		if (localStorage.getItem(SIGNED_IN_FLAG_KEY) === '1') {
			return;
		}
	} catch {
		return;
	}

	const inviteCode = (params.code ?? '').toUpperCase().trim();

	// Malformed codes stay on the page: it owns the invalid-code toast.
	if (!LEAGUE_INVITE_CODE_REGEX.test(inviteCode)) {
		return;
	}

	const rawRef = url.searchParams.get('ref')?.toUpperCase().trim();
	const referralCode = nonNullish(rawRef) && REFERRAL_CODE_REGEX.test(rawRef) ? rawRef : undefined;

	stashLeagueInviteForSignup({ inviteCode, referralCode });

	throw redirect(307, resolve(PublicPath.SignUp));
};
