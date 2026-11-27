import { LANDING_MARKET_PARAM } from '#lib/constants/landing-markets.constants.ts';
import {
	landingMarketShareUrl,
	linkForHand,
	parseLandingMarketParam
} from '#lib/utils/landing-share.utils.ts';
import { marketShareParam } from '#lib/utils/market-slug.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const SERIES_ID = '3fa9c21b77e04d1e9b0c';
const TITLE = 'Will Barça be top of La Liga on New Year’s Eve?';

describe('landing-share.utils', () => {
	it('names the param m', () => {
		assert.equal(LANDING_MARKET_PARAM, 'm');
	});

	it('builds the landing link with the /m/[id] encoding, separator unescaped', () => {
		const url = landingMarketShareUrl({
			origin: 'https://vici.app',
			title: TITLE,
			seriesId: SERIES_ID
		});

		assert.equal(
			url,
			`https://vici.app/?m=${marketShareParam({ title: TITLE, seriesId: SERIES_ID })}`
		);
		assert.match(url, /\?m=[a-z0-9-]+~3fa9c21b$/);
	});

	it('reads the market back from the link', () => {
		const url = new URL(
			landingMarketShareUrl({ origin: 'https://vici.app', title: TITLE, seriesId: SERIES_ID })
		);

		assert.deepEqual(parseLandingMarketParam(url.search), {
			param: marketShareParam({ title: TITLE, seriesId: SERIES_ID }),
			idPrefix: SERIES_ID.slice(0, 8)
		});
	});

	it('reads back the bare-id link of a title with no slug', () => {
		const title = '日本は来年のワールドカップで優勝しますか？';
		const url = new URL(
			landingMarketShareUrl({ origin: 'https://vici.app', title, seriesId: SERIES_ID })
		);

		assert.equal(url.search, `?m=${SERIES_ID}`);
		assert.deepEqual(parseLandingMarketParam(url.search), {
			param: SERIES_ID,
			idPrefix: SERIES_ID
		});
	});

	it('names no market for a bare param that is not a series id', () => {
		assert.equal(parseLandingMarketParam('?m=barca'), undefined);
		assert.equal(parseLandingMarketParam('?m=3fa9c2'), undefined);
		assert.equal(parseLandingMarketParam('?m=3FA9C21B77E0'), undefined);
	});

	it('names no market for a missing, empty or malformed param', () => {
		assert.equal(parseLandingMarketParam(''), undefined);
		assert.equal(parseLandingMarketParam('?m='), undefined);
		assert.equal(parseLandingMarketParam('?m=barca~zz'), undefined);
		assert.equal(parseLandingMarketParam('?c=barca~3fa9c21b'), undefined);
	});

	it('drops the scheme for a link copied by hand', () => {
		assert.equal(linkForHand('https://vici.app/?m=a~3fa9c21b'), 'vici.app/?m=a~3fa9c21b');
		assert.equal(linkForHand('http://localhost:5173/?m=x'), 'localhost:5173/?m=x');
	});
});
