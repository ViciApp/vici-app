// Shared fixtures of the waitlist suites: the routes driven through the real
// app, the seams every test installs (email, Turnstile, the disposable list),
// and the join that most tests start from.

import { assertNonNullish, isNullish } from '@dfinity/utils';
import { afterEach, beforeAll, beforeEach, expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../../src/db/client';
import type { TurnstileEnv } from '../../src/env';
import { app } from '../../src/index';
import { setEmailTransport, type EmailMessage } from '../../src/lib/email';
import { resetRateLimits } from '../../src/lib/rate-limit';
import { setTurnstileSeam, type SiteverifyCall } from '../../src/lib/turnstile';
import { setDisposableDomains } from '../../src/waitlist/mailbox';
import { ensureMigrated } from './auth';
import { uniqueNickname } from './profiles';

// The contract the routes promise, spelled out so the tests pin it.
export const TURNSTILE_ACTION = 'waitlist_code';
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const SENDS_PER_DAY = 5;
export const CODE_LIMIT_PER_TEN_MINUTES = 5;
export const GLOBAL_WINDOW_KEY = 'waitlist_code_global:all';
export const DISPOSABLE_DOMAIN = 'throwaway.test.vici.invalid';

export const BYPASS: TurnstileEnv = { enabled: false, secretKey: '', bypass: true };
export const ENABLED: TurnstileEnv = { enabled: true, secretKey: 'test-secret', bypass: false };
export const UNCONFIGURED_PROD: TurnstileEnv = { enabled: false, secretKey: '', bypass: false };

export const answering =
	(result: Awaited<ReturnType<SiteverifyCall>>): SiteverifyCall =>
	() =>
		Promise.resolve(result);

export const uniqueIp = (): string => `10.${[...randomBytes(3)].join('.')}`;

/** A fixture handle within the rule. `uniqueEmail` addresses are already their own mailbox key. */
export const uniqueHandle = (): string => uniqueNickname();

export const post = async ({
	path,
	body,
	ip = uniqueIp(),
	method = 'POST',
	cookie
}: {
	path: string;
	body: unknown;
	ip?: string;
	method?: string;
	cookie?: string;
}): Promise<Response> =>
	await app.handle(
		new Request(`http://localhost/api/v1/waitlist${path}`, {
			method,
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': ip,
				...(isNullish(cookie) ? {} : { cookie })
			},
			body: JSON.stringify(body)
		})
	);

export const requestCode = async ({
	handle,
	email,
	ip,
	locale = 'en',
	extra = {}
}: {
	handle: string;
	email: string;
	ip?: string;
	locale?: string;
	extra?: Record<string, unknown>;
}): Promise<Response> =>
	await post({
		path: '/code',
		ip,
		body: {
			handle,
			email,
			turnstileToken: 'token',
			privacyVersion: '2026-11-27',
			source: 'nav',
			locale,
			...extra
		}
	});

export const confirm = async ({
	email,
	code
}: {
	email: string;
	code: string;
}): Promise<Response> => await post({ path: '/confirm', body: { email, code } });

export const errorOf = async (response: Response): Promise<string | undefined> =>
	((await response.json()) as { error?: string }).error;

export interface ReservationRow {
	id: string;
	handle: string | null;
	pending_handle: string | null;
	locale: string;
	consent_at: Date;
	privacy_version: string;
	source: string;
	invited_referral_code: string | null;
	invited_challenge_id: string | null;
	confirmed_at: Date | null;
	expires_at: Date | null;
}

export const reservationOf = async (emailKey: string): Promise<ReservationRow | undefined> => {
	const [row] = await query<ReservationRow>(
		`select id, handle, pending_handle, locale, consent_at, privacy_version, source,
		   invited_referral_code, invited_challenge_id, confirmed_at, expires_at
		 from waitlist_reservations where email_key = $1`,
		[emailKey]
	);

	return row;
};

export interface WaitlistHarness {
	/** Every email sent since the test began. */
	sent: () => EmailMessage[];
	clearSent: () => void;
	useTurnstile: (seam: { config: TurnstileEnv; call?: SiteverifyCall }) => void;
	/** The six digits of the last code email to `to`. */
	lastCodeTo: (to: string) => string;
	join: (params: {
		handle: string;
		email: string;
	}) => Promise<{ handle: string; statusToken: string }>;
}

/** Installs the seams around every test of the calling `describe`. */
export const useWaitlistHarness = (): WaitlistHarness => {
	let sent: EmailMessage[] = [];
	let restoreEmail: (() => void) | undefined;
	let restoreTurnstile: (() => void) | undefined;
	let restoreDomains: (() => void) | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(async () => {
		resetRateLimits();
		// Every run shares the global breaker's window; start each test clear of it.
		await query(`delete from rate_limit_windows where key = $1`, [GLOBAL_WINDOW_KEY]);
		sent = [];
		restoreEmail = setEmailTransport((message) => {
			sent.push(message);

			return Promise.resolve();
		});
		restoreTurnstile = setTurnstileSeam({ config: BYPASS });
		restoreDomains = setDisposableDomains([DISPOSABLE_DOMAIN]);
	});

	afterEach(() => {
		restoreEmail?.();
		restoreTurnstile?.();
		restoreDomains?.();
	});

	const lastCodeTo = (to: string): string => {
		const message = sent.filter((m) => m.to === to).at(-1);

		assertNonNullish(message);

		const code = /\b(\d{6})\b/.exec(message.text)?.[1];

		assertNonNullish(code);

		return code;
	};

	return {
		sent: () => sent,
		clearSent: () => {
			sent = [];
		},
		useTurnstile: (seam) => {
			restoreTurnstile?.();
			restoreTurnstile = setTurnstileSeam(seam);
		},
		lastCodeTo,
		join: async ({ handle, email }) => {
			const requested = await requestCode({ handle, email });

			expect(requested.status).toBe(200);

			const confirmed = await confirm({ email, code: lastCodeTo(email) });

			expect(confirmed.status).toBe(200);

			return (await confirmed.json()) as { handle: string; statusToken: string };
		}
	};
};
