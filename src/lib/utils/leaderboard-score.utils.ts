import {
	LEADERBOARD_PRIOR_MEAN,
	LEADERBOARD_PRIOR_WEIGHT
} from '#lib/constants/standings.constants.ts';

/** A predictor's settled record: the figures the global ranking scores. */
export interface SettledRecord {
	winCount: number;
	settledCount: number;
}

/**
 * Bayesian-shrinkage leaderboard score for one settled record.
 *
 * A predictor's win rate is blended with a population prior, weighted by how
 * much evidence they have: `(PRIOR_MEAN·PRIOR_WEIGHT + wins) / (PRIOR_WEIGHT +
 * settled)`. A thin record decays toward the prior mean, so a 10/11 (≈0.91)
 * record scores below a 45/50 (0.90) record once shrunk, being right
 * *repeatedly* is the score, not a short lucky streak.
 *
 * Uses the raw `winCount / settledCount` ratio, NOT the rounded integer
 * `accuracy`, so the blend doesn't compress at the rounding. Returns the prior
 * mean for a zero-settled record (no evidence at all).
 *
 * The one formula behind the visible board (`standings.derived`) and the
 * satellite's stored ranking (`leaderboard.services`); the API's copy is
 * pinned to the same constants by a drift test.
 */
export const rankScore = ({ winCount, settledCount }: SettledRecord): number => {
	// No evidence → the prior mean, explicitly. Guards the documented contract
	// against an inconsistent upstream (a `winCount` with a zero `settledCount`
	// would otherwise lift the score above the prior, even past 1).
	if (settledCount <= 0) {
		return LEADERBOARD_PRIOR_MEAN;
	}

	return (
		(LEADERBOARD_PRIOR_MEAN * LEADERBOARD_PRIOR_WEIGHT + winCount) /
		(LEADERBOARD_PRIOR_WEIGHT + settledCount)
	);
};

/**
 * Ranking order of two settled records: shrinkage score desc, then
 * settledCount desc (more proof breaks a score tie). `0` when they tie on
 * both; each caller adds its own final tie-break.
 */
// eslint-disable-next-line local-rules/prefer-object-params -- compare functions read best with positional params
export const compareRankScore = (a: SettledRecord, b: SettledRecord): number => {
	const scoreA = rankScore(a);
	const scoreB = rankScore(b);

	if (scoreA !== scoreB) {
		return scoreB - scoreA;
	}

	return b.settledCount - a.settledCount;
};
