// Auth surface: email OTP, Google OAuth (redirect + callback with a signed
// state cookie), env-gated Apple Sign In, logout, provider discovery, and the
// session-derived /me read. Sessions live in Postgres behind the HttpOnly
// vici_session cookie; login always rotates the token.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import * as apple from '../auth/apple';
import { BETA_CLOSED_ERROR, isBetaSignInAllowed } from '../auth/beta-gate';
import * as google from '../auth/google';
import { requireUser, unauthenticated } from '../auth/guard';
import { resolveIdentity } from '../auth/identity';
import { decodeOauthState, encodeOauthState, sanitizeReturnTo } from '../auth/oauth-state';
import { requestOtp, verifyOtp } from '../auth/otp';
import { revokeToken, rotateSession } from '../auth/sessions';
import { query } from '../db/client';
import { env } from '../env';
import {
	APPLE_STATE_COOKIE,
	OAUTH_STATE_COOKIE,
	SESSION_COOKIE,
	appleStateCookie,
	clearAppleStateCookie,
	clearOauthStateCookie,
	clearSessionCookie,
	oauthStateCookie,
	readCookie,
	sessionCookie
} from '../lib/cookie';
import { constantTimeEqual, randomToken, signState, verifySignedState } from '../lib/crypto';
import { clientIp } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';

const TEN_MIN_MS = 10 * 60 * 1000;

type ProviderStatus = 'available' | 'coming_soon';

const providerStatuses = (): Record<'email' | 'google' | 'apple', ProviderStatus> => ({
	email: 'available',
	google: env.google.enabled ? 'available' : 'coming_soon',
	apple: env.apple.enabled ? 'available' : 'coming_soon'
});

interface StatusContext {
	status?: number | string;
}

/** Stable body for a provider whose integration is not configured; the FE
 * renders a disabled "coming soon" button from /auth/providers instead of
 * ever hitting this in practice. */
const providerUnavailable = (set: StatusContext): { error: string } => {
	set.status = 503;

	return { error: 'provider_unavailable' };
};

/** Gated sign-in refusal. One stable body for every non-allowlisted address,
 * so the response can never double as an address-existence oracle. */
const betaClosed = (set: StatusContext): { error: string } => {
	set.status = 403;

	return { error: BETA_CLOSED_ERROR };
};

interface MeIdentity {
	provider: string;
	email: string | null;
}

interface MeUser {
	id: string;
	role: string;
	displayName: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

const meFor = async (userId: string): Promise<Record<string, unknown> | null> => {
	const users = await query<{
		id: string;
		role: string;
		display_name: string | null;
		avatar_url: string | null;
		created_at: Date;
	}>(`select id, role, display_name, avatar_url, created_at from users where id = $1`, [userId]);
	const [user] = users;

	if (isNullish(user)) {
		return null;
	}

	const identities = await query<{ provider: string; email: string | null }>(
		`select provider, email from auth_identities where user_id = $1 order by created_at`,
		[userId]
	);
	const principals = await query<{ principal: string; matched_via: string }>(
		`select principal, matched_via from legacy_principals where user_id = $1 order by linked_at`,
		[userId]
	);

	const shaped: MeUser = {
		id: user.id,
		role: user.role,
		displayName: user.display_name,
		avatarUrl: user.avatar_url,
		createdAt: user.created_at.toISOString()
	};

	return {
		...shaped,
		identities: identities satisfies MeIdentity[],
		legacyPrincipals: principals.map((p) => ({ principal: p.principal, matchedVia: p.matched_via }))
	};
};

/** Login response: rotate the session (revoking whatever cookie rode in) and
 * answer with the fresh session cookie. */
const loginCookies = async (request: Request, userId: string): Promise<string> => {
	const previousToken = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
	const token = await rotateSession({ userId, previousToken });

	return sessionCookie(token);
};

/** 302 to the SPA with a one-time state cookie cleared plus any extra
 * cookies. Raw Response so multiple Set-Cookie headers can ride along. */
const redirectToApp = ({
	path,
	clearStateCookie,
	extraCookies = []
}: {
	path: string;
	clearStateCookie: string;
	extraCookies?: string[];
}): Response => {
	const headers = new Headers();

	headers.set('location', `${env.publicAppUrl}${path}`);
	headers.append('set-cookie', clearStateCookie);

	for (const cookie of extraCookies) {
		headers.append('set-cookie', cookie);
	}

	return new Response(null, { status: 302, headers });
};

/** Whether the provider-echoed state matches the signed state cookie. */
const stateMatches = (cookieValue: string | null, echoedState: string): boolean => {
	if (isNullish(cookieValue) || echoedState === '') {
		return false;
	}

	const state = verifySignedState(cookieValue);

	return !isNullish(state) && constantTimeEqual(state, echoedState);
};

export const authRoutes = new Elysia({ prefix: '/api/v1' })
	.get('/me', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const me = await meFor(user.id);

		if (isNullish(me)) {
			return unauthenticated(set);
		}

		return { user: me };
	})

	.get('/auth/providers', () => ({ providers: providerStatuses() }))

	.post(
		'/auth/otp/request',
		async ({ body, request, set }) => {
			const limited = enforceLimit({
				set,
				name: 'otp_request',
				ip: clientIp(request),
				limit: 5,
				windowMs: TEN_MIN_MS
			});

			if (limited) {
				return limited;
			}

			const email = body.email.trim();

			if (email === '' || !email.includes('@')) {
				set.status = 400;

				return { error: 'invalid_email' };
			}

			if (!(await isBetaSignInAllowed(email))) {
				return betaClosed(set);
			}

			await requestOtp(email);
			set.headers['cache-control'] = 'no-store';

			return { ok: true };
		},
		{ body: t.Object({ email: t.String() }) }
	)

	.post(
		'/auth/otp/verify',
		async ({ body, request, set }) => {
			const limited = enforceLimit({
				set,
				name: 'otp_verify',
				ip: clientIp(request),
				limit: 15,
				windowMs: TEN_MIN_MS
			});

			if (limited) {
				return limited;
			}

			// Re-checked here (not only at request time) so a code issued before
			// the gate flipped on cannot still mint a session.
			if (!(await isBetaSignInAllowed(body.email))) {
				return betaClosed(set);
			}

			const result = await verifyOtp({ email: body.email, code: body.code });

			if (!result.ok) {
				set.status = result.reason === 'locked' ? 429 : 401;

				return { error: result.reason };
			}

			set.headers['set-cookie'] = await loginCookies(request, result.userId);
			set.headers['cache-control'] = 'no-store';

			const me = await meFor(result.userId);

			return { user: me };
		},
		{ body: t.Object({ email: t.String(), code: t.String() }) }
	)

	.get('/auth/google', ({ query: qs, request, set }) => {
		const limited = enforceLimit({
			set,
			name: 'google',
			ip: clientIp(request),
			limit: 20,
			windowMs: TEN_MIN_MS
		});

		if (limited) {
			return limited;
		}

		if (!env.google.enabled) {
			return providerUnavailable(set);
		}

		const state = randomToken(16);
		// Post-login landing path: clamped to a same-app absolute path (open
		// redirects collapse to '/') and carried inside the signed state cookie
		// so it cannot be tampered with between here and the callback.
		const returnTo = sanitizeReturnTo(qs.returnTo);

		set.headers['set-cookie'] = oauthStateCookie(encodeOauthState({ state, returnTo }));
		set.status = 302;
		set.headers.location = google.buildAuthUrl(state);

		return '';
	})

	.get('/auth/google/callback', async ({ query: qs, request }) => {
		const cookieValue = readCookie(request.headers.get('cookie'), OAUTH_STATE_COOKIE);
		const code = typeof qs.code === 'string' ? qs.code : '';
		const state = typeof qs.state === 'string' ? qs.state : '';
		const clearStateCookie = clearOauthStateCookie();
		const statePayload = decodeOauthState(cookieValue);

		if (
			!env.google.enabled ||
			code === '' ||
			state === '' ||
			isNullish(statePayload) ||
			!constantTimeEqual(statePayload.state, state)
		) {
			return redirectToApp({ path: '/?e=state', clearStateCookie });
		}

		const profile = await google.exchangeCode(code);

		if (isNullish(profile) || !profile.emailVerified) {
			return redirectToApp({ path: '/?e=google', clearStateCookie });
		}

		// The redirect flow's counterpart of the 403 beta_closed body: the
		// browser is mid-navigation, so the refusal rides the landing path.
		if (!(await isBetaSignInAllowed(profile.email))) {
			return redirectToApp({ path: '/signin?e=beta', clearStateCookie });
		}

		const userId = await resolveIdentity({
			provider: 'google',
			subject: profile.sub,
			email: profile.email,
			displayName: profile.name
		});

		return redirectToApp({
			path: statePayload.returnTo,
			clearStateCookie,
			extraCookies: [await loginCookies(request, userId)]
		});
	})

	.get('/auth/apple', ({ request, set }) => {
		const limited = enforceLimit({
			set,
			name: 'apple',
			ip: clientIp(request),
			limit: 20,
			windowMs: TEN_MIN_MS
		});

		if (limited) {
			return limited;
		}

		if (!env.apple.enabled) {
			return providerUnavailable(set);
		}

		const state = randomToken(16);

		set.headers['set-cookie'] = appleStateCookie(signState(state));
		set.status = 302;
		set.headers.location = apple.buildAuthUrl(state);

		return '';
	})

	// Apple posts the callback (response_mode=form_post is mandatory with the
	// name/email scope), so this is a cross-site POST: the state cookie is
	// SameSite=None and the redirect back to the SPA is a plain 302.
	.post(
		'/auth/apple/callback',
		async ({ body, request, set }) => {
			if (!env.apple.enabled) {
				return providerUnavailable(set);
			}

			const cookieValue = readCookie(request.headers.get('cookie'), APPLE_STATE_COOKIE);
			const code = body.code ?? '';
			const state = body.state ?? '';
			const clearStateCookie = clearAppleStateCookie();

			// Apple reports OAuth failures (e.g. user_cancelled_authorize) in the
			// `error` field with no code; that is not a CSRF problem, so report it
			// as an Apple-side failure rather than ?e=state.
			if (!isNullish(body.error) && body.error !== '') {
				return redirectToApp({ path: '/?e=apple', clearStateCookie });
			}

			if (code === '' || !stateMatches(cookieValue, state)) {
				return redirectToApp({ path: '/?e=state', clearStateCookie });
			}

			const profile = await apple.exchangeCode(code);

			if (isNullish(profile) || !profile.emailVerified) {
				return redirectToApp({ path: '/?e=apple', clearStateCookie });
			}

			if (!(await isBetaSignInAllowed(profile.email))) {
				return redirectToApp({ path: '/signin?e=beta', clearStateCookie });
			}

			// Apple sends the user's name only on the very first authorization, as
			// a JSON string in the `user` form field.
			let displayName = '';

			if (!isNullish(body.user) && body.user !== '') {
				try {
					const parsed = JSON.parse(body.user) as {
						name?: { firstName?: string; lastName?: string };
					};

					displayName = [parsed.name?.firstName, parsed.name?.lastName]
						.filter((part) => !isNullish(part) && part !== '')
						.join(' ');
				} catch {
					// malformed user payload: proceed without a name
				}
			}

			const userId = await resolveIdentity({
				provider: 'apple',
				subject: profile.sub,
				email: profile.email,
				displayName
			});

			return redirectToApp({
				path: '/',
				clearStateCookie,
				extraCookies: [await loginCookies(request, userId)]
			});
		},
		{
			body: t.Object({
				code: t.Optional(t.String()),
				state: t.Optional(t.String()),
				user: t.Optional(t.String()),
				error: t.Optional(t.String())
			})
		}
	)

	.post('/auth/logout', async ({ request, set }) => {
		const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);

		if (!isNullish(token) && token !== '') {
			await revokeToken(token);
		}

		set.headers['set-cookie'] = clearSessionCookie();

		return { ok: true };
	});
