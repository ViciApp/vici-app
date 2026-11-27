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

/** How long a token request may take. Most solves are invisible and take a
 * second or two; this leaves a visitor who is shown a challenge time to answer
 * it before the request gives up. */
export const TURNSTILE_TOKEN_TIMEOUT_MS = 2 * MINUTE_IN_MS;

/** How long before the server's expiry a held bot-check proof is renewed, so
 * a probe sent just before it lapses is not refused in flight. */
export const HUMAN_PROOF_RENEW_MARGIN_MS = MINUTE_IN_MS / 2;
