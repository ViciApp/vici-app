import { browser } from '$app/environment';
import { NEW_APP_ORIGIN } from '$lib/constants/claim.constants';
import { PENDING_ONBOARDING_STORAGE_KEY } from '$lib/constants/profile.constants';
import { isE2eOpenSignups } from '$lib/dev/e2e-signups';
import { newAppSignupUrl } from '$lib/utils/new-app.utils';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import { isNullish } from '@dfinity/utils';

/**
 * New accounts are created on the new stack only. The legacy on-chain build
 * keeps serving existing accounts (sign-in, play, claim) but turns every
 * would-be new user away to the new app: the sign-up surface renders the
 * moved screen and a sign-in that resolves to a principal with no profile is
 * signed back out before anything is written. The satellite enforces the same
 * rule server-side (`assertNewProfileAllowed`).
 *
 * Backend-mode gates live here (never in components): the web2 build is the
 * new app itself and keeps its sign-up flow untouched.
 */
export const areNewSignupsMoved = (): boolean => !isWeb2Backend() && !isE2eOpenSignups();

/**
 * The new-app destination for the moved screen, carrying the invite or
 * referral code a legacy landing surface (`/i/{code}`, `/league/{code}`,
 * a `?ref=` share link) stashed for the sign-up drain. Best-effort: storage
 * may be unavailable or hold garbage, in which case the plain sign-up URL
 * is returned.
 */
export const loadNewAppSignupUrl = (): string => {
	const fallback = newAppSignupUrl({ origin: NEW_APP_ORIGIN });

	if (!browser) {
		return fallback;
	}

	try {
		const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);

		if (isNullish(raw)) {
			return fallback;
		}

		const parsed: unknown = JSON.parse(raw);

		if (typeof parsed !== 'object' || isNullish(parsed)) {
			return fallback;
		}

		const { referralCode, leagueInvite } = parsed as Record<string, unknown>;

		return newAppSignupUrl({
			origin: NEW_APP_ORIGIN,
			referralCode: typeof referralCode === 'string' ? referralCode : undefined,
			leagueInvite: typeof leagueInvite === 'string' ? leagueInvite : undefined
		});
	} catch {
		return fallback;
	}
};

/** Host of the new app, for copy that names it (`vici.app`). */
export const newAppDomain = (): string => new URL(NEW_APP_ORIGIN).host;
