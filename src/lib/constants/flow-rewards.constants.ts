// Flow Mode reward constants.
//
// The accuracy-surfacing gate. A committed swipe mints NO VXP; the
// economy is deflation-safe (see `docs/ai/frontend/design.md` §7.3): VXP
// is minted only at the overtime finish (+25) and rare lifetime-volume
// milestones, both owned by the motion engine.

/**
 * Lifetime-call threshold below which accuracy is *not* surfaced in
 * the UI. Below the gate, calls + streak are the visible stats; the
 * accuracy percentage unlocks once the sample is large enough to be
 * meaningful.
 *
 * Applies to anywhere user-facing accuracy would otherwise show
 * (Flow end summary, Profile dashboard, leaderboard preview cards).
 */
export const ACCURACY_GATE_CALLS = 30;

/**
 * Daily hard cap: the most predictions a single day's Flow can count
 * (the daily-ten goal plus the +5 Push-to-15 overtime). The cross-session
 * "come back tomorrow" takeover fires once the day's running total reaches
 * this. Lives here, in a dependency-free constants module, so the
 * satellite can import it (it is the authoritative counter, see
 * `recordFlowSwipe`) without dragging in any FE-only / DOM code.
 */
export const DAILY_HARD_CAP = 15;
