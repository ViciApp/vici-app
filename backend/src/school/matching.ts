// School-email matching: the authoritative server-side twin of the app's
// picker gate. A typed email resolves to a directory school (by domain,
// subdomains included), is rejected as a consumer mailbox, or falls through
// to the add-your-own path keyed by the normalized school name.

import { isNullish } from '@dfinity/utils';
import { SCHOOL_DIRECTORY, type SchoolDirectoryEntry } from './directory';

/**
 * Strip a school name down to a comparable stem: lowercase, drop a leading
 * article, a leading "University of ..." prefix (in the major European
 * languages the directory spans), a trailing institution word, and any
 * non-alphanumerics. So "The University of Oxford" and "Oxford" both
 * normalize to `oxford`.
 */
export const spNormalize = (value: string | undefined): string =>
	(value ?? '')
		.toLowerCase()
		.replace(/^the\s+/, '')
		.replace(/^univers(ity|ität|idade|idad|ité|iteit|ità)\s+(of|de|von|von der|degli)\s+/, '')
		.replace(/\s+(university|college|school|institute|institut|polytechnic)$/, '')
		.replace(/[^a-z0-9]/g, '');

/**
 * Consumer mailbox providers that never count as a school address. Checked
 * AFTER the directory match, so a listed school's own subdomain is never
 * mis-flagged; `mail.ru` / `mail.com` are full domains (not a bare `mail`
 * token) so an unlisted school's `mail.<uni>` address still falls through
 * to the add-your-own path.
 */
const SP_CONSUMER_DOMAINS =
	/^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|protonmail|proton|gmx|web|t-online|qq|163|126|mail\.(ru|com)|sina|naver|hanmail|daum|rambler|rediffmail)(\.|$)/i;

export type SchoolEmailMatch =
	| { kind: 'consumer' }
	| { kind: 'unknown-domain'; domain: string }
	| { kind: 'match'; option: SchoolDirectoryEntry; domain: string };

/** Classify a school email against the directory. Null when the string is
 * not a parseable `local@host` email at all. */
export const spMatchEmail = (email: string): SchoolEmailMatch | null => {
	const parsed = email
		.toLowerCase()
		.trim()
		.match(/^[^@\s]+@([^\s@]+)$/);

	if (isNullish(parsed)) {
		return null;
	}

	const [, domain] = parsed;

	if (isNullish(domain)) {
		return null;
	}

	// Known-school match FIRST: a domain that is (or is a subdomain of) a
	// listed school domain always resolves to that school, even if its
	// leading label resembles a consumer provider (e.g. `mail.polimi.it`
	// under `polimi.it`). Only unclaimed domains hit the blocklist.
	for (const option of SCHOOL_DIRECTORY) {
		for (const known of option.domains) {
			if (domain === known || domain.endsWith(`.${known}`)) {
				return { kind: 'match', option, domain };
			}
		}
	}

	if (SP_CONSUMER_DOMAINS.test(domain)) {
		return { kind: 'consumer' };
	}

	return { kind: 'unknown-domain', domain };
};
