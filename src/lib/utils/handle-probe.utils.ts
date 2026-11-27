/** Which availability probe answers a handle: the session-gated one, or the
 * signed-out one behind the bot check. */
export type HandleProbeRoute = 'session' | 'public';

/**
 * The probe for a handle typed into a picker. The session-gated probe refuses
 * a caller without a session, so a visitor choosing a handle before sign-up
 * takes the public one; a signed-in user keeps the session probe, which does
 * not count their own current handle as taken.
 */
export const handleProbeRoute = ({ signedIn }: { signedIn: boolean }): HandleProbeRoute =>
	signedIn ? 'session' : 'public';

/** Why a probe gave no answer, as far as the picker can tell the user:
 * throttled (asking again soon will not help), or anything else. */
export type HandleProbeFailure = 'rate_limited' | 'unverified';

/** Reads the API's error `code` of a failed probe; a failure without one (a
 * network error, a bot check that never resolved) is `unverified`. */
export const handleProbeFailure = (code: string | undefined): HandleProbeFailure =>
	code === 'rate_limited' ? 'rate_limited' : 'unverified';

/** Whether a public probe failure means the API cannot run the bot check at
 * all (no secret in production), so no later probe in the page can succeed
 * and none should be sent. Cloudflare out of reach (`turnstile_unavailable`)
 * is transient and does not latch. */
export const latchesPublicProbe = (code: string | undefined): boolean =>
	code === 'turnstile_unconfigured';
