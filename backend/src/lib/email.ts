// Transactional email via the Resend REST API. When RESEND_API_KEY is unset
// the message body lands on the server console instead, so local dev and CI
// need no email provider. Production refuses to boot without the key (env.ts):
// the console fallback would print sign-in codes into the logs.

import { nonNullish } from '@dfinity/utils';
import { env } from '../env';
import { logger } from './logger';
import { MINUTE_IN_MS } from './time';

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
	/** Sent as Resend's `Idempotency-Key`: a retry with the same key and body
	 * within 24 hours is dropped by the provider instead of delivered twice. */
	idempotencyKey?: string;
}

export type EmailTransport = (message: EmailMessage) => Promise<void>;

let transportOverride: EmailTransport | undefined;

/** Test seam: deliver every message through `transport` instead of Resend or
 * the console; returns a restore function. The end-to-end server
 * (backend/e2e/) installs one to read sign-in codes back, and tests to read
 * the copy a flow sends. */
export const setEmailTransport = (transport: EmailTransport): (() => void) => {
	const previous = transportOverride;

	transportOverride = transport;

	return () => {
		transportOverride = previous;
	};
};

export const sendEmail = async (message: EmailMessage): Promise<void> => {
	if (nonNullish(transportOverride)) {
		await transportOverride(message);

		return;
	}

	const { to, subject, text, html, idempotencyKey } = message;

	if (env.email.resendApiKey === '') {
		logger.info(
			`[email] to=${to} subject="${subject}" (console fallback, set RESEND_API_KEY to send real email)\n${text}`
		);

		return;
	}

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${env.email.resendApiKey}`,
			'content-type': 'application/json',
			...(nonNullish(idempotencyKey) ? { 'idempotency-key': idempotencyKey } : {})
		},
		body: JSON.stringify({ from: env.email.from, to, subject, text, html })
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');

		throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 200)}`);
	}
};

/** A code's lifetime in whole minutes, for the copy that states it. A
 * lifetime that is not a whole number of minutes is refused rather than
 * rounded, since a rounded figure would promise the user a different lifetime
 * than the one enforced. */
export const codeLifetimeMinutes = (ttlMs: number): number => {
	const minutes = ttlMs / MINUTE_IN_MS;

	if (!Number.isInteger(minutes) || minutes <= 0) {
		throw new Error(`Code lifetime must be a positive whole number of minutes, got ${ttlMs} ms`);
	}

	return minutes;
};

/** The closing line of a one-time-code email, built from the lifetime the
 * server enforces so the copy cannot drift from it. */
export const codeExpiryNotice = (ttlMs: number): string =>
	`It expires in ${codeLifetimeMinutes(ttlMs)} minutes. If you didn't request it, ignore this email.`;

export const sendOtpEmail = async (email: string, code: string, ttlMs: number): Promise<void> => {
	const expiry = codeExpiryNotice(ttlMs);

	await sendEmail({
		to: email,
		subject: 'Your VICI sign-in code',
		text: `Your VICI sign-in code is ${code}. ${expiry}`,
		html:
			`<p>Your VICI sign-in code is:</p>` +
			`<p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>` +
			`<p style="color:#888">${expiry}</p>`
	});
};
