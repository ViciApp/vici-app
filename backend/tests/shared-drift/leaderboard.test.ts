// The global leaderboard's qualify gate and confidence-adjusted score: the API
// ranks rank lookups and rivals with the same parameters the app's visible
// board re-ranks with, so the two orders agree.

import { describe, expect, test } from 'bun:test';
import {
	LEADERBOARD_PRIOR_MEAN,
	LEADERBOARD_PRIOR_WEIGHT,
	LEADERBOARD_QUALIFY_MIN
} from '../../src/profiles/leaderboard';
import { importRepoModule } from '../helpers/repo-source';

describe('shared drift: global leaderboard', () => {
	test('qualify gate and shrinkage prior', async () => {
		const app = await importRepoModule<{
			LEADERBOARD_PRIOR_MEAN: number;
			LEADERBOARD_PRIOR_WEIGHT: number;
			LEADERBOARD_QUALIFY_MIN: number;
		}>('src/lib/constants/standings.constants.ts');

		expect({ LEADERBOARD_PRIOR_MEAN, LEADERBOARD_PRIOR_WEIGHT, LEADERBOARD_QUALIFY_MIN }).toEqual({
			LEADERBOARD_PRIOR_MEAN: app.LEADERBOARD_PRIOR_MEAN,
			LEADERBOARD_PRIOR_WEIGHT: app.LEADERBOARD_PRIOR_WEIGHT,
			LEADERBOARD_QUALIFY_MIN: app.LEADERBOARD_QUALIFY_MIN
		});
	});
});
