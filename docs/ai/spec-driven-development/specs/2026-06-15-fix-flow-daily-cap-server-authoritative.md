# Spec: Make the Flow daily swipe cap server-authoritative

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#904)

## Goal

The 15-swipe daily Flow cap (`DAILY_HARD_CAP`) holds across reloads,
cleared storage, and sign-outs. Today it is enforced **only on the
client**, so an honest user who loses both client stores gets a fresh
10 (+5 overtime) allotment: the reported "I keep seeing more swipes
after finishing my daily ones." After this change the authoritative
count lives on the satellite and cannot be reset or inflated by the
client, so the cap is real for any honest session.

## Context

How the cap works today (all client-side):

- Two numbers: `DAILY_GOAL_TARGET = 10` (`daily-goal.utils.ts`) and
  `DAILY_HARD_CAP = 15` (`motion-engine.utils.ts`). Goal-vs-cap and the
  "Push-to-15" overtime are intended, not the bug.
- Per-swipe commit in `src/lib/components/market/FlowMode.svelte`
  (~696–730): `betsCount += 1` → `applyDailyGoalBump({ target: DAILY_HARD_CAP })`
  (caps the stored count at 15) → `writeDailyGoalMirror(goalBump)`
  (synchronous localStorage `vici.flow.daily-goal.v1`) → **fire-and-forget**
  `persistDailyGoal(...)`.
- Entry reconcile: `reconcileDailyGoalOnEntry` (`daily-goal.utils.ts` 106) takes `max(profile.dailyGoalDone, localStorage mirror)`, each
  rolled to the local day via `todayKey`. Drives `sessionBaseline`
  and the `dailyCapReached` takeover (`FlowMode.svelte` 374–388, 316).
- `persistDailyGoal` (`src/lib/services/profile.services.ts:276`) is a
  thin `patchProfile({ patch: { dailyGoalDone, dailyGoalDate } })`:
  a plain **client `set_doc`** to the user-owned `Collection.PROFILES`.
- The only server guard on profile writes is `assertSetDoc`
  (`src/satellite/index.ts:1132`), which for `PROFILES` runs
  `assertValidNickname` and **nothing about the daily goal**. So the
  client fully controls `dailyGoalDone`: it can write any value, or a
  lower one, with no check.

Why it leaks: the count survives only as long as **both** the
localStorage mirror and the best-effort profile write survive. Cleared
storage (in-app webview / private mode), a dropped profile write, a
sign-out / identity switch, or a different browser/device all reset the
client view to 0 → a fresh allotment.

Architectural constraint: Flow swipes place orders **FE→engine
directly**, and the icdc-core engine is deliberately agnostic
(`docs/engine-integration.md`; it must not know about Vici's daily
cap). So enforcement cannot live in the order path: it must live in
the **satellite**, which already owns the profile + the
`dailyGoalDone` field.

## Scope

Make the satellite the source of truth for the daily count, two parts:

### 1. Authoritative increment endpoint (the count is computed server-side)

- New `recordFlowSwipe()` `defineUpdate` in `src/satellite/index.ts`
  (+ a `recordFlowSwipe` service in
  `src/satellite/services/profile.services.ts`). No client-supplied
  count: the server reads the caller's profile, rolls over by
  `dailyGoalDate` vs the day key supplied by the client, then
  **atomically** sets `dailyGoalDone = min(DAILY_HARD_CAP, prevForToday + 1)`
  and `dailyGoalDate = dayKey`. Returns
  `{ dailyGoalDone, dailyGoalDate, capReached }`.
- `DAILY_HARD_CAP` becomes a value the satellite knows. Put the
  constant where both FE and satellite can import it without the FE
  pulling satellite code (e.g. a shared `src/lib/constants/` module the
  satellite is allowed to import: confirm against
  `docs/ai/satellite/structure.md` import rules; do **not** import
  `@junobuild/core` or FE-only code into the satellite).
- Day-key parity: the server does **not** introduce a UTC day that
  diverges from the client's local midnight. The endpoint **accepts the
  client's local day key** (the `YYYY-MM-DD` string the FE already
  computes via `todayKey` in `src/lib/utils/streak.utils.ts`) as the
  rollover key. The server still computes and caps the increment itself:
  it never accepts a client count. This preserves local-midnight
  semantics and fixes the honest-reset leak (the count is server-stored
  and the monotonic assert blocks downward overwrites). Manipulating the
  day key is an adversarial bypass, explicitly out of scope.

### 2. Assert: profile daily-goal is monotonic-per-day and capped

- Extend the `PROFILES` branch of `assertSetDoc` to reject any client
  profile write that, for an unchanged `dailyGoalDate`, **lowers**
  `dailyGoalDone` or sets it above `DAILY_HARD_CAP`. This stops a reset
  client from overwriting a higher server total downward, so once the
  server records progress, a stale/cleared client can't roll it back.
- A genuine new-day write (date advances) resets to a small value and
  is allowed.

### 3. FE: trust the server count

- `FlowMode.svelte` commit calls `recordFlowSwipe()` and uses the
  returned `dailyGoalDone` / `capReached` as the source of truth for
  `sessionBaseline` / the cap takeover, instead of the locally
  computed `applyDailyGoalBump` value. Keep the localStorage mirror as
  a fast offline hint, but the **server value wins** on reconcile (no
  longer a symmetric `max` with a client value the user can reset).
- Order of operations: record the swipe server-side and only celebrate
  / advance when it succeeds and is under cap; on a transport failure,
  fall back to the existing optimistic path but never _above_ the last
  known server count (don't reintroduce the leak via the error path).

### Out of scope

- Gating the **engine order** itself on the cap. Because orders go
  FE→engine and the engine is agnostic, a crafted client that skips the
  satellite call could still place an order. This spec fixes the
  reported **honest-client reset leak**, not adversarial bypass; true
  anti-abuse would require routing orders through the satellite or an
  engine-side limit and is a separate, larger change. State this
  limitation in `PRODUCT.md`.
- Changing `DAILY_GOAL_TARGET` / `DAILY_HARD_CAP` values or the
  Push-to-15 overtime UX (those are by design).

## Linked issues

No open issue; user-reported 2026-06-15 ("more swipes after finishing
my daily ones"). New fix, no closing keyword unless an issue is filed.

## Implementation outline

1. Relocate `DAILY_HARD_CAP` to a satellite-importable constants module
   (verify import direction against `docs/ai/satellite/structure.md`).
2. Satellite: `recordFlowSwipe` service + `defineUpdate` endpoint;
   extend `assertSetDoc` PROFILES branch with the monotonic-per-day +
   ≤ cap check. The endpoint accepts the client local day key.
3. Regenerate bindings: `npm install` **first** (missing
   `@icp-sdk/bindgen` otherwise churns ~3000 lines, see
   [[reference_analytics_event_is_candid_variant]]), then
   `npm run juno:functions:build`, then `prettier --write` the
   generated `src/declarations/**`; revert incidental
   `package-lock.json` drift; commit the regenerated `.did` /
   declarations (`feedback_juno_bindings_regen`).
4. FE service `recordFlowSwipe`; rewire `FlowMode.svelte` commit +
   `reconcileDailyGoalOnEntry` to treat the server count as
   authoritative.
5. Verify locally with a **local wasm upgrade** (CI satellite builds
   can drop custom methods: junobuild CLI bug, auto-upgrade is off per
   `reference_juno_action_drops_endpoints`; confirm `recordFlowSwipe`
   responds after a local `juno emulator` upgrade, and re-test on the
   real upgrade path before relying on CI).
6. Update `docs/ai/PRODUCT.md` (daily cap is server-authoritative; note
   the adversarial-bypass limitation) in the same PR.

## Acceptance criteria

- [ ] After placing 15 swipes in a day, clearing localStorage AND
      forcing a profile re-fetch (or signing out and back in) still
      shows the "come back tomorrow" cap takeover: no fresh allotment.
- [ ] A direct client profile write that lowers `dailyGoalDone` for the
      same `dailyGoalDate`, or sets it above `DAILY_HARD_CAP`, is
      rejected by `assertSetDoc`.
- [ ] `recordFlowSwipe` increments server-side without trusting any
      client-supplied count, caps at `DAILY_HARD_CAP`, and rolls over on
      a new day.
- [ ] A swipe near local midnight is neither double-counted nor
      wrongly reset (the chosen day-key rule is documented and holds).
- [ ] A `recordFlowSwipe` transport failure degrades gracefully and
      never lets the session exceed the last known server count.
- [ ] `npm run quality`, `npm run check`, and
      `npm run juno:functions:build` pass; regenerated bindings
      committed; verified against a local wasm upgrade.

## Decisions

- **Server computes the increment; the client never sends the count.**
  An endpoint that trusts a client value is no better than today's
  `set_doc`: the whole point is the count cannot be reset or inflated
  by the client.
- **Assert is the backstop, the endpoint is the mechanism.** The
  endpoint is the normal write path; the monotonic-per-day assert
  ensures even a direct `set_doc` to the profile can't roll the count
  backward within a day.
- **Scope is the honest-reset leak, not adversarial bypass.** Gating
  the agnostic engine order is explicitly out of scope; documented as a
  known limitation so the boundary is honest.
- **Day-key basis: accept the client's local day key, server computes
  the count.** The server does not introduce a UTC day that would
  diverge from the client's local midnight; the endpoint takes the
  `YYYY-MM-DD` the FE already computes via `todayKey` and uses it only
  as the rollover key, while still computing and capping the increment
  itself. This keeps local-midnight semantics intact and fixes the
  honest-reset leak. Manipulating the day key is an adversarial bypass,
  explicitly out of scope.
