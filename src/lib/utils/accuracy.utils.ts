/**
 * Headline accuracy figure shown on a user's OWN stat surfaces (profile,
 * portfolio, settings).
 *
 * `profile.accuracy` is persisted as a 0..100 win-rate, defaulting to `0` (see
 * `profile.services.ts` `calculateAndSyncStats`). For a user who has not had a
 * single prediction settle yet, that `0` is indistinguishable from "wrong every
 * time": a discouraging, misleading read for someone whose calls are simply
 * still in flight. So when there are no settled (won/lost) predictions we render
 * an optimistic 100% instead: you can't have been wrong about anything yet.
 *
 * Display-only by design: the persisted `accuracy`, and the competitive
 * leaderboard ranking it feeds (see `standings.services.ts`): keeps its real
 * value, so an empty-state user is never hoisted up the standings. Only call
 * this for the viewer's own profile; `settledCount` must be the *viewer's* own
 * decisive resolved-prediction count (see `decisiveSettledCount`).
 *
 * `initialized` guards the trade-history load: while it is still fetching the
 * count reads `0` from the empty default, which would flash a fake 100% for a
 * returning user with real history, so until the store is ready we fall back
 * to the persisted figure.
 *
 * Returns the percentage WITHOUT a trailing '%', matching the existing
 * `toFixed(1)` call sites (each appends its own unit).
 */
export const displayAccuracyPct = ({
	accuracy,
	settledCount,
	initialized
}: {
	accuracy: number;
	settledCount: number;
	initialized: boolean;
}): string => (initialized && settledCount === 0 ? (100).toFixed(1) : accuracy.toFixed(1));
