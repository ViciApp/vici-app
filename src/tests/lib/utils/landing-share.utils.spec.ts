import {
	LANDING_CLAIM_PARAM,
	LANDING_MARKET_PARAM,
	LANDING_VIEW_PARAM
} from '#lib/constants/landing-markets.constants.ts';
import {
	landingSearch,
	linkForHand,
	parseLandingLink,
	searchWithoutLandingParams
} from '#lib/utils/landing-share.utils.ts';
import { marketShareParam } from '#lib/utils/market-slug.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const SERIES_ID = '3fa9c21b77e04d1e9b0c';
const TITLE = 'Will Barça be top of La Liga on New Year’s Eve?';
const PARAM = marketShareParam({ title: TITLE, seriesId: SERIES_ID });

describe('landing-share.utils', () => {
	it('names the params m, view and claim', () => {
		assert.equal(LANDING_MARKET_PARAM, 'm');
		assert.equal(LANDING_VIEW_PARAM, 'view');
		assert.equal(LANDING_CLAIM_PARAM, 'claim');
	});

	describe('landingSearch', () => {
		it('is empty for a plain landing link', () => {
			assert.equal(landingSearch(), '');
			assert.equal(landingSearch({ search: '' }), '');
		});

		it('names the market with the share param, separator unescaped', () => {
			assert.equal(landingSearch({ market: PARAM }), `?m=${PARAM}`);
			assert.match(landingSearch({ market: PARAM }), /^\?m=[a-z0-9-]+~3fa9c21b$/);
		});

		it('opens a view', () => {
			assert.equal(landingSearch({ view: 'markets' }), '?view=markets');
		});

		it('opens the capsule', () => {
			assert.equal(
				landingSearch({ market: PARAM, view: 'markets', claim: true }),
				`?m=${PARAM}&view=markets&claim=1`
			);
			assert.equal(landingSearch({ claim: false }), '');
		});

		it('keeps the other params and replaces its own', () => {
			assert.equal(
				landingSearch({ market: PARAM, search: '?ref=ABCD2345&m=old&view=cards' }),
				`?m=${PARAM}&ref=ABCD2345`
			);
			assert.equal(
				landingSearch({ view: 'markets', search: '?utm_source=x' }),
				'?view=markets&utm_source=x'
			);
		});
	});

	describe('searchWithoutLandingParams', () => {
		it('drops m and view, keeps the rest', () => {
			assert.equal(searchWithoutLandingParams(`?m=${PARAM}&ref=ABCD2345`), '?ref=ABCD2345');
			assert.equal(searchWithoutLandingParams('?m=a~3fa9c21b&view=markets&claim=1'), '');
			assert.equal(searchWithoutLandingParams(''), '');
		});
	});

	describe('parseLandingLink', () => {
		it('reads the market back from a built link', () => {
			assert.deepEqual(parseLandingLink(landingSearch({ market: PARAM })), {
				market: { param: PARAM, idPrefix: SERIES_ID.slice(0, 8) },
				marketMalformed: false,
				view: undefined,
				claim: false
			});
		});

		it('reads back the bare-id link of a title with no slug', () => {
			assert.deepEqual(parseLandingLink(`?m=${SERIES_ID}`).market, {
				param: SERIES_ID,
				idPrefix: SERIES_ID
			});
		});

		it('flags a malformed market param', () => {
			for (const search of ['?m=barca', '?m=3fa9c2', '?m=3FA9C21B77E0', '?m=barca~zz']) {
				assert.deepEqual(parseLandingLink(search), {
					market: undefined,
					marketMalformed: true,
					view: undefined,
					claim: false
				});
			}
		});

		it('names no market for a missing or empty param', () => {
			for (const search of ['', '?m=', '?c=barca~3fa9c21b']) {
				assert.deepEqual(parseLandingLink(search), {
					market: undefined,
					marketMalformed: false,
					view: undefined,
					claim: false
				});
			}
		});

		it('reads the capsule flag, only as claim=1', () => {
			assert.equal(parseLandingLink('?claim=1').claim, true);
			assert.equal(parseLandingLink('?claim=yes').claim, false);
			assert.equal(parseLandingLink('').claim, false);
		});

		it('reads the view, ignoring an unknown one', () => {
			assert.equal(parseLandingLink('?view=markets').view, 'markets');
			assert.equal(parseLandingLink('?view=cards').view, 'cards');
			assert.equal(parseLandingLink('?view=table').view, undefined);
		});
	});

	it('drops the scheme for a link copied by hand', () => {
		assert.equal(linkForHand('https://vici.app/m/a~3fa9c21b'), 'vici.app/m/a~3fa9c21b');
		assert.equal(linkForHand('http://localhost:5173/m/x'), 'localhost:5173/m/x');
	});
});
