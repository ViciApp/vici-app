// One reservation per real mailbox. The mailbox key folds the aliases of one
// inbox, and an address on a known disposable-mail domain is refused, so one
// person cannot hold a handle per alias or per throwaway inbox.
//
// The disposable list is a reviewed file (disposable-domains.txt, regenerated
// by scripts/update-disposable-domains.ts and a monthly workflow) plus the
// app setting WAITLIST_EMAIL_DOMAINS_SETTING, so an admin can block or exempt
// a domain at once between releases; `allow` wins over everything.

import { isNullish } from '@dfinity/utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAppSetting } from '../admin/settings';
import { otpMailboxKey } from '../auth/otp';

/**
 * The inbox an address delivers to: lowercased, without a `+tag`, and for
 * Gmail without dots and on gmail.com, so `Jo.Smith+vici@googlemail.com` and
 * `josmith@gmail.com` are one mailbox. The sign-in code limit already keys on
 * exactly this, so it is the same function.
 */
export const emailMailboxKey = otpMailboxKey;

/** The app setting an admin edits to block or exempt a domain at once. */
export const WAITLIST_EMAIL_DOMAINS_SETTING = 'waitlist_email_domains';

export interface WaitlistEmailDomains {
	block: string[];
	allow: string[];
}

const DISPOSABLE_DOMAINS_FILE = join(import.meta.dir, 'disposable-domains.txt');

/** One domain per line; blank lines and `#` comments are skipped. */
export const parseDomainList = (text: string): ReadonlySet<string> =>
	new Set(
		text
			.split('\n')
			.map((line) => line.trim().toLowerCase())
			.filter((line) => line !== '' && !line.startsWith('#'))
	);

let disposableDomains: ReadonlySet<string> | undefined;

// Read once, on first use: a few thousand lines held as a set.
const listedDomains = (): ReadonlySet<string> => {
	disposableDomains ??= parseDomainList(readFileSync(DISPOSABLE_DOMAINS_FILE, 'utf8'));

	return disposableDomains;
};

/** Test seam: check against `domains` instead of the file; returns a restore function. */
export const setDisposableDomains = (domains: Iterable<string>): (() => void) => {
	const previous = disposableDomains;

	disposableDomains = new Set(domains);

	return () => {
		disposableDomains = previous;
	};
};

/** The domain and every parent of it down to the last two labels:
 * `a.b.mailinator.com` yields itself, `b.mailinator.com`, `mailinator.com`. */
const domainAndParents = (domain: string): string[] => {
	const labels = domain.split('.');

	return labels.slice(0, Math.max(1, labels.length - 1)).map((_, i) => labels.slice(i).join('.'));
};

const sanitizeDomains = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((d): d is string => typeof d === 'string').map((d) => d.trim().toLowerCase())
		: [];

/** The setting overlay, read as an untrusted bag: a malformed value adds nothing. */
const readDomainOverlay = async (): Promise<WaitlistEmailDomains> => {
	const value = await readAppSetting<Partial<WaitlistEmailDomains>>(WAITLIST_EMAIL_DOMAINS_SETTING);

	return isNullish(value)
		? { block: [], allow: [] }
		: { block: sanitizeDomains(value.block), allow: sanitizeDomains(value.allow) };
};

/** Whether the pure lists refuse `domain`: a listed domain or a subdomain of
 * one is refused unless `allow` names it or one of its parents. */
export const isDomainRefused = ({
	domain,
	listed,
	overlay
}: {
	domain: string;
	listed: ReadonlySet<string>;
	overlay: WaitlistEmailDomains;
}): boolean => {
	const candidates = domainAndParents(domain.trim().toLowerCase());
	const allow = new Set(overlay.allow);

	if (candidates.some((candidate) => allow.has(candidate))) {
		return false;
	}

	const block = new Set(overlay.block);

	return candidates.some((candidate) => listed.has(candidate) || block.has(candidate));
};

/** Whether the waitlist refuses this address as a disposable mailbox. */
export const isDisposableEmail = async (email: string): Promise<boolean> => {
	const domain = email.slice(email.lastIndexOf('@') + 1);

	if (domain === '') {
		return false;
	}

	return isDomainRefused({ domain, listed: listedDomains(), overlay: await readDomainOverlay() });
};
