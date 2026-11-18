# Spec: Battle resolution from settled-call history

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1056)

Shipped across #1003 (proposer handle + settling state) and #1056
(settled-history resolution + live standings). The "Findings (gates the
build)" and "Pending decisions" sections below **predate the build** and
were resolved by **option A**: icdc-core now exposes
`aggregate_settlement_accuracy`, per-member settled accuracy over an
arbitrary `[from, to]` window with a `series_ids` filter, which the
resolution engine reads directly. Everything below is the frozen
decision record; for current behaviour see `PRODUCT.md` §"Battles".

**Implementation note (this PR).** Resolution + live standings now read
each side's current members' settled-call accuracy from the clearing
canister (`aggregate_settlement_accuracy`, with a `series_ids` filter for
a tag-scoped battle's category) over the battle window, via a
controller-only satellite endpoint that writes the resolved doc as a
controller; the `battles` assert accepts an `in_flight → resolved` league
write only from a controller. The `league_stats` kickoff **baselines are
no longer read** for resolution or live standings; a baseline-less legacy
battle resolves like any other, and the **FE** restart/self-heal trigger
(`restartLegacyBattle` + the auto-restart effect) is removed. To bound the
change, the baseline machinery is otherwise **left in place but
vestigial**: accept/kickoff still stamp baselines and the assert still
permits the `in_flight` re-kick (`isRekick`) write, but nothing on the FE
triggers it anymore. Fully retiring the baseline fields, the `isRekick`
assert path, and the accept/kickoff baseline validation is deferred to a
follow-up. Membership is read at resolve time (current members), per the
owner decision, not membership-at-settle-time.

## Goal

League battles resolve from each side's **real settled calls inside the
battle window**, computed from timestamped clearing history rather than
the `league_stats` counter delta. This (a) lets battles that were
accepted before kickoff baselines existed (#912) resolve instead of
hanging forever in `in_flight`, and (b) removes the documented
sync-timing approximation that currently lets a member's in-window calls
go uncounted if they don't open the app before resolution. The user sees
battles that always reach a real, window-true result; an overdue battle
shows a "settling" state instead of a frozen day counter; and the
proposer renders as a handle, not a raw principal.

## Context

- Reconciled against `main` at **v1.8.0** (#998). `resolveBattle` still
  requires baselines (the bug is unfixed); the V1.8 arena work
  (`resolved_results` collection #988: a friend digest of resolved
  _market_ results off an `activities` hook; opponent-notification #986)
  is unrelated to battle resolution and changes nothing here.
- Resolution + live-score + state transitions:
  `src/lib/services/leagues.services.ts`, `resolveBattle` (1138),
  `readBattleLiveScore` (1232), `acceptBattle` (947), `kickoffBattle`
  (1069), `readLeagueStatsBucket` (915).
- Satellite assert (state machine + per-transition auth + trustless
  re-derivation): `src/satellite/services/battle.services.ts`,
  `in_flight->resolved` branch (541), `proposed->in_flight` baseline
  requirement (466).
- League stats fan-out hook (the source of the current attribution
  rule): `src/satellite/services/league-stats.services.ts:170`
  (`onProfileSetForLeagueStats`), credits a member's whole
  since-last-sync `deltaTrades`/`deltaWins` to **current** memberships at
  sync time, forward-only, no per-call timestamp.
- Battle doc shape + helpers: `src/lib/types/battle.ts`, `BattleDoc`
  (103), `battleAccuracyPct` (187), `deriveBattleWinner` (197),
  `BattleWinner` (42).
- Clearing history (caller-scoped, own events only):
  `src/lib/services/trade.services.ts`, `getUserTradeHistory` (119);
  settled/win predicates `src/lib/utils/resolved-position.utils.ts`
  (`isSettledEvent` 13, `isWinningSettledEvent` 23).
- Market-wide fill tape (arbitrary-principal, paginated):
  `src/lib/services/trade.services.ts:222`
  (`list_series_trade_history`), drained in `getSeriesTradeVolume` (232).
- Membership records (carry `joinedAtMs`):
  `src/lib/types/league-member.ts:18`; collection
  `LEAGUE_MEMBERS`.
- Battle detail UI: `src/lib/components/pages/BattleDetailPage.svelte`,
  `dayOf`/`totalDays` clamp (196), `isFinalizing` (214), proposer render
  (553), auto-resolve effect (414).
- Profile-handle resolution to reuse:
  `loadProfilesByPrincipals` (`src/lib/services/profile.services.ts:144`),
  `profilesStore` (`src/lib/stores/profiles.store.ts:17`), and
  `getDisplayName` (`src/lib/services/profile.services.ts:761`).
- Product description this supersedes: `docs/ai/PRODUCT.md` §"Battles"
  (339-410), specifically the trustless re-derivation claim (401) and
  the "known limitations / snapshot delta" note (407-410). Prior decision
  record: `specs/2026-06-15-feat-battle-auto-resolution.md`.

## Scope

1. **Resolution engine → settled-call history.** Replace the
   counter-delta computation in `resolveBattle` with a window-true count:
   for each side, each member's settled calls whose settle timestamp is
   in `[kickoffMs, settleMs)` and where the caller was a member of that
   league at the call's settle time. **Unit discipline:** clearing events
   carry `timestampNs` (nanoseconds, `event.timestamp` mapped in
   `settledEventToResolvedPosition`) while `kickoffMs` / `settleMs` /
   `joinedAtMs` are milliseconds; convert to one unit before comparing
   (e.g. `callMs = Number(timestampNs / 1_000_000n)`, then
   `kickoffMs <= callMs < settleMs` and `joinedAtMs <= callMs`). Scope
   filter (`'all'` or a single tag) preserved. `scoreA/scoreB`,
   `callsA/callsB`, `winner` derived via the existing `battleAccuracyPct`
   / `deriveBattleWinner` so the leaderboard story stays consistent.
2. **Live standings** (`readBattleLiveScore`) use the same window-true
   computation against `now` as the provisional upper bound, so the
   in-flight card and the resolved result share one code path.
3. **Controller-authorized resolve.** Resolution is computed
   client-side (the assert cannot make the inter-canister reads needed to
   re-derive it). The `in_flight->resolved` assert branch gains a path
   that authorizes a resolve written by a satellite controller without
   the `league_stats` re-derivation, and no longer requires
   `baselineA/baselineB` to be present. `baselineA/baselineB` become
   vestigial (kept for back-compat reads; no longer written or required).
4. **Overdue UI**: `BattleDetailPage` shows a settling/overdue state for
   a past-`settleMs` `in_flight` battle instead of clamping to "DAY N OF
   N"; the day counter only renders while genuinely within the window.
5. **Proposer handle**: render `proposer` (and, where shown, side
   principals) via `getDisplayName` + `profilesStore`, hydrated through
   `loadProfilesByPrincipals`, falling back to the shortened principal.
6. **One-off repair**: resolve the known stuck battle
   (`giovanniiiiii-1779997787499--vs--av-league-1780035473396-mq39hvbc`,
   settled 2026-06-15) through the new path. A sweep of other
   pre-baseline `in_flight` battles is out of scope (see below).
7. **PRODUCT.md**: in the same PR, rewrite §"Battles" (339-410) so every
   decision below is reflected in the living product doc, not only in this
   spec:
   - **Scoring model** (392-401): replace the `league_stats` baseline →
     delta description with "each side's real settled calls inside the
     window, attributed to the league the caller was a member of when the
     call settled." Keep the accuracy-first / volume-tiebreak / void-draw
     rules.
   - **Trustlessness** (401-407): correct the "assert independently
     re-derives … rejects any fabricated result" claim to the
     controller-trusted model, stating the trade-off plainly.
   - **Membership attribution**: add the member-at-call-time rule (new;
     the doc is currently silent on it because the counter hid it).
   - **Known limitations** (407-410): delete the "snapshot delta measures
     kickoff → resolution rather than the exact window" approximation; it
     no longer applies; the window is now exact.
   - **Overdue/settling state**: note a past-window battle shows settling,
     not a live day counter.

This spec is the decision record; PRODUCT.md is the current-behaviour
record. Per the truth hierarchy they must agree at merge.

### Out of scope

- Duels (principal-vs-principal): keep the existing manual-score path.
- Migrating/removing the `league_stats` counter or its fan-out hook
  (still drives league rank + leaderboards). Only battle _resolution_
  stops reading it.
- A bulk sweep/auto-repair of every legacy `in_flight` battle. We repair
  the one known row; others self-heal the next time they're opened under
  the new path.
- Moving the VXP **wager** between leagues on resolution (still
  display-only).
- The 100-simultaneous-battle client rail and challenge/accept/expiry
  flows.

## Linked issues

No open issue in this repo matches (searched `battle` in title/body).
The stuck battle was reported in-session against `vici.market`. No
closing keyword.

## Analytics

Reuse the existing `battle_resolved` event emitted on resolution
(`trackResolved` in `BattleDetailPage.svelte`). Add a bounded prop
`resolveBasis: 'history' | 'legacy_void'` to distinguish a real
window-true resolution from a fallback (a side with zero readable
settled calls). No new event _name_, but a new prop _key_ is itself a
taxonomy change: it must land in **both** the TS `AnalyticsEventProps`
(`src/lib/types/analytics-event.ts:227`) and the runtime Zod mirror
`AnalyticsEventPropsSchema` (`src/lib/schema/analytics-event.schema.ts:103`,
a `strictObject` that rejects unknown keys), where the props are
flattened onto `TrackEventInputSchema`. Omitting the schema half makes
runtime validation reject every event carrying the field. No PII;
principals are not logged as event props.

## Technical requirements (satellite / backend, mandatory)

- **Performance.** Resolution is no longer O(1) (one counter read per
  side). It drains the market-wide fill tape for every in-scope series
  and nets per-principal positions client-side. Bound it: page via
  `next_cursor` (`TRADE_HISTORY_PAGE_SIZE`), fold-and-discard like
  `getSeriesTradeVolume`. Resolution fires lazily (battle open), not on a
  poll, acceptable for an interactive action, but it must show progress
  and never block the page.
- **Instruction budget.** The satellite side stays cheap: the assert only
  authorizes a controller write (no fan-out, no re-derivation). All heavy
  compute is client-side. No new hook.
- **Memory & storage.** No new collection. `BattleDoc` gains no required
  field; `baselineA/baselineB` become optional/vestigial.
- **Scalability.** Cost scales with in-scope markets × fills, not users.
  At 100× markets the per-resolution drain grows: **open question**
  whether a market-wide drain is acceptable, or whether icdc-core exposes
  a narrower per-principal settled-events query (see Open questions). If
  not, document the ceiling and consider scoping by the battle's markets.
- **Upgrade & compatibility.** Satellite assert change →
  `npm run juno:functions:build`, commit regenerated `.did` /
  declarations. Behaviour change to resolution + dropping the trustless
  re-derivation is a documented guarantee change; title gets `!` +
  `BREAKING CHANGE:` block. Requires a **manual satellite wasm upgrade**
  (auto-upgrade is off); the repair runs after the upgrade.
- **Security.** Resolution moves from trustless (assert re-derives and
  rejects fakes) to **controller-trusted** (the assert trusts a
  controller-authored result). Document this regression explicitly.
  Member-of-league check moves client-side for the score; the assert
  gates the _write_ on controller identity. Collection rules for
  `BATTLES` unchanged (public read/write); the resolve path additionally
  requires controller for the history-basis branch.
- **Parameters.** Cite `BATTLE_*` constants in `src/lib/types/battle.ts`
  and the page-size constant in `trade.services.ts`; do not restate.

## Implementation outline

1. Add a `battleWindowResult({ leagueId, scope, fromMs, toMs })` helper
   (FE service) that returns `{ calls, wins }` for a league over a window
   from settled-call history + membership-at-call-time. Source TBD by the
   Open question (market tape drain vs. a per-principal settled query).
2. Rewrite `resolveBattle` to compute both sides via
   `battleWindowResult` (`fromMs=kickoffMs`, `toMs=settleMs`), derive
   scores/winner, and write the resolved doc through the controller path.
   Drop the `baselineA/baselineB` nullish guard.
3. Rewrite `readBattleLiveScore` to call `battleWindowResult` with
   `toMs=now`; remove the baseline-nullish early return.
4. Satellite `in_flight->resolved`: add the controller-authorized,
   baseline-free branch; keep the legacy trustless branch only if a
   battle still carries baselines (back-compat); otherwise require
   controller. Regenerate bindings.
5. `BattleDetailPage`: gate the "DAY N OF N" render on
   `now < settleMs`; show a settling/overdue label otherwise. Wire
   `loadProfilesByPrincipals` for `proposer` and render via
   `getDisplayName`.
6. Repair script/step: open/resolve the known stuck battle through the
   new path after the wasm upgrade; verify it lands `resolved` with
   plausible scores.
7. Update `docs/ai/PRODUCT.md` §"Battles".

## Acceptance criteria

- [ ] A league battle with no `baselineA/baselineB`, past `settleMs`,
      resolves to a real window-true result (no "missing baselines"
      throw, no infinite "Finalizing…").
- [ ] The known stuck battle is `resolved` on mainnet with scores derived
      from settled calls in `[2026-06-08, 2026-06-15)`.
- [ ] A current (post-baseline) battle resolves to the same number
      whether or not members synced inside the window (sync-timing no
      longer affects the count).
- [ ] Live standings and the resolved result are produced by one shared
      computation.
- [ ] A past-`settleMs` `in_flight` battle no longer shows "DAY N OF N";
      it shows a settling/overdue state.
- [ ] Proposer renders as a handle, falling back to the shortened
      principal when no profile exists.
- [ ] The resolve write is rejected for a non-controller on the
      history-basis path; accepted for a controller.
- [ ] `PRODUCT.md` §"Battles" matches the shipped model; the trustless
      and snapshot-delta claims are corrected.
- [ ] `npm run quality` + `npm run check` pass; regenerated satellite
      bindings committed.

## Open questions

- **"A call" definition.** Confirm a "settled call" for accuracy =
  one settled position per series per principal (matching how
  `calculateAndSyncStats` counts `isSettledEvent`), not per fill, so
  multiple fills on one market count once. (Moot under leaderboard
  option B below, which counts settlements server-side.)

## Findings (gates the build)

The per-principal settled-call source was investigated against the
clearing canister's full query surface (`src/declarations/clearing/clearing.did`):

- `get_trade_history () -> vec Event query`: **caller-scoped**, own
  events only, no principal argument.
- `list_leaderboard (ListLeaderboardParams) -> LeaderboardPage query`:
  returns per-principal `win_count` / `settled_count` (i.e. exactly the
  battle accuracy) with a `members: opt vec principal` filter (a league
  set, capped 10k), **but only over fixed calendar windows**
  `LeaderboardWindow = { Week | Month | AllTime }`, not a rolling
  `[kickoffMs, settleMs)` span.
- `list_series_trade_history`: market-wide **fills** per series, not
  per-principal settlements.

**There is no query for an arbitrary principal's settled calls over an
arbitrary window.** So the spec's chosen "settled-call history over the
battle window" is not implementable on current APIs for the
7/14/30-day rolling windows battles use today.

## Pending decisions

The findings reopen the resolution-basis decision. Owner must pick:

- **A: Add an icdc-core query.** Extend the clearing canister with a
  per-member settled query over an arbitrary `[from, to]` window
  (timestamps already exist on settlement events). Cross-repo backend
  change (separate `icdc-core` PR, its own `AGENTS.md`), then wire here.
  Implements the spec as written, trustless on the engine side.
- **B: Calendar-align battle windows + `list_leaderboard`.** Make
  battles run over an ISO week / calendar month so
  `list_leaderboard(members, window)` resolves them exactly, live, and
  trustlessly server-side, strictly better than baseline-delta, no
  satellite trust regression. Product redesign of battle durations /
  "accept starts the clock".
- **C: Keep baseline-delta for new battles; void legacy.** Smallest:
  current battles keep today's counter-delta; baseline-less legacy rows
  resolve to a no-contest draw. The sync-timing correctness gap (#2)
  stays. No engine change.

Until this is decided the build cannot proceed; the four product calls
below stand only for the parts they still touch (UI #4, proposer #5).

## Decisions

- **Resolution basis = settled-call history** (over keeping counter-delta
  - only voiding legacy). Chosen in session to fix the legacy stuck
    battles **and** the documented sync-timing approximation in one path.
    **Reopened** by the Findings above: no API serves arbitrary-window
    per-principal settlements, so realising this basis now requires
    decision A or B under Pending decisions.
- **Membership rule = member at call time** (`joinedAtMs <= call.ts`),
  over current-members or members-at-kickoff. Most faithful to "who was
  representing the league when the call settled."
- **Overdue UI = show settling/overdue**, not the clamped day counter.
- **Proposer = resolved handle** with shortened-principal fallback.
