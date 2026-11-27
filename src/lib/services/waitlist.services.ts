import { PRIVACY_POLICY_VERSION } from '#lib/constants/legal-docs.constants.ts';
import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { TURNSTILE_ACTION_WAITLIST_CODE } from '#lib/constants/turnstile.constants.ts';
import {
	WAITLIST_STATUS_STORAGE_KEY,
	type WaitlistSource,
	type WaitlistState
} from '#lib/constants/waitlist.constants.ts';
import { acquireTurnstileToken } from '#lib/services/turnstile.services.ts';
import type { LandingClaimError, LandingClaimSubmit } from '#lib/types/landing-claim.ts';
import {
	confirmWaitlistCode,
	readWaitlistStatus,
	removeWaitlistReservation,
	requestWaitlistCode,
	Web2ApiError
} from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';

/**
 * The landing's waitlist, over the web2 API. Every expected refusal resolves
 * an `{ error }` with the adapter's code instead of throwing:
 * the API's own codes pass through, any Turnstile refusal (or a bot check
 * that could not run in the page) reads as `bot_check_failed`, and a network
 * failure or a server error as `unavailable`.
 */

/** Any Turnstile refusal, from the page or from the API. */
export const WAITLIST_BOT_CHECK_FAILED = 'bot_check_failed';

/** The network or the server failed; the visitor can try again. */
export const WAITLIST_UNAVAILABLE = 'unavailable';

const TURNSTILE_REFUSAL_PREFIX = 'turnstile_';

const SERVER_ERROR_STATUS = 500;

/** The adapter's code for a failed waitlist call. */
export const waitlistErrorCode = (err: unknown): string => {
	if (!(err instanceof Web2ApiError)) {
		return WAITLIST_UNAVAILABLE;
	}

	if (err.code.startsWith(TURNSTILE_REFUSAL_PREFIX)) {
		return WAITLIST_BOT_CHECK_FAILED;
	}

	return err.status >= SERVER_ERROR_STATUS ? WAITLIST_UNAVAILABLE : err.code;
};

const refused = (err: unknown): LandingClaimError => ({ error: waitlistErrorCode(err) });

interface CachedReservation {
	handle: string;
	statusToken: string;
}

const readCache = (): CachedReservation | undefined => {
	try {
		const raw = localStorage.getItem(WAITLIST_STATUS_STORAGE_KEY);
		const parsed: unknown = isNullish(raw) ? undefined : JSON.parse(raw);

		if (
			typeof parsed === 'object' &&
			!isNullish(parsed) &&
			'handle' in parsed &&
			'statusToken' in parsed &&
			typeof parsed.handle === 'string' &&
			typeof parsed.statusToken === 'string'
		) {
			return { handle: parsed.handle, statusToken: parsed.statusToken };
		}
	} catch {
		// Blocked storage or garbage: no cached reservation.
	}
};

const writeCache = (reservation: CachedReservation): void => {
	try {
		localStorage.setItem(WAITLIST_STATUS_STORAGE_KEY, JSON.stringify(reservation));
	} catch {
		// A cache only: the waitlist holds the handle whatever the browser keeps.
	}
};

const clearCache = (): void => {
	try {
		localStorage.removeItem(WAITLIST_STATUS_STORAGE_KEY);
	} catch {
		// Nothing was kept, or nothing can be.
	}
};

/**
 * Sends the code for `handle` to `email`, with a fresh bot check, the policy
 * shown, the page's language and the referral code a link left, if any.
 */
export const requestCode = async ({
	handle,
	email,
	source,
	locale,
	referralCode
}: {
	handle: string;
	email: string;
	source: WaitlistSource;
	locale: AppLocale;
	referralCode: string | undefined;
}): Promise<{ ok: true; codeTtlMs: number } | LandingClaimError> => {
	let turnstileToken: string;

	try {
		turnstileToken = await acquireTurnstileToken({ action: TURNSTILE_ACTION_WAITLIST_CODE });
	} catch (err: unknown) {
		console.warn('Waitlist: the bot check could not run', err);

		return { error: WAITLIST_BOT_CHECK_FAILED };
	}

	try {
		const { codeTtlMs } = await requestWaitlistCode({
			handle,
			email,
			turnstileToken,
			privacyVersion: PRIVACY_POLICY_VERSION,
			source,
			locale,
			referralCode
		});

		return { ok: true, codeTtlMs };
	} catch (err: unknown) {
		return refused(err);
	}
};

/** Confirms the code; the handle and its status token are kept for the next visit. */
export const confirm = async ({
	email,
	code
}: {
	email: string;
	code: string;
}): Promise<{ handle: string } | LandingClaimError> => {
	try {
		const { handle, statusToken } = await confirmWaitlistCode({ email, code });

		writeCache({ handle, statusToken });

		return { handle };
	} catch (err: unknown) {
		return refused(err);
	}
};

/**
 * Deletes the reservation an emailed remove link names (`r`, `t`). Resolves
 * whether or not there was one: the API answers both alike. A browser that
 * cached it learns on its next visit, when `restore` finds it gone. Throws
 * when the server cannot be asked.
 */
export const removeReservation = async ({
	id,
	token
}: {
	id: string;
	token: string;
}): Promise<void> => {
	await removeWaitlistReservation({ id, token });
};

/** The handle this browser last confirmed, before the server is asked. */
export const cachedHandle = (): string | undefined => readCache()?.handle;

/**
 * The server's word on this browser's reservation: it, or nothing when there
 * is none. A reservation the server no longer knows (removed, lapsed) clears
 * the cache, so it never shows as held. Throws when the server cannot be
 * asked: the cache then stands until the next visit.
 */
export const restore = async (): Promise<{ handle: string; state: WaitlistState } | undefined> => {
	const cached = readCache();

	if (isNullish(cached)) {
		return;
	}

	try {
		const status = await readWaitlistStatus({ statusToken: cached.statusToken });

		writeCache({ handle: status.handle, statusToken: cached.statusToken });

		return status;
	} catch (err: unknown) {
		if (err instanceof Web2ApiError && err.code === 'not_found') {
			clearCache();

			return;
		}

		throw err;
	}
};

const unavailable = (): Promise<LandingClaimError> =>
	Promise.resolve({ error: WAITLIST_UNAVAILABLE });

/**
 * The capsule's calls on a build without the waitlist (the legacy one): both
 * refuse, the capsule says it could not send the code, and nothing pretends a
 * handle is held.
 */
export const waitlistUnavailable: LandingClaimSubmit = {
	requestCode: unavailable,
	confirm: unavailable,
	cachedHandle: () => undefined,
	restore: () => Promise.resolve(undefined)
};
