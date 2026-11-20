import { LEADERBOARD_PRIOR_MEAN } from '#lib/constants/standings.constants.ts';
import { compareRankScore, rankScore } from '#lib/utils/leaderboard-score.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('leaderboard-score.utils', () => {
	it('scores a record with nothing settled at the prior mean', () => {
		assert.equal(rankScore({ winCount: 0, settledCount: 0 }), LEADERBOARD_PRIOR_MEAN);
		assert.equal(rankScore({ winCount: 3, settledCount: 0 }), LEADERBOARD_PRIOR_MEAN);
	});

	it('ranks a long proven record above a thin one with a higher raw rate', () => {
		const proven = { winCount: 45, settledCount: 50 };
		const thin = { winCount: 10, settledCount: 11 };

		assert.ok(rankScore(proven) > rankScore(thin));
		assert.ok(compareRankScore(proven, thin) < 0);
	});

	it('breaks an equal score by settled calls, and ties a full match', () => {
		const moreCalls = { winCount: 30, settledCount: 40 };
		const fewerCalls = { winCount: 10, settledCount: 10 };

		assert.equal(rankScore(moreCalls), rankScore(fewerCalls));
		assert.ok(compareRankScore(moreCalls, fewerCalls) < 0);
		assert.equal(compareRankScore(moreCalls, { ...moreCalls }), 0);
	});
});
