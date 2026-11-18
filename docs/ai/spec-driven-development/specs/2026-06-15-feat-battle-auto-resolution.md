# Spec: Battles resolve themselves from real league accuracy

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#912)

## Goal

A league battle is an **accuracy face-off**: over a fixed window, the
two leagues compete on how accurate their members' predictions are. The
winner must be **derived from real data, automatically**: no human
types a score. Today the opposite is true: the resolve step
(`ResolveBattleModal.svelte`) makes a league owner hand-enter both
sides' scores, and the satellite only checks that the typed `winner`
matches the typed numbers. An owner can type any scores and win their
own battle. This spec makes resolution compute each league's windowed
accuracy from the satellite's own monotonic stat counters, removes the
manual score entry entirely, and pins down the full battle dynamic
around it: which league may challenge which (by privacy), which leagues
surface in challenge search, and what a privacy change does to a battle
in flight.

## Context

Battle domain and state machine:

- `src/lib/types/battle.ts`: `BattleDoc`, `BattleState`
  (`proposed → accepted → in_flight → resolved`, forward-only),
  `BattleScope` (`'all'` | `MarketTag`), `BattleWinner`.
- `src/satellite/services/battle.services.ts`: `assertSetBattle`
  (the "BE-6" guard) and `assertDeleteBattle`. Per-transition auth +
  the current `winner === scoreA>scoreB` arithmetic check
  (lines 250-267).
- `src/lib/services/leagues.services.ts`: battle FE services:
  `proposeBattle` (767-837), `acceptBattle` (848-853),
  `kickoffBattle` (855-860), `resolveBattle` (891-905, manual scores),
  `retractBattle`, `writeBattleTransition` (907-931),
  `listLeagueBattles`, `listMyBattles`, `getMyBattleStats`,
  `listChallengeableLeagues` (128-132, opponent pool).
- `src/lib/components/leagues/ResolveBattleModal.svelte`: the manual
  score modal (to be deleted).
- `src/lib/components/pages/BattleDetailPage.svelte`: `canKickoff` /
  `canResolve` CTAs; `src/lib/components/pages/BattlesInboxPage.svelte`:
  cross-league inbox; `src/lib/components/leagues/CreateBoutModal.svelte`:
  proposal wizard (opponent picker).

League privacy + stats:

- `src/lib/enums/league.ts`: `LeaguePrivacy` (`PRIVATE` / `INVITE` /
  `OPEN`); `src/lib/types/league.ts`: `leaguePrivacy`,
  `isLeaguePubliclyListed` (OPEN only), `isLeagueRecommendableToFriends`.
- `src/satellite/services/league-stats.services.ts`:
  `assertSetLeagueStats`, `onProfileSetForLeagueStats` (the lifetime
  counter hook, currently sourced from the lossy profile `winRate`),
  `incrementLeagueStats`, `getLeagueStatsFn`.
- `src/lib/types/league-stats.ts`: `LeagueStatsDoc`
  (`leagueId`, `totalCalls`, `wins`, `updatedAtMs`).
- `src/lib/types/user-stats.ts`: `UserStatsDoc.categoryStats`
  (`Record<tag, {calls, wins}>`) and `RecentSettlementSnapshot`. This
  is the **exact** per-category source we switch the league-stats hook
  to read from.
- `src/lib/utils/league-rank.utils.ts` + PRODUCT.md "League rank":
  the canonical "accuracy-first, no minimum-calls floor" ranking the
  battle score must agree with.

Satellite wiring: `src/satellite/index.ts`: assert/hook dispatch
tables, `defineUpdate`/`defineQuery` endpoints. Collections:
`src/lib/constants/collections.constants.ts` + `juno.config.ts`
(`battles`, `league_stats`, `league_members` rules).

Reused patterns: snapshot-at-start / delta-at-end is exactly how the
monthly tournament computes windowed accuracy from `league_stats`
(documented in `league-stats.ts` lines 8-12): battles adopt the same
mechanism per-battle.

## Scope

### The corrected battle dynamic

**1. Challenge eligibility (who may challenge whom).** A league owner
may propose a battle where `sideA` is a league they own and `sideB`
is **either an OPEN league or a league the caller is already a member
of**. Enforced server-side in `assertSetBattle` (creation path), not
just filtered in the FE list. (Today the assert only checks the caller
owns `sideA`.)

**2. Challenge search.** Only OPEN leagues are discoverable as
opponents. `listChallengeableLeagues` already returns OPEN leagues plus
the caller's memberships minus owned leagues: confirm it matches the
eligibility rule above and add a name filter / search affordance in
`CreateBoutModal` if not already present.

**3. Privacy change is discovery-only.** Privacy governs who can find
and challenge a league. A battle, once `proposed` or further, has its
identity frozen and proceeds to resolution regardless of later privacy
changes on either league. Tightening a league to INVITE/PRIVATE simply
drops it out of future challenge search (already the behaviour of
`listChallengeableLeagues`). No battle is auto-retracted. No new code:
documented behaviour + a PRODUCT.md note + a test asserting an
in-flight battle resolves after `sideB` flips to PRIVATE.

**4. Kickoff stamps a baseline.** On the `accepted → in_flight`
transition (after `now >= kickoffMs`) the writer reads each side's
current `league_stats` bucket for the battle's `scope` and stamps it on
the battle as `baselineA` / `baselineB` (`{ calls, wins }`). The
**assert independently re-reads `league_stats` and rejects any baseline
that doesn't equal the current bucket**, so the snapshot is honest
regardless of who writes. Either side's owner may trigger; the FE fires
it lazily on view.

**5. Resolution computes scores, the assert verifies them.** On the
`in_flight → resolved` transition (after `now >= settleMs`) the writer
reads each side's current `league_stats` bucket for `scope`, computes
the window delta `Δ = current − baseline` (clamped `≥ 0`) per side, and:

- `accuracy = Δcalls > 0 ? round(Δwins / Δcalls × 100) : 0`
- `scoreA = accuracyA`, `scoreB = accuracyB`, `callsA/B = Δcalls`
- winner via `deriveBattleWinner`: higher accuracy wins; **tie-break** =
  more predictions (`Δcalls`) at equal accuracy; still tied → `draw`.
  Both sides `Δcalls === 0` → `draw` (a void face-off).

The `assertSetBattle` resolve branch **re-derives all of this from
`league_stats` + the doc's frozen baselines and rejects any mismatch**,
so a hand-crafted client write cannot post a false score: resolution
is trustless without a privileged endpoint. The score reflects kickoff →
resolution; the lazy auto-resolve keeps that ≈ the `[kickoffMs,
settleMs]` window (same snapshot-delta imprecision the tournament
already accepts, see `league-stats.ts`). No new `defineUpdate`
endpoint and no Candid surface change beyond three optional fields on
the battle query wire shape (`callsA`, `callsB`, `resolvedAtMs`) used
to render the resolved card and tell a real draw from a void.

**6. Manual entry removed.** Delete `ResolveBattleModal.svelte`. The
"Resolve" CTA becomes a one-tap "Resolve now" that calls the endpoint
and shows the computed outcome. Battle pages auto-resolve lazily on
mount when `state === 'in_flight' && now >= settleMs` (Juno has no
scheduler: resolution is triggered, never cron'd), so a battle settles
even if nobody clicks.

### league_stats becomes per-category

`league_stats` aggregates are scope-blind, so per-category battles can't
be scored from them. Extend the doc and re-source the hook:

- Add `categories: Record<MarketTag, { calls, wins }>` to
  `LeagueStatsDoc`. The existing `totalCalls` / `wins` stay as the
  `'all'` scope aggregate. Absent `categories` on legacy rows → empty.
- Add a second league-stats hook on **`USER_STATS` writes**
  (`onUserStatsSetForLeagueStats`), diffing `categoryStats` before/after
  for exact per-category `(Δcalls, Δwins)` (clamped `≥ 0`), fanning each
  category bucket out to the writer's leagues. The existing
  `onProfileSetForLeagueStats` keeps maintaining the `'all'` aggregate
  (`totalCalls`/`wins`) unchanged: `categoryStats` only covers **tagged**
  calls (untagged are skipped in `user-stats.services.ts`), so the
  aggregate must keep its own source or `'all'`-scope battles, the league
  leaderboard, and the tournament would silently lose untagged calls. The
  two hooks fire on separate, sequential canister messages and each does a
  synchronous read-modify-write, so there is no version race; they touch
  disjoint fields of the same doc.
- `assertSetLeagueStats` extends forward-only + `wins ≤ calls` +
  non-negative to every per-category bucket, alongside the aggregate.

A battle's `scope` selects which bucket the baseline/delta reads:
`'all'` → the aggregate; a `MarketTag` → `categories[tag]`.

### Out of scope

- **Wager settlement.** `wager` stays a displayed stake / bragging
  figure; this spec does not move VXP between leagues on resolution
  (real ledger transfers are a separate, riskier change). Tracked as a
  follow-up.
- **Duel (`kind='duel'`) auto-resolution.** Duels have no `league_stats`
  to delta. They keep the existing path for now; this spec's endpoint
  rejects `kind='duel'` and the manual modal removal does not strand
  them (duels currently surface no resolve UI). Follow-up.
- **Minimum-calls floor.** Battles inherit the leaderboard's
  no-floor accuracy-first stance (see Decisions). Not adding a
  qualification gate.
- **Backfilling `categories` on existing `league_stats`.** New buckets
  accrue going forward; historical aggregate is untouched. Acceptable
  on a staging-only deployment (no migration by default).

## Linked issues

Searched open issues: no issue tracks battle resolution. This is
self-directed product work; no closing keyword.

## Analytics

Reuse the existing battle events: `battle_proposed`, `battle_accepted`,
`battle_resolved` (already in both `src/lib/types/analytics-event.ts`
and `src/lib/schema/analytics-event.schema.ts`). **No new event names**
(a new name would force an analytics-Candid regen for no behavioural
gain). Express the new facts via existing props on `AnalyticsEventProps`
(`leagueId`, `battleId`, `source`, `label`, `value`):

- `battle_resolved`: add `source: 'auto' | 'nudge'` (lazy view-trigger
  vs. explicit "Resolve now"), `label: 'win' | 'loss' | 'draw' | 'void'`
  (outcome for the acting side; `void` = both sides zero calls),
  `value` = winning side's accuracy %. Fired once per battle (guarded by
  the idempotent endpoint returning "already resolved").
- `battle_proposed`: add `label = scope` so we can see category mix.

Bounded vocabularies only; no free-form text, no PII.

## Technical requirements (satellite / backend, mandatory)

**Performance.**

- `onUserStatsSetForLeagueStats`: fires once per `USER_STATS` write
  (i.e. per stats sync, not per render). Cost = O(user's league count)
  doc writes, same bound as the hook it replaces; per-category diffing
  adds O(tags touched) ≈ ≤ `MARKET_TAGS.length` cheap comparisons. No
  new fan-out width.
- Kickoff / resolve: the FE reads two `league_stats` docs + the battle
  doc, then one battle write. `assertSetBattle` adds two `getDocStore`
  reads (both sides' `league_stats`) on the kickoff and resolve
  branches to re-verify baselines / scores. All O(1): no member
  iteration (the per-league counter already aggregates members), so
  cost is independent of league size. This is why the counter-delta
  design is used over summing per-member `USER_STATS`.

**Memory & storage.**

- `LeagueStatsDoc.categories` adds one `{calls, wins}` pair per market
  tag a league has touched, bounded by `MARKET_TAGS.length`
  (single-digit), a few dozen bytes per league. Negligible growth.
- `BattleDoc` adds `baselineA`, `baselineB` (`{calls, wins}`),
  `callsA`, `callsB`, `resolvedAtMs`: write-once, bounded. No new
  collection, no unbounded list.

**Scalability.** At 100× leagues/members the resolution cost is
unchanged (O(1) counter reads). The hook fan-out scales with a user's
league membership count, not global league count. No N+1 over members.

**Upgrade & compatibility.**

- `LeagueStatsDoc` and `BattleDoc` gain optional fields: additive,
  backward-compatible; legacy rows read with absent buckets/baselines.
- No new `defineUpdate` endpoint. The only Candid surface change is
  three optional fields (`callsA`, `callsB`, `resolvedAtMs`) added to
  `BattleWireSchema`, regenerating `satellite.did`,
  `satellite_extension.did`, `api-schemas.ts`, and
  `src/declarations/satellite/**` via `npm run juno:functions:build`
  (committed in this PR). Additive + optional → backward-compatible,
  not flagged `!`. The FE `resolveBattle` service drops its
  `scoreA`/`scoreB` args (internal FE only).
- The doc-shape additions (`baselineA/B` etc.) are opaque blob payloads,
  not Candid: no regen needed for those. Requires a local satellite
  wasm upgrade for the new assert logic to take effect (CI build drops
  custom methods, see `reference_juno_action_drops_endpoints`);
  auto-upgrade stays off.

**Security.**

- `battles` / `league_stats` collection rules unchanged (public
  read/write at the datastore level; correctness enforced by asserts).
- `assertSetBattle`: creation path now also verifies `sideB`
  eligibility (OPEN or caller∈members). Resolve path re-derives scores
  from `league_stats` and rejects any mismatch, so even a hand-crafted
  client write cannot post a false score: the manual-tamper hole is
  closed structurally, not just by removing the modal.
- Baselines are write-once (added to the immutable-after-kickoff set).

**Parameters.** Battle scope/wager bounds stay in `battle.ts`
(`BATTLE_SCOPES`, `BATTLE_WAGER_*`). Market tags from
`market-tags.constants.ts`. No restated numbers.

## Implementation outline

Satellite:

1. `src/lib/types/league-stats.ts`: add
   `categories?: Partial<Record<MarketTag, CategoryStatsBucket>>`
   (reuse `CategoryStatsBucket` from `user-stats.ts`). Add a
   `leagueStatsBucket(doc, scope)` helper returning `{calls, wins}`
   for `'all'` (aggregate) or a tag (bucket, default zero).
2. `src/lib/types/battle.ts`: add `baselineA?`, `baselineB?`
   (`CategoryStatsBucket`), `callsA?`, `callsB?`, `resolvedAtMs?`;
   add a `deriveBattleWinner({accuracyA, accuracyB, callsA, callsB})`
   pure helper (accuracy → callsdesc → draw) shared by endpoint + assert.
3. `src/satellite/services/league-stats.services.ts`: add
   `onUserStatsSetForLeagueStats` (trigger on `USER_STATS`) maintaining
   per-category buckets via `incrementLeagueStatsCategories`; keep
   `onProfileSetForLeagueStats` for the aggregate; extend
   `assertSetLeagueStats` forward-only/sanity to every bucket.
4. `src/satellite/services/battle.services.ts`: rewrite
   `assertSetBattle`: (a) creation path adds `sideB` eligibility
   (OPEN or caller∈members); (b) `accepted → in_flight` requires
   `now >= kickoffMs` and `baselineA/B` equal to the current
   `league_stats[scope]` bucket; (c) `in_flight → resolved` requires
   `now >= settleMs`, re-derives Δ/scores/calls/winner from
   `league_stats` + the frozen baselines via `deriveBattleWinner`,
   rejecting any mismatch; (d) `baselineA/B` join the immutable-after-
   kickoff set.
5. `src/satellite/utils/wire-format.utils.ts`: add `callsA`, `callsB`,
   `resolvedAtMs` to `BattleWireSchema` + `toWireBattle`.
6. `src/satellite/index.ts`: add `USER_STATS` to `setDocCollections`
   - the dispatch table (`onUserStatsSetForLeagueStats`). No new
     endpoint. Then `npm run juno:functions:build`: commit regenerated
     bindings (wire-shape change only).

Frontend:

7. `src/lib/services/leagues.services.ts`: `kickoffBattle` reads both
   sides' `league_stats`, stamps baselines onto the freshly-read raw
   doc; `resolveBattle` (no score args) reads baselines + current
   `league_stats`, computes scores/calls/winner, writes. Both build the
   next doc from the re-read raw doc, not the stale wire projection.
   Confirm `listChallengeableLeagues` matches eligibility.
8. Delete `ResolveBattleModal.svelte`; update `BattleDetailPage` /
   `BattlesInboxPage`: "Resolve now" one-tap + lazy auto-resolve on
   mount; render computed scores as accuracy %, show draw/void copy.
9. `CreateBoutModal`: opponent search/filter over challengeable
   leagues if missing; pass `scope` through.
10. Analytics: add the `source` / `label` / `value` props at the
    resolve and propose call sites.
11. i18n: rewrite `leagues.battle.resolve.*` (drop us/them score
    labels, add auto-resolve result + draw/void + "Resolve now"
    strings) across **all 12 locales** in
    `src/lib/constants/messages/`.
12. `docs/ai/PRODUCT.md`: add a "Leagues & Battles" behaviour section
    (lifecycle, accuracy-face-off scoring, eligibility-by-privacy,
    privacy-change semantics).

Verification: the repo has no unit-test runner (CI is `format` / `lint`
/ `check` + Playwright e2e, see `docs/ai/frontend/testing.md`), so the
guarantees rest on (a) `svelte-check` over the shared pure helpers
(`deriveBattleWinner`, `battleAccuracyPct`, `leagueStatsBucket`) and
their call sites, (b) the assert's own re-derivation closing the
integrity hole structurally, and (c) a manual repro on a local satellite
upgrade documented in the PR's `# Tests` section: propose → accept →
kickoff (baseline stamped) → log predictions → resolve (auto on view),
plus the negative cases (falsified score rejected, ineligible `sideB`
rejected, in-flight battle still resolves after `sideB` goes PRIVATE).
When the first Vitest spec lands, `deriveBattleWinner`'s truth table is
the natural first unit test.

## Acceptance criteria

- [ ] Resolving a battle requires **no** human score input; scores are
      each league's windowed accuracy computed by the satellite.
- [ ] `assertSetBattle` rejects a client-written `resolved` doc whose
      scores/winner disagree with the `league_stats` delta.
- [ ] A battle auto-resolves on page view once `now >= settleMs` with
      nobody entering anything.
- [ ] `league_stats` carries per-category buckets sourced exactly from
      `USER_STATS.categoryStats` deltas; scoped battles score from the
      matching bucket, `'all'` from the aggregate.
- [ ] Proposing against a non-OPEN league the caller is not a member of
      is rejected server-side; OPEN leagues and member-of leagues are
      accepted.
- [ ] Equal accuracy resolves to the side with more predictions; both
      sides with zero windowed calls resolve to `draw`.
- [ ] A privacy tighten on either league does not retract or alter an
      existing battle; it only removes the league from challenge search.
- [ ] `ResolveBattleModal.svelte` is deleted and unreferenced.
- [ ] New/changed copy exists in all 12 locale catalogs;
      `npm run quality` and `npm run check` pass; regenerated satellite
      bindings committed.
- [ ] PRODUCT.md documents the battle dynamic.

## Decisions

- **Counter-delta over per-member sum.** Windowed accuracy is the delta
  of `league_stats`' monotonic counters between kickoff and settle. This
  is O(1) at resolution, and, because the hook accrues each settled
  call against the member's leagues _at call time_, it naturally and
  correctly attributes activity across mid-window joins/leaves, which a
  resolve-time sum of current members' lifetime `USER_STATS` would get
  wrong. Mirrors the tournament's existing snapshot-delta mechanism.
- **Score = windowed accuracy %, no floor.** The product's canonical
  league metric is accuracy-first with **no** minimum-calls gate
  (confirmed by the product owner + prototype in
  `2026-06-15-fix-league-rank-consistency.md`, documented in PRODUCT.md
  "League rank"). The battle score matches it so battles and the
  leaderboard tell the same story. Call-count (volume) was rejected as
  contradicting accuracy-first; it survives only as the equal-accuracy
  tie-break. A minimum-participation guard was considered for
  wager-gaming but deferred to stay consistent with the floor-free
  leaderboard; revisit if abuse appears.
- **Per-category buckets get their own `USER_STATS` hook; the aggregate
  keeps its profile hook.** Per-category needs a per-category source
  (`USER_STATS.categoryStats`, exact). But that source only covers
  tagged calls, so the `'all'` aggregate (also read by the leaderboard
  and tournament) must keep its existing profile-sourced counter or it
  would silently drop untagged calls. Two disjoint-field hooks on
  sequential messages (no race) beat one hook that regresses the
  aggregate.
- **Privacy is discovery-only.** Battle identity freezes at proposal;
  visibility changes must not rewrite shared competitive history. Keeps
  the model predictable and avoids a privacy-flip griefing vector
  (tighten privacy to nuke a proposal you're losing).
- **Assert re-verifies instead of trusting the endpoint.** Even with
  resolution behind an endpoint, the assert independently recomputes
  from `league_stats` so the integrity guarantee holds for _any_ writer:
  defense in depth, and the structural fix for the reported hole.
