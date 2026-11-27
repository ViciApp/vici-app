import { NEW_APP_ORIGIN } from '#lib/constants/claim.constants.ts';
import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
import { isE2eOpenSignups } from '#lib/dev/e2e-signups.ts';
import { viteEnv } from '#lib/env/app.env.ts';
import { newAppSignupUrl } from '#lib/utils/new-app.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { browser } from '$app/env';
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

/**
 * The legacy build after the cutover: every route renders the moved screen and
 * sends the visitor to the new app's landing. Built only with
 * `VITE_LEGACY_SHUTDOWN=true` (the flag that also write-freezes the satellite
 * in `juno.config.ts`, see `.agents/workflows/cutover.md`), so the legacy app
 * keeps working until the cutover deploys it. The satellite serves an existing
 * asset before any hosting redirect, and the shell is one, so this screen is
 * what every load of vici.market gets, installed apps included. A tab still
 * running the previous bundle reaches it through the maintenance reload the
 * cutover triggers by stopping the satellite.
 */
export const isLegacyShutDown = (): boolean =>
	!isWeb2Backend() && viteEnv()?.VITE_LEGACY_SHUTDOWN === 'true';

/**
 * Where the shut-down legacy build sends every visitor: the new app's landing,
 * whatever page they opened. Legacy accounts were not carried over and the new
 * app has no public sign-in, so a legacy path (`/signin`, a market, an invite)
 * has nothing to land on there.
 */
export const newAppLandingUrl = (): string => new URL('/', NEW_APP_ORIGIN).href;

/** Host of the new app, for copy that names it (`vici.app`). */
export const newAppDomain = (): string => new URL(NEW_APP_ORIGIN).host;
