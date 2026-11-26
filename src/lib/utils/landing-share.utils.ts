import { LANDING_MARKET_PARAM } from '#lib/constants/landing-markets.constants.ts';
import { marketShareParam, parseMarketShareParam } from '#lib/utils/market-slug.utils.ts';
import { isNullish, notEmptyString } from '@dfinity/utils';

/**
 * Links that open a market on the landing page: `<origin>/?m=<slug~id8>`,
 * the same `slug~id8` encoding as the `/m/[id]` share links.
 */

/** The landing link for a market. `title` is the original one, so a link never changes with the reader's language. */
export const landingMarketShareUrl = ({
	origin,
	title,
	seriesId
}: {
	origin: string;
	title: string;
	seriesId: string;
}): string =>
	// `encodeURIComponent`, not `URLSearchParams`: the latter escapes the `~`
	// separator, which would make a link people read and retype uglier.
	`${origin}/?${LANDING_MARKET_PARAM}=${encodeURIComponent(marketShareParam({ title, seriesId }))}`;

/**
 * The market a landing link names: the `slug~id8` value of `?m=` and its
 * 8-character id prefix, or `undefined` when the link names none or a
 * malformed one. The caller matches the prefix against the catalog.
 */
export const parseLandingMarketParam = (
	search: string
): { param: string; idPrefix: string } | undefined => {
	const param = new URLSearchParams(search).get(LANDING_MARKET_PARAM);

	if (isNullish(param) || !notEmptyString(param)) {
		return;
	}

	const idPrefix = parseMarketShareParam(param);

	return isNullish(idPrefix) ? undefined : { param, idPrefix };
};

/** A link as a person copies it by hand: without its scheme. */
export const linkForHand = (url: string): string => url.replace(/^https?:\/\//, '');
