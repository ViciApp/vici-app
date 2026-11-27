import {
	LANDING_CLAIM_PARAM,
	LANDING_MARKET_PARAM,
	LANDING_VIEW_PARAM
} from '#lib/constants/landing-markets.constants.ts';
import type { LandingView } from '#lib/types/landing-claim.ts';
import { marketShareIdPrefix } from '#lib/utils/market-slug.utils.ts';
import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';

/**
 * Links into the signed-out landing (`/`): `?m=<slug~id8>` names the market
 * the deck leads with (the same param as the `/m/[id]` share link, a bare id
 * when the title yields no slug), `?view=markets` opens the Markets view,
 * `?claim=1` opens the claim capsule.
 * Every other query param (`ref`, `utm_*`) rides along.
 */

/** What a landing link asks for. */
export interface LandingLink {
	/** The `?m=` param as written, and the id prefix it carries; absent when the link names no market. */
	market?: { param: string; idPrefix: string };
	/** `true` when the link named a market whose param is malformed: it opens Markets, never a dead page. */
	marketMalformed: boolean;
	view?: LandingView;
	/** Whether the link opens the claim capsule. */
	claim: boolean;
}

const isLandingView = (value: string | null): value is LandingView =>
	value === 'cards' || value === 'markets';

/** Reads a landing link's query string. */
export const parseLandingLink = (search: string): LandingLink => {
	const params = new URLSearchParams(search);
	const param = params.get(LANDING_MARKET_PARAM);
	const view = params.get(LANDING_VIEW_PARAM);
	const idPrefix = notEmptyString(param) ? marketShareIdPrefix(param) : undefined;

	return {
		market: notEmptyString(param) && nonNullish(idPrefix) ? { param, idPrefix } : undefined,
		marketMalformed: notEmptyString(param) && isNullish(idPrefix),
		view: isLandingView(view) ? view : undefined,
		claim: params.get(LANDING_CLAIM_PARAM) === '1'
	};
};

/**
 * A query string without the landing's own params (`m`, `view`, `claim`): what a
 * landing link carries for others (`ref`, `utm_*`), as `?…` or empty.
 */
export const searchWithoutLandingParams = (search: string): string => {
	const params = new URLSearchParams(search);

	params.delete(LANDING_MARKET_PARAM);
	params.delete(LANDING_VIEW_PARAM);
	params.delete(LANDING_CLAIM_PARAM);

	const rest = params.toString();

	return notEmptyString(rest) ? `?${rest}` : '';
};

/**
 * The query string of a landing link (`?…`, or empty): `market` is a share
 * param (`slug~id8`), `view` the view to open, `claim` opens the capsule,
 * `search` a query string whose other params are kept (the ones built here
 * win over any landing param it already carries). The caller puts it after the resolved landing path.
 */
export const landingSearch = ({
	market,
	view,
	claim = false,
	search = ''
}: {
	market?: string;
	view?: LandingView;
	claim?: boolean;
	search?: string;
} = {}): string => {
	// `encodeURIComponent` for the market, not `URLSearchParams`: the latter
	// escapes the `~` separator of a share param.
	const own = [
		...(notEmptyString(market) ? [`${LANDING_MARKET_PARAM}=${encodeURIComponent(market)}`] : []),
		...(nonNullish(view) ? [`${LANDING_VIEW_PARAM}=${view}`] : []),
		...(claim ? [`${LANDING_CLAIM_PARAM}=1`] : [])
	];
	const rest = searchWithoutLandingParams(search).slice(1);
	const query = [...own, ...(notEmptyString(rest) ? [rest] : [])].join('&');

	return notEmptyString(query) ? `?${query}` : '';
};

/** A link as a person copies it by hand: without its scheme. */
export const linkForHand = (url: string): string => url.replace(/^https?:\/\//, '');
