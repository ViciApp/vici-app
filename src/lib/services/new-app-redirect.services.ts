import { NEW_APP_ORIGIN } from '#lib/constants/claim.constants.ts';
import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
import { PublicPath } from '#lib/constants/routes.constants.ts';
import { isE2eOpenSignups } from '#lib/dev/e2e-signups.ts';
import { viteEnv } from '#lib/env/app.env.ts';
import { landingHref } from '#lib/utils/nav.utils.ts';
import { newAppPageUrl, newAppSignupUrl } from '#lib/utils/new-app.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { browser } from '$app/env';
import { resolve } from '$app/paths';
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
 * Where an invite or league link sends a signed-out visitor, after stashing
 * its codes: the landing's claim capsule (`/?claim=1`), the one signed-out
 * funnel, which reads the stash for the claim. Where sign-ups have moved (the
 * legacy build) it stays `/signup`, whose moved screen carries the codes to
 * the new app.
 */
export const signedOutInviteHref = (): string =>
	areNewSignupsMoved() ? resolve(PublicPath.SignUp) : landingHref({ claim: true });

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
 * sends the visitor to the same page on the new app. Built only with
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
 * While the new app is closed to the public, sign-in there is for the team
 * only: the API refuses every other address, so no public page offers a way
 * in, and the team signs in at the unlinked `/team`. The legacy build keeps
 * its sign-in screen for its existing accounts.
 */
export const isTeamOnlySignIn = (): boolean => isWeb2Backend();

/**
 * Where a visitor with no session is sent: the landing where sign-in is
 * team-only, the sign-in screen on the legacy build.
 */
export const signedOutHomePath = (): string =>
	isTeamOnlySignIn() ? resolve(PublicPath.Landing) : resolve(PublicPath.SignIn);

/**
 * The sign-in screen, for someone already inside who signs in again (another
 * method, a dismissed refusal): the team's `/team` where sign-in is team-only,
 * `/signin` on the legacy build.
 */
export const signInScreenPath = (): string =>
	isTeamOnlySignIn() ? resolve(PublicPath.Team) : resolve(PublicPath.SignIn);

/** The page being viewed, on the new app. */
export const loadNewAppPageUrl = (): string => {
	if (!browser) {
		return NEW_APP_ORIGIN;
	}

	const { pathname, search, hash } = window.location;

	return newAppPageUrl({ origin: NEW_APP_ORIGIN, pathname, search, hash });
};

/** Host of the new app, for copy that names it (`vici.app`). */
export const newAppDomain = (): string => new URL(NEW_APP_ORIGIN).host;
