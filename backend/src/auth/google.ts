// Google OAuth 2.0 authorization-code flow. A successful exchange proves
// email ownership (Google reports email_verified); account provisioning and
// linking happen in identity.ts.

import { isNullish } from '@dfinity/utils';
import { env } from '../env';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const redirectUri = (): string =>
	env.google.redirectUri !== ''
		? env.google.redirectUri
		: `${env.apiBaseUrl}/api/v1/auth/google/callback`;

export interface GoogleProfile {
	sub: string;
	email: string;
	name: string;
	emailVerified: boolean;
}

/** Build the Google consent URL. `state` is echoed back and checked against
 * the signed state cookie in the callback (CSRF protection). */
export const buildAuthUrl = (state: string): string => {
	const params = new URLSearchParams({
		client_id: env.google.clientId,
		redirect_uri: redirectUri(),
		response_type: 'code',
		scope: 'openid email profile',
		state,
		access_type: 'online',
		prompt: 'select_account'
	});

	return `${AUTH_URL}?${params.toString()}`;
};

/** Exchange an authorization code for the user's profile, or null on any
 * provider-side failure. */
export const exchangeCode = async (code: string): Promise<GoogleProfile | null> => {
	const tokenRes = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: env.google.clientId,
			client_secret: env.google.clientSecret,
			redirect_uri: redirectUri(),
			grant_type: 'authorization_code'
		})
	});

	if (!tokenRes.ok) {
		return null;
	}

	const token = (await tokenRes.json()) as { access_token?: string };

	if (isNullish(token.access_token)) {
		return null;
	}

	const infoRes = await fetch(USERINFO_URL, {
		headers: { authorization: `Bearer ${token.access_token}` }
	});

	if (!infoRes.ok) {
		return null;
	}

	const info = (await infoRes.json()) as {
		sub?: string;
		email?: string;
		email_verified?: boolean;
		name?: string;
	};

	if (isNullish(info.sub) || isNullish(info.email)) {
		return null;
	}

	return {
		sub: info.sub,
		email: info.email,
		name: info.name ?? '',
		emailVerified: info.email_verified ?? false
	};
};
