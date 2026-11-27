import { newAppPageUrl } from '#lib/utils/new-app.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const ORIGIN = 'https://vici.app';

describe('new-app.utils', () => {
	describe('newAppPageUrl', () => {
		it('keeps the path, query and fragment of the legacy page', () => {
			assert.equal(
				newAppPageUrl({
					origin: ORIGIN,
					pathname: '/m/will-it-rain',
					search: '?ref=ABC123',
					hash: '#comments'
				}),
				'https://vici.app/m/will-it-rain?ref=ABC123#comments'
			);
		});

		it('sends the root to the root', () => {
			assert.equal(
				newAppPageUrl({ origin: ORIGIN, pathname: '/', search: '', hash: '' }),
				'https://vici.app/'
			);
		});
	});
});
