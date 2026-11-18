/**
 * Leaderboard ranking parameters.
 *
 * Raw accuracy lets a one-and-done predictor top the board; a 100%-on-1
 * record outranks a seasoned 90%-on-50 record. Two guards fix it, applied
 * over the same fetched slice the board already re-ranks:
 *
 *  1. {@link LEADERBOARD_QUALIFY_MIN}: the minimum settled calls a predictor
 *     needs to be *ranked at all*. Below it they are "provisional": shown in a
 *     separate section with progress, never in a ranked slot.
 *  2. The Bayesian-shrinkage score ({@link LEADERBOARD_PRIOR_MEAN} /
 *     {@link LEADERBOARD_PRIOR_WEIGHT}): even qualified records with thin
 *     histories decay toward the population mean instead of riding a short
 *     lucky streak to #1. Same shape as the league screen's prior-weighted
 *     blend (`league-rank.utils.ts`), kept conceptually aligned.
 */

/**
 * Minimum settled calls to appear in the *ranked* leaderboard. A predictor
 * below this is provisional (unranked). Exposed live via the dev Tweaks panel
 * (`leaderboardQualifyMin` in `#lib/stores/tweaks.store.ts`) so the threshold can
 * be tuned without a deploy.
 */
export const LEADERBOARD_QUALIFY_MIN = 10;

/**
 * Population baseline a thin record shrinks toward (a 0–1 accuracy fraction).
 * 0.5 = "coin flip until proven otherwise".
 */
export const LEADERBOARD_PRIOR_MEAN = 0.5;

/**
 * Strength of the prior, in "virtual calls". A record only outweighs the prior
 * once its settled count is large relative to this, so 20 virtual calls at
 * 50% sit underneath any genuinely-proven record.
 */
export const LEADERBOARD_PRIOR_WEIGHT = 20;
