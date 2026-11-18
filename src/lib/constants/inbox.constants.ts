import { DAY_IN_MS } from '#lib/constants/time.constants.ts';

// localStorage keys for the inbox read-state. Kept here, in a side-effect-free
// module, so `identity-storage.services` can clear them on an identity change
// without importing `inbox.store`: that module starts a long-lived toast
// subscription at import, which we don't want on the signed-out/marketing cold
// path. `inbox.store` reads/writes these; the reconcile only deletes them.
export const INBOX_SETTLED_READ_STORAGE_KEY = 'vici.inbox.resolves.read.v1';
/**
 * Per-id read overlay for inbox cards that aren't backed by the settled
 * read-set (synthetic friend requests, battle responses, likes). Tapping a
 * card's unread dot marks it read in place; the marker is keyed by the
 * notification `id`.
 */
export const INBOX_READ_STORAGE_KEY = 'vici.inbox.read.v1';
/**
 * Per-id dismissed set. Swiping a card away adds its `id` here; dismissed
 * cards are filtered out of the inbox list. Persisted alongside the read
 * state so the dismissal survives reloads.
 */
export const INBOX_DISMISSED_STORAGE_KEY = 'vici.inbox.dismissed.v1';
/**
 * High-water marker for the streak / level inbox cards. `level` and the
 * daily-streak milestone are monotonic counters, so a card "exists" only
 * while the live value exceeds the last-acknowledged value stored here.
 * Seeded to the current value on first observation (so a returning user
 * sees no retroactive backlog), advanced on acknowledge, and, for the
 * streak, which resets on a break, lowered when the run drops below it so
 * re-climbing re-notifies. `*CrossedAt_ms` records when an unacknowledged
 * milestone first appeared, for the card's relative-time label.
 */
export const INBOX_PROGRESS_STORAGE_KEY = 'vici.inbox.progress.v1';
/**
 * Per-market baseline of the YES probability the viewer was last shown, for
 * the saved-market move alerts. `{ [marketId]: { yes: number; at_ms: number } }`.
 * Seeded on first observation (no alert), advanced when an alert fires, and
 * pruned for markets no longer saved.
 */
export const INBOX_MARKET_BASELINE_STORAGE_KEY = 'vici.inbox.market-baseline.v1';
/**
 * Persisted, capped, windowed list of fired market-move alert cards. A move is
 * a transient event between two reads with no re-derivable source (unlike the
 * monotonic streak/level fields), so the fired alert is stored rather than
 * recomputed; the per-id read overlay, the dismissed set and the window keep
 * it bounded.
 */
export const INBOX_MARKET_ALERTS_STORAGE_KEY = 'vici.inbox.market-alerts.v1';
/**
 * Minimum absolute YES-probability shift (in 0..1 units) on a saved market that
 * fires a move alert. `0.1` = 10 percentage points. Tunable without a spec.
 */
export const MARKET_MOVE_THRESHOLD = 0.1;
/** How long a fired market-move alert stays in the inbox before it ages out. */
export const MARKET_ALERT_WINDOW_MS = 5 * DAY_IN_MS;
/** Cap on retained market-move alerts (most-recent kept) to bound storage. */
export const MARKET_ALERT_MAX = 30;
