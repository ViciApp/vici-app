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
