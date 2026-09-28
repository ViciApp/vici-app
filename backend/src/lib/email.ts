// Transactional email via the Resend REST API. When RESEND_API_KEY is unset
// the message body lands on the server console instead, so local dev and CI
// need no email provider. In production set RESEND_API_KEY + EMAIL_FROM.

import { nonNullish } from '@dfinity/utils';
import { env } from '../env';
import { logger } from './logger';

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
}

export type EmailTransport = (message: EmailMessage) => Promise<void>;

let transportOverride: EmailTransport | undefined;

/** Test seam: deliver every message through `transport` instead of Resend or
 * the console; returns a restore function. Only the end-to-end server
 * (backend/e2e/) installs one, to read sign-in codes back. */
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

	const { to, subject, text, html } = message;

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
			'content-type': 'application/json'
		},
		body: JSON.stringify({ from: env.email.from, to, subject, text, html })
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');

		throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 200)}`);
	}
};

export const sendOtpEmail = async (email: string, code: string): Promise<void> => {
	await sendEmail({
		to: email,
		subject: 'Your VICI sign-in code',
		text: `Your VICI sign-in code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
		html:
			`<p>Your VICI sign-in code is:</p>` +
			`<p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>` +
			`<p style="color:#888">It expires in 10 minutes. If you didn't request it, ignore this email.</p>`
	});
};
