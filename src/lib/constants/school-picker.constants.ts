import { MINUTE_IN_MS } from '#lib/constants/app.constants.ts';

/**
 * School-picker feature gating.
 *
 * The "add your own university" pass: submit a school + school email,
 * receive a 6-digit code, verify membership. When `true`, the picker
 * exposes the add-your-own CTAs, founder badges, and the empty-state
 * "add" hero, and the submit/verify round-trips call the satellite
 * `submitSchool` / `verifySchoolCode` endpoints (which mail the code via
 * the `vici-courier` relay). When `false`, only the directory browse +
 * fuzzy search + status badges + the always-reachable "use it
 * unverified" path ship.
 *
 * Prerequisites for `true` to actually work in an environment: the
 * satellite functions for that environment must be the build that
 * includes `submitSchool` / `verifySchoolCode`, AND a controller must
 * have set the `app_config/school_relay` doc; otherwise submit fails
 * server-side (gated by the relay config). Confirm both before
 * deploying the frontend with this on.
 */
export const SCHOOL_PASS2_ENABLED = true;

/**
 * Cap on how many "founder" badges render in a single directory list,
 * so an unseeded region doesn't wallpaper every row with the badge.
 */
export const SCHOOL_FOUNDER_BADGE_CAP = 3;

/**
 * Time-to-live of a verification code (ms). After this the submission is
 * dead and the user must request a fresh code. Set to ~30 minutes.
 */
export const SCHOOL_CODE_TTL_MS = 30 * MINUTE_IN_MS;

/**
 * Max wrong code entries before a submission is locked. Bounds online
 * guessing of the 6-digit space to {@link SCHOOL_CODE_MAX_ATTEMPTS} in
 * 1,000,000 per submission, the real defense, since the stored digest
 * is not cryptographic.
 */
export const SCHOOL_CODE_MAX_ATTEMPTS = 5;

/**
 * Max code sends per principal per rolling 24h, and (separately) per
 * email per rolling 24h. Defends the email vendor + the user's inbox
 * against being used as a spam relay.
 */
export const SCHOOL_VERIFY_DAILY_CAP = 5;
