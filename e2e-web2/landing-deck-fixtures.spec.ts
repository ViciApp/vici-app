import { E2E_LANDING_DECK_SERIES } from '../backend/e2e/fixtures';
import { LANDING_DECK_SERIES } from '../src/lib/constants/landing.constants';
import { expect, test } from './support/fixtures';

/**
 * The fake engine must serve every curated landing market: a deck market it
 * lacks is an engine 404, which fails every spec that opens the landing. When
 * the deck rotates, update `E2E_LANDING_DECK_SERIES` too.
 */
test('the fake engine serves every curated landing market', () => {
	expect(E2E_LANDING_DECK_SERIES.map(({ seriesId }) => seriesId)).toEqual(
		LANDING_DECK_SERIES.map(({ seriesId }) => seriesId)
	);
});
