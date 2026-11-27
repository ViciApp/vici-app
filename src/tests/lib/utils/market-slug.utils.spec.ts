import {
	MARKET_SHARE_PATH,
	marketShareIdPrefix,
	marketShareParam,
	marketShareUrl,
	uniqueSeriesIdWithPrefix
} from '#lib/utils/market-slug.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const SERIES_ID = '3fa9c21b77e04d1e9b0c';
const TITLE = 'Will Barça be top of La Liga on New Year’s Eve?';

describe('market-slug.utils', () => {
	describe('marketShareUrl', () => {
		it('is the /m/ link of the share param', () => {
			assert.equal(MARKET_SHARE_PATH, '/m');
			assert.equal(
				marketShareUrl({ origin: 'https://vici.app', title: TITLE, seriesId: SERIES_ID }),
				`https://vici.app/m/${marketShareParam({ title: TITLE, seriesId: SERIES_ID })}`
			);
		});

		it('carries the referral code when there is one', () => {
			const url = marketShareUrl({
				origin: 'https://vici.app',
				title: TITLE,
				seriesId: SERIES_ID,
				ref: 'ABCD2345'
			});

			assert.match(url, /^https:\/\/vici\.app\/m\/[a-z0-9-]+~3fa9c21b\?ref=ABCD2345$/);
		});

		it('omits an empty referral code', () => {
			assert.doesNotMatch(
				marketShareUrl({ origin: 'https://vici.app', title: TITLE, seriesId: SERIES_ID, ref: '' }),
				/\?/
			);
		});

		it('falls back to the bare id for a title with no slug', () => {
			assert.equal(
				marketShareUrl({
					origin: 'https://vici.app',
					title: '日本は来年のワールドカップで優勝しますか？',
					seriesId: SERIES_ID
				}),
				`https://vici.app/m/${SERIES_ID}`
			);
		});
	});

	describe('marketShareIdPrefix', () => {
		it('reads the suffix of a slugged param and the whole of a bare one', () => {
			assert.equal(
				marketShareIdPrefix(marketShareParam({ title: TITLE, seriesId: SERIES_ID })),
				SERIES_ID.slice(0, 8)
			);
			assert.equal(marketShareIdPrefix(SERIES_ID), SERIES_ID);
		});

		it('refuses a malformed param', () => {
			for (const param of ['', 'barca', 'barca~zz', 'barca~3FA9C21B', '3fa9c2', 'foo~a']) {
				assert.equal(marketShareIdPrefix(param), undefined);
			}
		});
	});

	describe('uniqueSeriesIdWithPrefix', () => {
		it('needs exactly one match', () => {
			const seriesIds = ['3fa9c21b00', '3fa9c21b11', '7a000000aa'];

			assert.equal(uniqueSeriesIdWithPrefix({ seriesIds, prefix: '7a000000' }), '7a000000aa');
			assert.equal(uniqueSeriesIdWithPrefix({ seriesIds, prefix: '3fa9c21b' }), undefined);
			assert.equal(uniqueSeriesIdWithPrefix({ seriesIds, prefix: 'ffffffff' }), undefined);
		});
	});
});
