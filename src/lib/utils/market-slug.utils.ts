import { notEmptyString } from '@dfinity/utils';

/**
 * Keyword slugs for the `/m/{param}` share alias.
 *
 * A share link used to carry the bare 64-hex series id: zero keyword
 * signal for search engines and unreadable in chats. The slugged form
 * (`will-brazil-beat-norway~007c6578`) keeps the question in the URL while
 * the short id suffix pins the exact market:
 *
 *   - Registry titles are immutable, so a slug derived from one is stable
 *     forever, but two titles can normalize to the same slug. The 8-hex
 *     suffix disambiguates without deploy-time collision bookkeeping or
 *     coordination between the share sheet (which only has one market in
 *     hand) and the SEO generator (which has the whole catalog). It cannot
 *     *guarantee* uniqueness: resolution therefore requires exactly one
 *     catalog match and otherwise treats the link as unresolvable, so a
 *     suffix collision can never redirect to the wrong market.
 *   - `~` separates slug from suffix: URL-unreserved (RFC 3986), never
 *     produced by the slug alphabet (`a-z0-9-`), never part of a hex id.
 *
 * Resolution order for an incoming param lives in the `/m/[id]` route: an
 * id embedded by the deploy-time SEO page wins, then a full-hex param
 * (legacy links), then the `~` suffix matched against the catalog.
 *
 * Shared by the FE share sheet and `scripts/build/generate-seo-assets.ts`:
 * both sides must produce the identical param for the same market, or
 * shared links and the emitted crawler pages stop agreeing on URLs.
 */

const SLUG_ID_SEPARATOR = '~';
const SLUG_ID_SUFFIX_LENGTH = 8;

/**
 * Lowercased, ASCII-folded, hyphen-joined form of a market title. Empty for
 * titles with no Latin letters or digits at all (callers fall back to the
 * bare id). Deliberately not truncated: questions differing only in their
 * tail (team names) must keep distinct slugs, and titles stay well under
 * URL length limits.
 */
export const slugifyMarketTitle = (title: string): string =>
	title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/**
 * The `/m/{param}` path segment for a market: `slug~id8`, or the bare id
 * when the title yields no slug.
 */
export const marketShareParam = ({ title, seriesId }: { title: string; seriesId: string }) => {
	const slug = slugifyMarketTitle(title);

	if (!notEmptyString(slug)) {
		return seriesId;
	}

	return `${slug}${SLUG_ID_SEPARATOR}${seriesId.slice(0, SLUG_ID_SUFFIX_LENGTH)}`;
};

// Exactly what `marketShareParam` produces: the first 8 characters of a
// series id: a lowercase-hex hash on the registry. Anything else
// (shorter, longer, foreign charset) is a malformed link: rejecting it
// here keeps a crafted short fragment like `/m/foo~a` from prefix-matching
// an arbitrary market. If the id format ever changes, a stale pattern
// degrades to the markets board, never to a wrong redirect.
const SLUG_ID_SUFFIX_PATTERN = new RegExp(`^[0-9a-f]{${SLUG_ID_SUFFIX_LENGTH}}$`);

/**
 * The short-id suffix of a slugged share param, or `undefined` when the
 * param carries none (bare-id links) or a malformed one. The slug half is
 * presentation only: resolution goes through the suffix.
 */
export const parseMarketShareParam = (param: string): string | undefined => {
	const separatorAt = param.lastIndexOf(SLUG_ID_SEPARATOR);

	if (separatorAt < 0) {
		return;
	}

	const suffix = param.slice(separatorAt + 1);

	return SLUG_ID_SUFFIX_PATTERN.test(suffix) ? suffix : undefined;
};
