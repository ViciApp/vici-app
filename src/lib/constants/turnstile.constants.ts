import { MINUTE_IN_MS } from '#lib/constants/time.constants.ts';

/** Cloudflare's loader. `render=explicit` keeps it from scanning the page for
 * widgets; the app renders the one it needs when it needs a token. */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** The global the loader calls once its API is ready (its `onload` param). */
export const TURNSTILE_ONLOAD_CALLBACK = '__viciTurnstileReady';

/** The action the anonymous handle probe's widget is rendered with. The API
 * refuses a token minted for any other action (mirrored by
 * `NICKNAME_CHECK_TURNSTILE_ACTION` in backend/src/profiles/nickname.ts). */
export const TURNSTILE_ACTION_HANDLE_CHECK = 'handle_check';

/** The action the email sign-in code request's widget is rendered with, so a
 * token solved for the handle probe cannot buy an email (mirrored by
 * `OTP_REQUEST_TURNSTILE_ACTION` in backend/src/auth/otp.ts). */
export const TURNSTILE_ACTION_EMAIL_CODE = 'email_code';

/** The action the landing's waitlist code request is rendered with: each
 * request sends an email, so it costs a fresh solve of its own (mirrored by
 * `WAITLIST_CODE_TURNSTILE_ACTION` in backend/src/waitlist/reservations.ts). */
export const TURNSTILE_ACTION_WAITLIST_CODE = 'waitlist_code';

/** How long a token request may take. Most solves are invisible and take a
 * second or two; this leaves a visitor who is shown a challenge time to answer
 * it before the request gives up. */
export const TURNSTILE_TOKEN_TIMEOUT_MS = 2 * MINUTE_IN_MS;

/** How long before the server's expiry a held bot-check proof is renewed, so
 * a probe sent just before it lapses is not refused in flight. */
export const HUMAN_PROOF_RENEW_MARGIN_MS = MINUTE_IN_MS / 2;
