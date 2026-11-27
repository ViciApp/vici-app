// The link preview of a challenge link: the head fragment the web image's
// nginx includes into the app shell it serves on /c/<id>. Messengers read a
// link's <head> without running the app, so the per-challenge title and
// description have to be in the HTML the server sends. The fragment replaces
// the shell's generic preview tags; on any failure nginx keeps those.
//
// English only: a crawler carries no recipient locale, and the page itself is
// localised once it loads.

import { isNullish } from '@dfinity/utils';
import { getSeries } from '../engine/registry';
import { escapeHtml } from '../lib/html';
import type { CallSide } from '../vxp/calibration';
import type { ChallengeView } from './challenges';

/** The landing's generic share card, the only preview image a challenge
 * link has. Mirrors `LANDING_SHARE_*` in the app's
 * `landing-page.constants.ts`, pinned by the shared-drift suite. */
export const CHALLENGE_SHARE_IMAGE: Readonly<{
	path: string;
	width: number;
	height: number;
	type: string;
	alt: string;
}> = {
	path: '/branding/landing-share.jpg',
	width: 1200,
	height: 630,
	type: 'image/jpeg',
	alt: 'VICI. Call it.'
};

/** The path of a challenge link on the app's origin. */
export const CHALLENGE_LINK_PATH_PREFIX = '/c/';

const SITE_NAME = 'VICI';
const TITLE_SUFFIX = ` | ${SITE_NAME}`;
const ANONYMOUS_CHALLENGER = 'A friend';

const SIDE_LABEL: Record<CallSide, string> = { YES: 'Yes', NO: 'No' };

const BPS_PER_PERCENT = 100;
// A held price is strictly inside (0, 1), so its rounded percent never reads
// as a certainty.
const MIN_PERCENT = 1;
const MAX_PERCENT = 99;

const DISPUTE_PROMPT = "Think they're wrong?";
const OPEN_PROMPT = "What's your call?";

const percentOf = (entryPriceBps: number): number =>
	Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(entryPriceBps / BPS_PER_PERCENT)));

const challengerName = (view: ChallengeView): string =>
	isNullish(view.challenger) ? ANONYMOUS_CHALLENGER : `@${view.challenger.handle}`;

/** The preview's headline, without the site suffix. */
export const challengeHeadline = (view: ChallengeView): string => {
	const who = challengerName(view);
	const { position } = view;

	if (isNullish(position)) {
		return `${who} challenged you on this`;
	}

	const call = `${SIDE_LABEL[position.side]} at ${percentOf(position.entryPriceBps)}%`;

	if (!view.marketOpen) {
		return `${who} called ${call}. This one has closed`;
	}

	return view.sideChanged ? `${who} now says ${call}` : `${who} called ${call}`;
};

/** The preview's description: the market's question and what the reader can
 * still do about it. */
export const challengeDescription = ({
	view,
	marketTitle
}: {
	view: ChallengeView;
	marketTitle: string | undefined;
}): string => {
	const prompt = !view.marketOpen
		? undefined
		: isNullish(view.position)
			? OPEN_PROMPT
			: DISPUTE_PROMPT;

	return [marketTitle?.trim(), prompt].filter((part) => (part ?? '') !== '').join(' ');
};

/**
 * The head fragment for a challenge: a fixed template in which every
 * interpolated value is escaped, since nginx injects it into the page every
 * visitor of the link loads. `appOrigin` is the app's public origin.
 */
export const renderChallengeHead = ({
	id,
	view,
	marketTitle,
	appOrigin
}: {
	id: string;
	view: ChallengeView;
	marketTitle: string | undefined;
	appOrigin: string;
}): string => {
	const title = escapeHtml(`${challengeHeadline(view)}${TITLE_SUFFIX}`);
	const description = escapeHtml(challengeDescription({ view, marketTitle }));
	const url = escapeHtml(new URL(`${CHALLENGE_LINK_PATH_PREFIX}${id}`, appOrigin).href);
	const image = escapeHtml(new URL(CHALLENGE_SHARE_IMAGE.path, appOrigin).href);
	const imageAlt = escapeHtml(CHALLENGE_SHARE_IMAGE.alt);

	return [
		`<title>${title}</title>`,
		`<meta name="description" content="${description}" />`,
		`<meta name="robots" content="noindex, nofollow" />`,
		`<meta property="og:type" content="website" />`,
		`<meta property="og:site_name" content="${SITE_NAME}" />`,
		`<meta property="og:url" content="${url}" />`,
		`<meta property="og:title" content="${title}" />`,
		`<meta property="og:description" content="${description}" />`,
		`<meta property="og:image" content="${image}" />`,
		`<meta property="og:image:secure_url" content="${image}" />`,
		`<meta property="og:image:width" content="${CHALLENGE_SHARE_IMAGE.width}" />`,
		`<meta property="og:image:height" content="${CHALLENGE_SHARE_IMAGE.height}" />`,
		`<meta property="og:image:type" content="${CHALLENGE_SHARE_IMAGE.type}" />`,
		`<meta property="og:image:alt" content="${imageAlt}" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
		`<meta name="twitter:title" content="${title}" />`,
		`<meta name="twitter:description" content="${description}" />`,
		`<meta name="twitter:image" content="${image}" />`,
		`<meta name="twitter:image:alt" content="${imageAlt}" />`
	].join('\n');
};

/** The market's registry title, or undefined when the registry no longer
 * lists the series. */
export const challengeMarketTitle = async (seriesId: string): Promise<string | undefined> =>
	(await getSeries(seriesId))?.title;
