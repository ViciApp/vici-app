# Spec: Real VXP credit for flow milestones and overtime

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#956)

## Goal

Credit two already-designed Flow earn surfaces to the user's real VXP
balance: crossing a lifetime call-count milestone (10/100/500/1000 calls →
50/100/250/500 VXP, once each ever) and finishing a local day in overtime
(reaching the Flow daily hard cap → 25 VXP, repeatable daily). Today these grants are computed and
shown in the Flow UI but **never credited**: they are display-only. This
turns the scaffolding into live awards through the existing server-fired
payout path.

## Context

This completes deferred work, not a new feature. The award types and
amounts were landed deliberately as additive groundwork in #562 ("a later
change will mint VXP… lands only the additive groundwork"); the payout PR
never followed. The parent issue is **#350** ("Real VXP credit path for
flow-session grants: deferred"), which records that the icdc-core
dependency resolved as a no-op and this is now **entirely vici-side** work.
The display-only state was intentional: per #350, per-swipe XP was removed
in a "deflation-safe economy pass" precisely to avoid crediting a
misleading client-side number.

Already in place:

- Award types: `flow_milestone`, `flow_overtime` in the `VxpAwardType`
  union (`src/lib/types/vxp-award.ts`) and its Zod mirror
  (`src/lib/schema/vxp-award.schema.ts`). The doc comment already fixes the
  `awardKey` shapes: `flow_milestone` = the crossed threshold as text
  (`'10' | '100' | '500' | '1000'`); `flow_overtime` = the Flow
  daily-counter local-day key (`'<YYYY-MM-DD>'`, the `dayKey`
  `recordFlowSwipe` uses).
- Amounts: `VXP_FLOW_MILESTONES` and `VXP_FLOW_OVERTIME_BONUS` in
  `src/lib/constants/vxp-economy.constants.ts` (whole-VXP integers, server
  converts to base units: same convention as `VXP_STREAK_BONUSES`).
- The payout machinery: the `VXP_AWARDS` collection
  (`src/lib/constants/collections.constants.ts`) already runs a
  server-fired pending→paid path for streak / comeback / referral /
  worlds-podium / tournament-prize, with idempotency via `vxpAwardKey({
recipient, awardType, awardKey })`.
- The pattern to mirror exactly:
  `src/satellite/services/vxp-streak-awards.services.ts`
  (`onProfileSetForStreakAward`), registered in the profile dispatch table
  alongside `onProfileSetForVxpOnboarding` / `onProfileSetForReferralCode`.
  Streak fires off `profile.dailyStreak`: a client-written field,
  server-validated in the collection assert with an idempotency key. Flow
  awards follow the same shape.

The real VXP balance is the `vici-points` ICRC-1 ledger; awards mint via
`transferWithBadFeeRetry` and enter clearing through the normal
`deposit_collateral` → `ViciXp` path. The clearing engine stays agnostic.

## Scope

Trust model is decided: **client-trusted counters with an overtime cap**
(see Decisions). As built:

- **Counter sources: both reuse existing state, so no schema change.**
  Milestones read the lifetime `totalTrades` delta on the profile (the
  client-synced lifetime call count the affiliation / podium awards already
  trust). Overtime reuses the **existing** server-maintained
  `dailyGoalDone` / `dailyGoalDate` pair: `recordFlowSwipeFn` already
  increments it monotonically and computes `capReached`. No new profile
  field was needed, so there is **no `.did` / bindings regeneration**.
- **Milestone** → `onProfileSetForFlowMilestone` in the new
  `src/satellite/services/vxp-flow-awards.services.ts`, mirroring
  `vxp-streak-awards.services.ts`, registered in the profile dispatch
  table. Detects `totalTrades` crossing 10 / 100 / 500 / 1000 and pays each
  once ever.
- **Overtime** → minted **inline in `recordFlowSwipeFn`** when
  `capReached`, because that endpoint writes the counter with `setDocStore`
  and serverless writes fire no `onSetDoc` hook (same constraint that forced
  the referral payout inline). The handler is now `async`.
- **Overtime cap.** `VXP_FLOW_OVERTIME_ROLLING_CAP` /
  `VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS` in `vxp-economy.constants.ts`. The
  per-day award key already caps one mint per local day; the rolling cap
  counts `flow_overtime` docs by store-stamped `created_at` (unforgeable) so
  a client replaying many well-formed-but-fake `dayKey`s in a short window
  can't farm it.
- **Amounts via `parseToken`** (constants are whole VXP; ledger is base
  units). Note: the existing streak award uses raw `BigInt(...)` and
  under-pays ~10⁴×, out of scope here, flagged for a separate fix.
- No assert change needed: `assertSetVxpAward` is generic over `awardType`,
  so the two new types pass the existing structural + idempotency gate.

### Out of scope

- Changing any amount or threshold (those are the signed-off constants).
- The payout-preview vs settlement floor divergence (a separate
  market-engine display concern).
- Sinks / inflation control (an economy-design decision, not this issue).
- Any client-side Flow UI change: the grants are already displayed; this
  only makes them real.

## Linked issues

Closes #350. Builds on the groundwork from #562.

## Analytics

No new analytics, and none emitted from this code. The existing server-side
award services (streak / calibration / comeback / podium) do **not** emit
analytics (they record outcomes via `logInfo` / `logError` only) and these
two awards follow that same pattern, so the implementation stays consistent
rather than introducing a one-off server emit. The `vxp_awarded` event in
`src/lib/types/analytics-event.ts` exists for client-side capture when a
credit is observed; wiring server-side analytics is a separate, codebase-wide
decision, not part of this change.

## Technical requirements (satellite / backend, mandatory)

- **Performance.** Runs in the existing profile-set dispatch, same trigger
  cadence as the streak hook; bounded work: at most four milestone
  threshold checks plus one overtime check per profile write. No new
  fan-out.
- **Memory & storage.** New `vxp_awards` docs only: ≤4 milestone docs per
  user lifetime, plus at most one overtime doc per user per active local
  day. Same doc shape and retention as existing award types (immutable
  record). Overtime is the only growth vector: one small doc per overtime
  day.
- **Scalability.** Per-user, no cross-user reads; 10×/100× users scales
  linearly in award docs, no N+1.
- **Security.** Counters are client-trusted: the same threat model as the
  shipped streak and Worlds-podium awards, which already mint real VXP off
  client-synced counts. The protections are structural: per-key idempotency
  (milestone once-ever, overtime once-per-day) plus the rolling overtime cap
  that bounds cumulative exposure to a writer who fakes the day counter.
  Lifetime milestones are a one-time 900 VXP total; the recurring surface is
  only the capped overtime mint. The assert stays structural (key shape,
  recipient-binds-caller, immutability, forward-only status): it does not
  re-derive the count, matching `assertSetVxpAward` today.
- **Upgrade & compatibility.** No schema change: milestones reuse
  `totalTrades` and overtime reuses the existing `dailyGoalDone` /
  `dailyGoalDate`. The candid surface is unchanged (`recordFlowSwipe`'s
  args/result are identical; the new logic is internal hooks/services), so
  **no `.did` / declarations regeneration**. `juno:functions:build` was run
  to verify the wasm compile; its declarations drift (pure formatting) was
  reverted as spurious. Not a breaking change.
- **Parameters.** Amounts/thresholds are `VXP_FLOW_MILESTONES` and
  `VXP_FLOW_OVERTIME_BONUS` in `vxp-economy.constants.ts`; the new overtime
  rolling cap lands beside them. Cite, do not restate. The cap's exact
  ceiling is a tunable to set in that file (see Decisions).

## Implementation outline (as built)

1. Add `VXP_FLOW_OVERTIME_ROLLING_CAP` /
   `VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS` to
   `src/lib/constants/vxp-economy.constants.ts`, beside
   `VXP_FLOW_OVERTIME_BONUS`.
2. Add `src/satellite/services/vxp-flow-awards.services.ts`:
   `onProfileSetForFlowMilestone` (milestone detection from the
   `totalTrades` delta) + `mintFlowOvertime` (idempotency, rolling-cap scan
   via `listDocsStore`, payout). Amounts via `parseToken`; shared
   `payFlowAward` body mirrors the streak service; memos
   `vxp:flow_milestone:${threshold}` / `vxp:flow_overtime:${dayKey}`.
3. Register `onProfileSetForFlowMilestone` in `onProfileSetComposed`
   (`src/satellite/index.ts`).
4. Make `recordFlowSwipeFn` `async` and call `mintFlowOvertime` inline when
   `capReached`; make the `recordFlowSwipe` handler `async`/`await`.
5. Fix the `flow_overtime` `awardKey` doc in `src/lib/types/vxp-award.ts`
   (local-day key, not UTC).
6. `npm run juno:functions:build` (verify wasm compile; revert the spurious
   declarations formatting drift), `npm run check`, `npm run check:i18n`,
   `eslint` + `prettier` on changed files.

## Acceptance criteria

- [ ] Crossing 10/100/500/1000 lifetime calls credits 50/100/250/500 VXP to
      the ledger, once each ever (verified idempotent across repeated
      profile writes).
- [ ] Reaching the Flow daily hard cap credits 25 VXP once for that local
      day; further swipes the same day pay nothing.
- [ ] Once the rolling overtime cap is hit, further overtime finishes in the
      window pay nothing until the window rolls forward.
- [ ] Re-emitting the same milestone/overtime award (duplicate key) is
      rejected by the assert: no double-credit.
- [ ] Amounts land as whole VXP (e.g. 50 VXP, not 0.0050), sized via
      `parseToken`, not raw `BigInt`.
- [ ] No `.did` / declarations drift is committed (candid surface
      unchanged).
- [ ] `npm run check`, `eslint`, `prettier`, and `check:i18n` pass.

Pending real-environment verification (needs the Juno emulator + a local
wasm upgrade, not runnable here): end-to-end idempotency, the inline
overtime mint firing on the cap-reaching swipe, and the rolling-cap scan.

## Decisions

- **Trust model: client-trusted counters with an overtime cap.** Chosen
  over a clearing-authoritative count. Rationale: the shipped economy
  already mints real VXP off client-synced counts: streak trusts
  `dailyStreak`, and Worlds-podium pays on `totalCalls`/accuracy, and
  `assertSetVxpAward` is purely structural. Deriving placements from
  icdc-core clearing would be a one-off, high-effort pattern and must bridge
  a placement-vs-settlement gap, all for amounts this small. The client-
  trusted approach is consistent and cheap; it does not change the existing
  threat model, it extends it.
- **Counter sources (refined during build).** Milestones reuse the lifetime
  `totalTrades` delta (the client-synced call count; no new field). Overtime
  reuses the **existing** server-maintained `dailyGoalDone` /
  `dailyGoalDate`: `recordFlowSwipeFn` already increments it and computes
  `capReached`, so no new counter field was needed either. Net: **no
  profile-schema change, no bindings regen** (simpler than the spec first
  assumed).
- **Overtime minted inline, not via a hook.** `recordFlowSwipeFn` writes the
  counter with `setDocStore`, and serverless writes fire no `onSetDoc` hook,
  so the mint had to live inside that endpoint (the same lesson as the
  referral payout). The handler is now `async`.
- **Overtime cap.** `VXP_FLOW_OVERTIME_ROLLING_CAP` (default 8) over
  `VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS` (default 7 days), counted off
  store-stamped `created_at`. Set just above the natural once-per-day rate so
  legitimate daily players are never blocked. Exact ceiling is a tunable:
  confirm with the economy owner.
- **Assert unchanged.** `assertSetVxpAward` is generic over `awardType`, so
  the two new types pass the existing structural + idempotency gate with no
  edit.
- **Amounts via `parseToken`.** Constants are whole VXP; the ledger works in
  base units. While mirroring the streak service, found that streak uses raw
  `BigInt(VXP_STREAK_BONUSES[...])` and under-pays ~10⁴×: a real bug,
  out of scope here, flagged for a separate fix (the Worlds-podium service
  documents the correct `parseToken` pattern this implementation follows).
