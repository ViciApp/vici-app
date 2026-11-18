// Cryptographic primitives for auth. Session and OTP secrets are opaque random
// values; whatever lands in the database is peppered with the server secret so
// a database leak alone cannot forge a session cookie or replay a code.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

/** A URL-safe random token. 32 bytes = 256 bits of entropy. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** HMAC-SHA256 a secret value with the server pepper before storing it. */
export const peppered = (value: string): string =>
	createHmac('sha256', env.sessionSecret).update(value).digest('hex');

/** Constant-time string compare; length mismatch short-circuits, which leaks
 * only the length (public for the fixed-size digests compared here). */
export const constantTimeEqual = (a: string, b: string): boolean => {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);

	if (ab.length !== bb.length) {
		return false;
	}

	return timingSafeEqual(ab, bb);
};

/** A zero-padded numeric one-time code. `randomInt` rejection-samples, so
 * every code in the range is equally likely (a plain modulo would bias the
 * low codes). */
export const generateOtp = (digits = 6): string => {
	const ceiling = 10 ** digits;

	return randomInt(ceiling).toString().padStart(digits, '0');
};

/** Sign an OAuth state value for the round-trip cookie: `state.hmac(state)`.
 * The callback both checks the signature and compares the embedded state to
 * the one echoed by the provider (CSRF protection). */
export const signState = (state: string): string => `${state}.${peppered(state)}`;

/** Verify a signed state cookie value; the embedded state on success, null on
 * any tamper or shape mismatch. */
export const verifySignedState = (value: string): string | null => {
	const separator = value.lastIndexOf('.');

	if (separator <= 0) {
		return null;
	}

	const state = value.slice(0, separator);
	const signature = value.slice(separator + 1);

	return constantTimeEqual(signature, peppered(state)) ? state : null;
};
