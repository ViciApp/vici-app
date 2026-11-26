/** Which availability probe answers a handle: the session-gated one, or the
 * signed-out one behind the bot check. */
export type HandleProbeRoute = 'session' | 'public';

/**
 * The probe for a handle typed into a picker. In web2 mode the session-gated
 * probe refuses a caller without a session, so a visitor choosing a handle
 * before sign-up takes the public one; a signed-in user keeps the session
 * probe, which does not count their own current handle as taken. The default
 * backend's probe is an anonymous query already, so it stays on one path
 * whoever is signed in.
 */
export const handleProbeRoute = ({
	web2Backend,
	signedIn
}: {
	web2Backend: boolean;
	signedIn: boolean;
}): HandleProbeRoute => (web2Backend && !signedIn ? 'public' : 'session');

/** Why a probe gave no answer, as far as the picker can tell the user:
 * throttled (asking again soon will not help), or anything else. */
export type HandleProbeFailure = 'rate_limited' | 'unverified';

/** Reads the API's error `code` of a failed probe; a failure without one (a
 * network error, a bot check that never resolved) is `unverified`. */
export const handleProbeFailure = (code: string | undefined): HandleProbeFailure =>
	code === 'rate_limited' ? 'rate_limited' : 'unverified';
