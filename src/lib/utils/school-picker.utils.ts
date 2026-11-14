import type { WorldsAffiliationOption } from '#lib/constants/worlds-affiliations.constants.ts';
import { isNullish } from '@dfinity/utils';

/**
 * School-picker matching helpers: pure functions backing the
 * university branch of the affiliation picker:
 *
 *  - {@link spFuzzy} / {@link spFindCloseMatches}: typo-tolerant
 *    directory search and "did you mean" dedupe.
 *  - {@link spMatchEmail}: maps a school email to a directory entry
 *    (or rejects a consumer mailbox) so we can redirect a user to an
 *    existing school instead of letting them re-add it.
 *  - {@link spInferCountry}: guesses a home country from an academic
 *    TLD so the add flow can prefill the country chip.
 *
 * Kept framework-free (no Svelte, no DOM) so they're trivially unit-
 * testable and reusable from any surface that needs the same matching.
 */

/**
 * Strip a school name down to a comparable stem: lowercase, drop a
 * leading article, a leading "University of …" prefix (in the major
 * European languages the directory spans), a trailing institution
 * word, and any non-alphanumerics. So "The University of Oxford" and
 * "Oxford" both normalise to `oxford`.
 */
export const spNormalize = (value: string | undefined): string =>
	(value ?? '')
		.toLowerCase()
		.replace(/^the\s+/, '')
		.replace(/^univers(ity|ität|idade|idad|ité|iteit|ità)\s+(of|de|von|von der|degli)\s+/, '')
		.replace(/\s+(university|college|school|institute|institut|polytechnic)$/, '')
		.replace(/[^a-z0-9]/g, '');

/**
 * Score a query against a target, 0–100. Exact stem = 100; prefix
 * matches decay with the length gap; substring = 70; an in-order
 * subsequence falls back to 40 plus a small bonus for the longest
 * contiguous run. Returns 0 when there's no subsequence match at all.
 */
export const spFuzzy = ({ query, target }: { query: string; target: string }): number => {
	const q = spNormalize(query);
	const t = spNormalize(target);

	if (q.length === 0 || t.length === 0) {
		return 0;
	}

	if (t === q) {
		return 100;
	}

	if (t.startsWith(q)) {
		return 90 - (t.length - q.length) * 0.5;
	}

	if (t.includes(q)) {
		return 70;
	}

	let qi = 0;
	let run = 0;
	let best = 0;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (q[qi] === t[ti]) {
			qi++;
			run++;
			best = Math.max(best, run);
		} else {
			run = 0;
		}
	}

	if (qi === q.length) {
		return 40 + best * 2;
	}

	return 0;
};

/**
 * Top fuzzy matches for a free-text school name: used by the
 * add-your-own dedupe panel to surface "is it already here?" before a
 * user submits a duplicate. Below a 2-character query returns nothing
 * (too noisy); otherwise the best `limit` rows scoring ≥ 40.
 */
export const spFindCloseMatches = ({
	query,
	directory,
	limit = 4
}: {
	query: string;
	directory: readonly WorldsAffiliationOption[];
	limit?: number;
}): WorldsAffiliationOption[] => {
	if (query.length < 2) {
		return [];
	}

	return directory
		.map((option) => ({
			option,
			score: Math.max(
				spFuzzy({ query, target: option.name }),
				spFuzzy({ query, target: option.short ?? '' })
			)
		}))
		.filter((scored) => scored.score >= 40)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((scored) => scored.option);
};

/**
 * Consumer mailbox providers that never count as a school address: used
 * by the "add your own school" flow so a personal inbox can't be turned
 * into a new school. This blocklist is checked AFTER the directory match
 * (see {@link spMatchEmail}), so a listed school's own subdomain is never
 * mis-flagged. `mail.ru` / `mail.com` are listed as full domains (NOT a
 * bare `mail` token) so that an *unlisted* school's `mail.<uni>` address
 * still falls through to the add-your-own path rather than being rejected
 * as a consumer mailbox.
 */
const SP_CONSUMER_DOMAINS =
	/^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|protonmail|proton|gmx|web|t-online|qq|163|126|mail\.(ru|com)|sina|naver|hanmail|daum|rambler|rediffmail)(\.|$)/i;

/**
 * Outcome of matching a typed email against the directory:
 *  - `consumer`: a personal mailbox provider, never a school.
 *  - `unknown-domain`: a plausible school domain we don't recognise
 *    (the add-your-own flow can proceed).
 *  - a `match`: the domain belongs to a directory school, so the
 *    add flow should redirect the user there instead.
 */
export type SchoolEmailMatch =
	| { kind: 'consumer' }
	| { kind: 'unknown-domain'; domain: string }
	| { kind: 'match'; option: WorldsAffiliationOption; domain: string };

/**
 * Classify a school email against the directory. Returns `null` when
 * the string isn't a parseable `local@host` email at all.
 */
export const spMatchEmail = ({
	email,
	directory
}: {
	email: string;
	directory: readonly WorldsAffiliationOption[];
}): SchoolEmailMatch | null => {
	const parsed = email
		.toLowerCase()
		.trim()
		.match(/^[^@\s]+@([^\s@]+)$/);

	if (isNullish(parsed)) {
		return null;
	}

	const [, domain] = parsed;

	// Known-school match FIRST: a domain that is (or is a subdomain of) a
	// listed school domain always resolves to that school: even if its
	// leading label resembles a consumer provider (e.g. `mail.polimi.it`
	// under `polimi.it`). Only domains no school claims fall through to
	// the personal-mailbox blocklist below.
	for (const option of directory) {
		for (const known of option.domains ?? []) {
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

/**
 * Academic / national TLD → ISO-3166 alpha-2 country. Longest key
 * wins (so `ac.uk` beats a bare `uk`-style fallback): see
 * {@link spInferCountry}.
 */
const SP_TLD_COUNTRY: Readonly<Record<string, string>> = {
	edu: 'US',
	'ac.uk': 'GB',
	'edu.au': 'AU',
	'ac.nz': 'NZ',
	'ac.jp': 'JP',
	'ac.kr': 'KR',
	'edu.cn': 'CN',
	'edu.hk': 'HK',
	'edu.sg': 'SG',
	'ac.in': 'IN',
	'edu.tw': 'TW',
	'edu.my': 'MY',
	'ac.th': 'TH',
	'ac.id': 'ID',
	'edu.ph': 'PH',
	'edu.vn': 'VN',
	'ac.il': 'IL',
	'edu.lb': 'LB',
	'edu.eg': 'EG',
	'ac.za': 'ZA',
	'edu.tr': 'TR',
	'edu.sa': 'SA',
	'edu.br': 'BR',
	'edu.mx': 'MX',
	de: 'DE',
	fr: 'FR',
	it: 'IT',
	es: 'ES',
	nl: 'NL',
	be: 'BE',
	ch: 'CH',
	at: 'AT',
	se: 'SE',
	dk: 'DK',
	no: 'NO',
	fi: 'FI',
	pl: 'PL',
	cz: 'CZ',
	hu: 'HU',
	pt: 'PT',
	ie: 'IE',
	gr: 'GR',
	ca: 'CA',
	cl: 'CL',
	'psl.eu': 'FR'
};

const SP_TLD_KEYS_BY_LENGTH = Object.keys(SP_TLD_COUNTRY).sort((a, b) => b.length - a.length);

/**
 * Best-effort home country from an email's TLD (e.g. `@ox.ac.uk` →
 * `GB`, `@uni-koeln.de` → `DE`). Falls back to the supplied default
 * (the caller's detected country) when nothing matches or the string
 * isn't an email.
 */
export const spInferCountry = ({
	email,
	fallback
}: {
	email: string;
	fallback: string | null;
}): string | null => {
	const parsed = email
		.toLowerCase()
		.trim()
		.match(/^[^@\s]+@([^\s@]+)$/);

	if (isNullish(parsed)) {
		return fallback;
	}

	const [, host] = parsed;

	for (const key of SP_TLD_KEYS_BY_LENGTH) {
		if (host === key || host.endsWith(`.${key}`)) {
			return SP_TLD_COUNTRY[key];
		}
	}

	return fallback;
};

/** True when the string is a syntactically valid `local@host.tld` email. */
export const spIsValidEmail = (email: string): boolean =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** True when the string is exactly six digits (the verification code). */
export const spIsValidCode = (code: string): boolean => /^\d{6}$/.test(code);

/** Keep only digits, capped at six: the code field's input filter. */
export const spSanitizeCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);
