// Every email of the waitlist, one builder each, written in the person's
// language from email-copy/<locale>.ts. A registered locale without copy of
// its own falls back to its base language (`pt-BR` to `pt`, `es-MX` to `es`)
// and then to English, the way the app's catalogs fall back. The builders are
// pure: callers send what they return through `sendEmail`.

import { isNullish } from '@dfinity/utils';
import { env } from '../env';
import { codeLifetimeMinutes, type EmailMessage } from '../lib/email';
import { de } from './email-copy/de';
import { en, type WaitlistEmailCopy } from './email-copy/en';
import { es } from './email-copy/es';
import { fr } from './email-copy/fr';
import { it } from './email-copy/it';
import { pt } from './email-copy/pt';
import { zhHans } from './email-copy/zh-Hans';

/** The copy of every live locale, keyed by locale id. */
export const WAITLIST_EMAIL_COPY: Readonly<Record<string, WaitlistEmailCopy>> = {
	en,
	es,
	pt,
	it,
	fr,
	de,
	'zh-Hans': zhHans
};

const FALLBACK_LOCALE = 'en';

export const waitlistEmailCopy = (locale: string): WaitlistEmailCopy => {
	const [base = FALLBACK_LOCALE] = locale.split('-');

	return WAITLIST_EMAIL_COPY[locale] ?? WAITLIST_EMAIL_COPY[base] ?? en;
};

/** The public page a remove link opens; only its button deletes. */
export const WAITLIST_REMOVE_PATH = '/waitlist/remove';

/** The app's sign-in screen, linked from the already-a-member email. */
const SIGN_IN_PATH = '/signin';

export const waitlistRemoveUrl = ({ id, token }: { id: string; token: string }): string => {
	const url = new URL(WAITLIST_REMOVE_PATH, env.publicAppUrl);

	url.searchParams.set('r', id);
	url.searchParams.set('t', token);

	return url.toString();
};

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

const paragraph = (text: string): string => `<p>${escapeHtml(text)}</p>`;

const link = ({ href, label }: { href: string; label: string }): string =>
	`<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;

const quiet = (html: string): string => `<div style="color:#888;font-size:13px">${html}</div>`;

/** The remove link every email to a reservation ends with. */
const removeFooter = ({
	copy,
	removeUrl
}: {
	copy: WaitlistEmailCopy;
	removeUrl: string;
}): { text: string; html: string } => ({
	text: `${copy.footer.remove}: ${removeUrl}`,
	html: quiet(link({ href: removeUrl, label: copy.footer.remove }))
});

/** 4.1: the six-digit code, its lifetime, and that the mail can be ignored. */
export const waitlistCodeEmail = ({
	to,
	locale,
	handle,
	code,
	ttlMs,
	removeUrl
}: {
	to: string;
	locale: string;
	handle: string;
	code: string;
	ttlMs: number;
	removeUrl: string;
}): EmailMessage => {
	const copy = waitlistEmailCopy(locale);
	const expiry = copy.code.expiry(codeLifetimeMinutes(ttlMs));
	const footer = removeFooter({ copy, removeUrl });

	return {
		to,
		subject: copy.code.subject,
		text: [copy.code.intro(handle), code, expiry, copy.code.ignore, footer.text].join('\n\n'),
		html: [
			paragraph(copy.code.intro(handle)),
			`<p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(code)}</p>`,
			paragraph(expiry),
			quiet(paragraph(copy.code.ignore)),
			footer.html
		].join('')
	};
};

/** 4.2: the receipt once the handle is held. */
export const waitlistReceiptEmail = ({
	to,
	locale,
	handle,
	holdMonths,
	removeUrl
}: {
	to: string;
	locale: string;
	handle: string;
	holdMonths: number;
	removeUrl: string;
}): EmailMessage => {
	const copy = waitlistEmailCopy(locale);
	const lines = [copy.receipt.held(handle), copy.receipt.next, copy.receipt.hold(holdMonths)];
	const footer = removeFooter({ copy, removeUrl });

	return {
		to,
		subject: copy.receipt.subject(handle),
		text: [...lines, footer.text].join('\n\n'),
		html: `${lines.map(paragraph).join('')}${footer.html}`
	};
};

/** 4.3: the mailbox already signs in to an account. No code, no remove link:
 * nothing is stored for it. */
export const waitlistAlreadyMemberEmail = ({
	to,
	locale
}: {
	to: string;
	locale: string;
}): EmailMessage => {
	const copy = waitlistEmailCopy(locale);
	const signInUrl = new URL(SIGN_IN_PATH, env.publicAppUrl).toString();

	return {
		to,
		subject: copy.alreadyMember.subject,
		text: [copy.alreadyMember.body, signInUrl].join('\n\n'),
		html: `${paragraph(copy.alreadyMember.body)}${link({ href: signInUrl, label: copy.alreadyMember.signIn })}`
	};
};

/** 4.4: the mailbox belongs to a legacy account that moves on its own. */
export const waitlistLegacyAccountEmail = ({
	to,
	locale
}: {
	to: string;
	locale: string;
}): EmailMessage => {
	const copy = waitlistEmailCopy(locale);

	return {
		to,
		subject: copy.legacyAccount.subject,
		text: copy.legacyAccount.body,
		html: paragraph(copy.legacyAccount.body)
	};
};

/** 4.5: the reservation is gone; sent to the address just deleted. */
export const waitlistRemovedEmail = ({
	to,
	locale,
	handle
}: {
	to: string;
	locale: string;
	handle: string | null;
}): EmailMessage => {
	const copy = waitlistEmailCopy(locale);
	const body = copy.removed.body(isNullish(handle) ? undefined : handle);

	return { to, subject: copy.removed.subject, text: body, html: paragraph(body) };
};
