import { LANDING_DECK_SERIES } from '#lib/constants/landing.constants.ts';
import { E2E_LANDING_DECK_SERIES } from '#root/backend/e2e/fixtures.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('landing deck E2E fixtures', () => {
	it('serve every curated landing market from the fake engine', () => {
		// When the deck rotates, update `E2E_LANDING_DECK_SERIES` too: a deck
		// market the fake engine lacks is an engine 404, which fails every
		// web2 spec that opens the landing.
		assert.deepEqual(
			E2E_LANDING_DECK_SERIES.map(({ seriesId }) => seriesId),
			LANDING_DECK_SERIES.map(({ seriesId }) => seriesId)
		);
	});
});
