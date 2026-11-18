// Signed OAuth state payload for the Google flow: the CSRF token and the
// post-login landing path travel together inside the one signed state
// cookie, so neither can be tampered with independently and no second
// (unsigned) cookie is needed.

import { isNullish } from '@dfinity/utils';
import { signState, verifySignedState } from '../lib/crypto';

export interface OauthStatePayload {
	/** Random CSRF token echoed by the provider and compared on callback. */
	state: string;
	/** Same-app absolute path to land on after the callback. */
	returnTo: string;
}

/** Longest returnTo carried through the state cookie: anything beyond this
 * is almost certainly garbage, and cookies have size budgets. */
const MAX_RETURN_TO_LENGTH = 512;

/**
 * Clamp a client-supplied returnTo to a same-app absolute path; anything
 * else collapses to `/`. Absolute URLs and protocol-relative `//host` (or
 * its `/\` backslash spelling) would let the callback 302 to an attacker
 * origin, and a `scheme:` payload (`javascript:`, `https:`) can never start
 * with a single `/`, so the leading-slash rule rules those out too.
 */
export const sanitizeReturnTo = (value: unknown): string => {
	if (typeof value !== 'string' || value === '' || value.length > MAX_RETURN_TO_LENGTH) {
		return '/';
	}

	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return '/';
	}

	// Browsers normalize backslashes to slashes in ways that can resurrect a
	// protocol-relative URL, and control characters never belong in a path.
	if (value.includes('\\') || /\p{Cc}/u.test(value)) {
		return '/';
	}

	return value;
};

/** Serialize and sign the payload for the state cookie. */
export const encodeOauthState = ({ state, returnTo }: OauthStatePayload): string =>
	signState(Buffer.from(JSON.stringify({ state, returnTo })).toString('base64url'));

/** Verify a state cookie and recover its payload; null on any tamper or
 * shape mismatch. `returnTo` is re-clamped on the way out; the signature
 * already pins it, but the clamp is cheap defense in depth. */
export const decodeOauthState = (cookieValue: string | null): OauthStatePayload | null => {
	if (isNullish(cookieValue)) {
		return null;
	}

	const payload = verifySignedState(cookieValue);

	if (isNullish(payload)) {
		return null;
	}

	try {
		const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
			state?: unknown;
			returnTo?: unknown;
		};

		if (
			typeof parsed.state !== 'string' ||
			parsed.state === '' ||
			typeof parsed.returnTo !== 'string'
		) {
			return null;
		}

		return { state: parsed.state, returnTo: sanitizeReturnTo(parsed.returnTo) };
	} catch {
		// Legacy plain-state cookies (or corrupted values) fail JSON decoding;
		// the caller treats that exactly like a state mismatch.
		return null;
	}
};
