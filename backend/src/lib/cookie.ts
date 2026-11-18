// Session + OAuth-state cookies. HttpOnly always: the cookie is the only
// client-held credential and JS must never read it. Secure and Domain come
// from env; the builder takes overrides so tests can assert prod flags
// without rebuilding the env singleton.

import { isNullish } from '@dfinity/utils';
import { env } from '../env';

export const SESSION_COOKIE = 'vici_session';
export const OAUTH_STATE_COOKIE = 'vici_oauth_state';
export const APPLE_STATE_COOKIE = 'vici_apple_state';

export interface CookieOptions {
	secure: boolean;
	domain: string;
	sameSite: 'Lax' | 'Strict' | 'None';
}

/** Serialize a Set-Cookie value. Options default to the env-driven posture
 * (Secure in prod, Domain from COOKIE_DOMAIN, SameSite=Lax). */
export const buildCookie = (
	name: string,
	value: string,
	maxAgeSeconds: number,
	options: Partial<CookieOptions> = {}
): string => {
	const secure = options.secure ?? env.isProd;
	const domain = options.domain ?? env.cookieDomain;
	const sameSite = options.sameSite ?? 'Lax';

	const parts = [
		`${name}=${value}`,
		'HttpOnly',
		'Path=/',
		`SameSite=${sameSite}`,
		`Max-Age=${maxAgeSeconds}`
	];

	if (secure) {
		parts.push('Secure');
	}

	if (domain !== '') {
		parts.push(`Domain=${domain}`);
	}

	return parts.join('; ');
};

export const sessionCookie = (token: string): string =>
	buildCookie(SESSION_COOKIE, token, env.sessionTtlHours * 3600);

export const clearSessionCookie = (): string => buildCookie(SESSION_COOKIE, '', 0);

const OAUTH_STATE_TTL_SECONDS = 600;

export const oauthStateCookie = (signedState: string): string =>
	buildCookie(OAUTH_STATE_COOKIE, signedState, OAUTH_STATE_TTL_SECONDS);

export const clearOauthStateCookie = (): string => buildCookie(OAUTH_STATE_COOKIE, '', 0);

// Apple's form_post callback arrives as a cross-site POST, which drops
// SameSite=Lax cookies: the Apple state cookie must be None + Secure.
// (Sign in with Apple only works over HTTPS anyway.)
export const appleStateCookie = (signedState: string): string =>
	buildCookie(APPLE_STATE_COOKIE, signedState, OAUTH_STATE_TTL_SECONDS, {
		sameSite: 'None',
		secure: true
	});

export const clearAppleStateCookie = (): string =>
	buildCookie(APPLE_STATE_COOKIE, '', 0, { sameSite: 'None', secure: true });

/** Read a single cookie value from a raw `Cookie` header. */
export const readCookie = (header: string | null, name: string): string | null => {
	if (isNullish(header)) {
		return null;
	}

	for (const part of header.split(';')) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf('=');

		if (eq !== -1 && trimmed.slice(0, eq) === name) {
			return trimmed.slice(eq + 1);
		}
	}

	return null;
};
