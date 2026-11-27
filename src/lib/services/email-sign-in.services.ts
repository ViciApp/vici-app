import { ApiError, requestOtp } from '#lib/api-client/client.ts';
import { TURNSTILE_ACTION_EMAIL_CODE } from '#lib/constants/turnstile.constants.ts';
import { acquireTurnstileToken } from '#lib/services/turnstile.services.ts';

/**
 * Why a sign-in code was not sent:
 * - bot_check_failed: no token could be solved here, or the API refused it;
 *   another try solves a fresh one.
 * - bot_check_unavailable: the API could not check the token at all.
 * - rate_limited: too many requests from this network or for this inbox.
 * - beta_closed: the beta gate's refusal.
 * - failed: anything else (network, malformed address).
 */
export type EmailSignInCodeRefusal =
	'bot_check_failed' | 'bot_check_unavailable' | 'rate_limited' | 'beta_closed' | 'failed';

export type EmailSignInCodeResult = { ok: true } | { ok: false; reason: EmailSignInCodeRefusal };

const REFUSALS: Partial<Record<string, EmailSignInCodeRefusal>> = {
	turnstile_failed: 'bot_check_failed',
	turnstile_unavailable: 'bot_check_unavailable',
	turnstile_unconfigured: 'bot_check_unavailable',
	rate_limited: 'rate_limited',
	beta_closed: 'beta_closed'
};

/**
 * Ask the API to email a one-time sign-in code. The API sends a
 * code only behind a bot check, so every request solves one fresh Turnstile
 * token for the email-code action, invisible unless Cloudflare asks the visitor
 * to act. Every caller that sends a sign-in code goes through here.
 */
export const requestEmailSignInCode = async ({
	email
}: {
	email: string;
}): Promise<EmailSignInCodeResult> => {
	let turnstileToken: string;

	try {
		turnstileToken = await acquireTurnstileToken({ action: TURNSTILE_ACTION_EMAIL_CODE });
	} catch (err: unknown) {
		console.error('turnstile token for the sign-in code failed', err);

		return { ok: false, reason: 'bot_check_failed' };
	}

	try {
		await requestOtp({ email, turnstileToken });

		return { ok: true };
	} catch (err: unknown) {
		console.error('otp request failed', err);

		return {
			ok: false,
			reason: (err instanceof ApiError ? REFUSALS[err.code] : undefined) ?? 'failed'
		};
	}
};
