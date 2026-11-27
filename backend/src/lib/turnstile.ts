// Server-side check of a Cloudflare Turnstile token, the bot gate in front of
// the anonymous endpoints. A token is single-use and only proves a human solved
// a challenge on the site key's domains; the action ties it to one surface, so
// a token minted for another widget cannot be replayed here.

import { isNullish, nonNullish } from '@dfinity/utils';
import { env, type TurnstileEnv } from '../env';
import { serviceUnavailable, type StatusContext } from './http';
import { logger } from './logger';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cloudflare answers in well under a second; past this the caller gets a 503
// it can retry rather than a request hanging on a dependency.
const SITEVERIFY_TIMEOUT_MS = 5_000;

/** Cloudflare's longest token, so a body field can be bounded before the call. */
export const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

/** The fields of the siteverify answer this check reads. */
export interface SiteverifyResult {
	success: boolean;
	action?: string;
}

export type SiteverifyCall = (input: {
	secretKey: string;
	token: string;
	ip: string | null;
}) => Promise<SiteverifyResult>;

/**
 * - passed: the token is genuine, unspent and minted for the expected action.
 * - bypassed: no secret outside production; nothing was checked.
 * - failed: Cloudflare refused the token (forged, spent, expired, wrong action).
 * - unavailable: Cloudflare could not be asked; the caller may retry.
 * - unconfigured: production without a secret; every check is refused.
 */
export type TurnstileVerdict = 'passed' | 'bypassed' | 'failed' | 'unavailable' | 'unconfigured';

const siteverify: SiteverifyCall = async ({ secretKey, token, ip }) => {
	const response = await fetch(SITEVERIFY_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			secret: secretKey,
			response: token,
			...(isNullish(ip) ? {} : { remoteip: ip })
		}),
		signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
	});

	if (!response.ok) {
		throw new Error(`siteverify answered ${response.status}`);
	}

	const payload = (await response.json()) as Partial<SiteverifyResult>;

	return {
		success: payload.success === true,
		action: typeof payload.action === 'string' ? payload.action : undefined
	};
};

let configOverride: TurnstileEnv | undefined;
let siteverifyOverride: SiteverifyCall | undefined;

/** Test seam: check against `config` and answer through `call` instead of the
 * env and Cloudflare; returns a restore function. */
export const setTurnstileSeam = ({
	config,
	call
}: {
	config?: TurnstileEnv;
	call?: SiteverifyCall;
}): (() => void) => {
	const previous = { config: configOverride, call: siteverifyOverride };

	configOverride = config;
	siteverifyOverride = call;

	return () => {
		configOverride = previous.config;
		siteverifyOverride = previous.call;
	};
};

let bypassLogged = false;

export const verifyTurnstileToken = async ({
	token,
	ip,
	action
}: {
	token: string;
	ip: string | null;
	action: string;
}): Promise<TurnstileVerdict> => {
	const config = configOverride ?? env.turnstile;

	if (!config.enabled) {
		if (config.bypass) {
			if (!bypassLogged) {
				bypassLogged = true;
				logger.warn('TURNSTILE_SECRET_KEY is unset: the bot check is skipped outside production');
			}

			return 'bypassed';
		}

		logger.error('TURNSTILE_SECRET_KEY is unset in production: refusing every bot check');

		return 'unconfigured';
	}

	if (token === '') {
		return 'failed';
	}

	try {
		const result = await (siteverifyOverride ?? siteverify)({
			secretKey: config.secretKey,
			token,
			ip
		});

		return result.success && nonNullish(result.action) && result.action === action
			? 'passed'
			: 'failed';
	} catch (err) {
		logger.warn('Turnstile siteverify failed', err);

		return 'unavailable';
	}
};

/**
 * The refusal for a verdict that does not let the request through, or nothing
 * for `passed` and `bypassed`: `403 turnstile_failed` for a refused token (the
 * client solves again), `503 turnstile_unavailable` or `turnstile_unconfigured`
 * when nothing could be checked.
 */
export const turnstileRefusal = ({
	set,
	verdict
}: {
	set: StatusContext;
	verdict: TurnstileVerdict;
}): { error: string } | undefined => {
	if (verdict === 'passed' || verdict === 'bypassed') {
		return;
	}

	if (verdict === 'failed') {
		set.status = 403;

		return { error: 'turnstile_failed' };
	}

	return serviceUnavailable(set, `turnstile_${verdict}`);
};
