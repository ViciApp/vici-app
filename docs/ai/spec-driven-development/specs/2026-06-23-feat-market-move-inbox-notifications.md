# Spec: Market-move inbox notifications on saved markets

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#1007)

## Goal

The `market` inbox kind ("YES probability moved X pts on a market you
follow") gets a live producer. When a market the viewer has **saved**
moves materially (its YES probability shifts by at least a threshold
since the viewer last saw it), they get an inbox card ("YES moved +12 pts
on '<market>'"), unread, deep-linking to that market's detail. Gated by the
existing `notify.marketAlerts` preference.

## Context

This is **one of a two-spec pair** reviving the producerless inbox kinds.
The sibling,
[`2026-06-23-feat-streak-level-inbox-notifications.md`](./2026-06-23-feat-streak-level-inbox-notifications.md),
owns `streak` + `level` (pure client-side, no new signal) and ships
first. This spec owns `market`, which needs a new probability-snapshot /
delta signal. The two are independent; this one stacks on the sibling to
avoid `inbox.store.ts` conflicts.

**The "followed markets" concept already exists: it is called _saving_.**
The earlier assumption that no follow concept existed was wrong:

- [`SavedMarketToggle.svelte`](../../../../src/lib/components/saved-markets/SavedMarketToggle.svelte)
  is a heart toggle on markets; `toggleSavedMarket` / `isMarketSaved` /
  `savedMarketIds` live in
  [`preferences.store.ts`](../../../../src/lib/stores/preferences.store.ts)
  and round-trip through the profile (cross-device).
  [`MarketsPage.svelte`](../../../../src/lib/components/pages/MarketsPage.svelte)
  renders a saved-markets section from `$preferencesStore.savedMarketIds`.
- `preferences.notify.marketAlerts` (defaults `true`) is a **dormant**
  preference: declared in
  [`preferences.ts`](../../../../src/lib/types/preferences.ts) /
  [`profile.schema.ts`](../../../../src/lib/schema/profile.schema.ts) but
  consumed nowhere. `savedMarketIds` + `marketAlerts` + the `market`
  notification kind were designed as one feature and never wired; this spec
  wires it.

Backing data + patterns (all client-side):

- **Market probability**: `Market.yesProbability` (0–1, `undefined` until
  the order book is read; `priceLoaded` distinguishes loading from
  no-liquidity) on the catalog exposed by
  [`markets.derived.ts`](../../../../src/lib/derived/markets.derived.ts) /
  `marketById`
  ([`market-by-id.derived.ts`](../../../../src/lib/derived/market-by-id.derived.ts),
  already imported by `inbox.store.ts`), kept fresh by
  [`LoaderMarkets.svelte`](../../../../src/lib/components/loaders/LoaderMarkets.svelte).
- **Inbox**:
  [`inbox.store.ts`](../../../../src/lib/stores/inbox.store.ts): a merge of
  derived sources + the per-id read overlay (`inboxReadStore`) + dismissed
  set + the `combinedInboxStore` + the toast gate (`sourcesHydrated`). The
  kind config (`market` → `Target` / `AppPath.Markets`) already exists in
  [`notification-kind.constants.ts`](../../../../src/lib/constants/notification-kind.constants.ts).
- The `market` mock seed entry in `seedInbox()` is removed by whichever of
  the two specs lands first.

### Why this needs an effect, not a pure derivation

`streak`/`level` derive from a monotonic profile field, but a market-move
alert is a **change event between two reads**: it has no server id and no
monotonic source. So unlike the pure-derived sibling, `market` needs:

1. A persisted **baseline snapshot** per saved market (the YES probability
   the viewer was last shown) under a new key in
   [`inbox.constants.ts`](../../../../src/lib/constants/inbox.constants.ts):
   `{ [marketId]: { yes: number; at_ms: number } }`.
2. A small **effect** (subscription, mirroring `initInboxToasts` /
   `initFlowPrewarm`) that, on each `marketById` / `savedMarketIds` tick,
   for every saved Open market with a loaded `yesProbability`:
   - seeds the baseline when absent (no card: first observation),
   - when `|yes − baseline.yes| ≥ MARKET_MOVE_THRESHOLD`, emits a move
     alert and advances the baseline to the current `yes` (so the same move
     doesn't re-fire),
   - drops baselines for un-saved / resolved markets.
3. A persisted, capped list of **pending move-alert cards**
   (`{ id; marketId; deltaPts; direction; at_ms }`), aged out after a fixed
   window, surfaced by a derived `marketMoveInboxStore`. Persisted (not
   purely synthetic) because the signal is a transient event with no
   re-derivable source: once the probability moves on, the alert can't be
   recomputed. Per-id read overlay + dismiss + the window keep it bounded.

`MARKET_MOVE_THRESHOLD`, the retention window, and the max retained count
are parameters, declared as named constants in `inbox.constants.ts`, not
restated here.

## Scope

1. **Constants** in `inbox.constants.ts`: `INBOX_MARKET_BASELINE_STORAGE_KEY`,
   `INBOX_MARKET_ALERTS_STORAGE_KEY`, `MARKET_MOVE_THRESHOLD` (percentage
   points), `MARKET_ALERT_WINDOW_MS`, `MARKET_ALERT_MAX`.
2. **Baseline + alert stores** in `inbox.store.ts` (load / persist), keyed
   by `marketId`.
3. **`initMarketMoveAlerts(): () => void`**: the effect that snapshots
   saved-market probabilities, seeds baselines, detects threshold crossings
   (gated on `preferences.notify.marketAlerts`), appends capped/windowed
   alerts, and prunes un-saved/resolved baselines. Mounted from a loader
   (see Open questions) and torn down on destroy, like `initInboxToasts`.
4. **`marketMoveInboxStore: Readable<InboxNotification[]>`**: derives cards
   from the persisted alerts + `displayMarkets` (for the translated title) +
   `localeStore`: `id = market-move-<marketId>-<at_ms>`, `kind: 'market'`,
   title/body i18n with the signed delta + market title, `when` relative
   time, `mid = marketId` (deep-link to detail), `unread` via the per-id
   overlay. Drops alerts whose market is gone/resolved or outside the
   window.
5. **Merge** `marketMoveInboxStore` into `combinedInboxStore`; ensure
   `markInboxRead` / `dismissInboxNotification` / `markAllInboxRead` and the
   toast gate handle `market-move-` ids (per-id overlay path: no special
   marker needed, the alert list itself is the source).
6. **Identity-storage reconcile**: clear the two new keys on identity change
   alongside the existing inbox keys (saved markets are per-user).
7. **i18n**: `inbox.market.*` (title + up/down body with `{pts}` and
   `{market}`) across every live catalog; `npm run check:i18n`.
8. Remove the `market` seed entry if the sibling hasn't already.

### Out of scope

- **`streak` / `level` kinds.** Owned by the sibling spec.
- **A new follow affordance.** Reuses the existing saved-markets heart;
  no new UI to follow markets.
- **Server-side push / move detection.** The signal is computed
  client-side from the already-loaded catalog; markets the viewer never
  loads produce no alert (accepted, see Decisions).
- **Per-market alert thresholds / user-tunable sensitivity.** One global
  threshold constant in v1.
- **Resolved-market alerts.** Settlement has its own `resolve` card; move
  alerts are Open-market only.

## Linked issues

None. Searched the open issues (5 total): none tracks notifications,
inbox, or market alerts. No closing keyword.

## Analytics

**Resolved: no new event.** `notification_opened` already carries the kind
as its `label`, so `market` opens are sliceable once the producer exists,
with no taxonomy change. The save/unsave action is a separate concern
(saved-markets feature) and not introduced here. No new analytics event;
no taxonomy touch (the kind already appears in the `notification_opened`
doc comment).

## Technical requirements (satellite / backend: mandatory)

**No satellite/backend change.** The signal is computed client-side from
the already-loaded markets catalog + viewer-scoped localStorage; saved
markets already round-trip through the existing profile preferences write
path (no new collection, doc shape, assert, hook, endpoint, or `.did`).

- **Performance.** The effect runs on `marketById` / `savedMarketIds`
  ticks; work is O(saved markets), a small per-user list, over data
  already in memory. No new network calls; no per-market fan-out (the
  catalog is already loaded for the markets surfaces).
- **Memory & storage.** Two localStorage entries: a baseline map and a
  capped alert list (`MARKET_ALERT_MAX`), both bounded by the saved-markets
  count and the retention window. No server storage.
- **Scalability.** At 10×/100× markets the cost is still bounded by the
  viewer's saved count, not the catalog size. Baselines for un-saved
  markets are pruned each tick.
- **Security.** Reads the viewer's own preferences (`savedMarketIds`,
  `marketAlerts`) and the public markets catalog; writes only
  viewer-scoped localStorage. No new permissions.
- **Upgrade & compatibility.** Additive, client-only, non-breaking. Wires a
  previously-dormant preference (`marketAlerts`); no schema change (the
  field already exists and defaults `true`).
- **Parameters.** `MARKET_MOVE_THRESHOLD`, `MARKET_ALERT_WINDOW_MS`,
  `MARKET_ALERT_MAX` are named constants in `inbox.constants.ts`: cited,
  not restated.

## Implementation outline

1. Add the constants + the baseline/alert load-persist helpers.
2. Implement `initMarketMoveAlerts` (snapshot → seed → detect → append →
   prune), gated on `notify.marketAlerts`; mount it from the resolved
   loader host and tear down on destroy.
3. Add `marketMoveInboxStore`; merge into `combinedInboxStore`; confirm the
   read/dismiss/mark-all + toast-gate paths cover `market-move-` ids.
4. Wire the identity-storage reconcile to clear the new keys.
5. Add `inbox.market.*` i18n across every live catalog.
6. Remove the `market` seed entry if still present.
7. Divergence check; flip status to `Implemented (#PR)`; update
   `docs/ai/PRODUCT.md` (saved-market move alerts; `marketAlerts` now
   live).
8. `npm run quality` + `npm run check`.

## Acceptance criteria

- [ ] Saving a market then having its YES probability move ≥
      `MARKET_MOVE_THRESHOLD` produces one unread `market` card ("YES moved
      ±N pts on '<market>'") at `/notifications`; tapping deep-links to the
      market detail.
- [ ] First observation of a saved market's probability seeds the baseline
      and produces **no** card (only a subsequent move fires).
- [ ] After an alert fires, the baseline advances so the same move does not
      re-fire on the next tick.
- [ ] When `notify.marketAlerts` is off, no market card is produced.
- [ ] Un-saving a market (and resolved markets) stops alerts and prunes the
      baseline; alerts age out after `MARKET_ALERT_WINDOW_MS`.
- [ ] Alerts count toward the unread badge and respect mark-read /
      mark-all-read / dismiss; no toast replay of an existing backlog on
      cold start.
- [ ] Identity change clears the baseline + alert storage (no cross-user
      leak).
- [ ] `npm run quality` (incl. i18n) and `npm run check` pass; no satellite
      build needed.

## Pending decisions

None. Threshold/window/cap are parameters with sensible defaults set in
`inbox.constants.ts` during build; tunable later without a spec.

## Decisions

- **Reuse saved markets as the follow set.** Saving already _is_ following
  a market (heart toggle, cross-device persistence); a separate follow
  concept would duplicate it. `marketAlerts` was the dormant half of this
  feature.
- **Persist alerts, don't purely derive.** A move is a transient event
  between two reads with no re-derivable source, unlike the monotonic
  streak/level fields, so the fired alert is persisted (capped + windowed)
  rather than recomputed.
- **Client-side detection, best-effort.** Alerts fire from the already-
  loaded catalog; a market the viewer never loads in a session simply
  produces no alert that session. Acceptable for an engagement nudge; a
  server-pushed guarantee would need backend work out of scope here.
- **One global threshold in v1.** Per-market sensitivity is a later
  refinement; a single `MARKET_MOVE_THRESHOLD` keeps v1 simple.
- **Hosted in `NotifToastHost`.** `initMarketMoveAlerts` mounts in
  `NotifToastHost`'s `onMount` beside `initInboxToasts` / `initInboxProgress`,
  rather than a bespoke loader: the host is always rendered in the app shell
  and tears the subscription down on destroy. The detector reads whatever
  catalog is loaded; markets the viewer never loads simply produce no alert
  that session (the documented best-effort behaviour).
- **Detect only once the profile is loaded.** Until the profile hydrates,
  `preferencesStore` holds the defaults (no saved markets); pruning against
  that empty set would wipe every baseline on each cold start, so a move
  could never span a reload. The detector waits for the profile, and on an
  owner change re-reads both stores from localStorage (already cleared by
  the identity reconcile on a real account switch).
