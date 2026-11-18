# Spec: Worlds standings reflect current opted-in members only

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1068)

## Goal

Make the Worlds Universities standings (Arena → Worlds → Schools)
reflect **only the current, opted-in roster** of each school/country
on the **live** windows (all-time and the current month) so leaving
(or opting out via `worldsOptIn`) instantly subtracts a member's past
contribution. Today a member's contribution is an append-only,
forward-only aggregate that can never be retracted: once you pump a
school's numbers you can wait out the 90-day lock, leave, and the
school keeps your wins/calls forever. The fix removes the append-only
aggregate and derives the live windows by recomputing over the
affiliation's present roster.

A **closed** month (its podium ranking and the championship cup it
confers) is instead **frozen at close**: the first time anyone claims
that month's podium, the ranking is computed once over the
then-current opted-in roster and written to an immutable, controller-
owned snapshot. Awards and cups are then stable: a later leave does
not rewrite a month that has already ended (the 90-day lock means a
pump-then-leave already spans multiple months, so almost no
anti-exploit value is lost). See [Decisions](#decisions) for why
frozen-at-close won over fully-live.

## Context

The Worlds standings have **two** contribution paths today, only one
of which is already correct:

- **All-time window: already roster-derived (PR #884).**
  `aggregateMembersLifetime` in
  [`cohort.services.ts`](../../../../src/satellite/services/cohort.services.ts)
  sums each _current_ member's profile lifetime (`totalTrades` +
  derived wins from `winRate`) per affiliation. `listAffiliationStatsFn`
  and `getAffiliationStatsFn` read all-time from it. Leaving already
  subtracts your lifetime here. **It does not yet honor `worldsOptIn`.**

- **Monthly / season window: append-only, the broken path.** The
  hook `onProfileSetForAffiliationStats` in
  [`affiliation-stats.services.ts`](../../../../src/satellite/services/affiliation-stats.services.ts)
  increments a shared `AFFILIATION_STATS` doc
  (`${kind}/${affiliationIdentifier}`) whenever a member's profile
  `totalTrades` advances, and freezes a write-once monthly
  **snapshot** (`${kind}/${affiliationIdentifier}/${monthAnchor}`) on
  lazy month rollover. `assertSetAffiliationStats` enforces
  forward-only counters (lifetime/month totals can never decrease;
  snapshots are write-once). These docs feed the monthly column of
  `listAffiliationStatsFn` / `getAffiliationStatsFn`, the closed-month
  podium (`listAffiliationStatsForMonthFn` →
  [`vxp-worlds-podium.services.ts`](../../../../src/satellite/services/vxp-worlds-podium.services.ts)),
  and championship history (`listAffiliationChampionshipsFn`). Nothing
  ever subtracts a member's monthly contribution: `assertDeleteAffiliation`
  deletes only the membership row after the lock.

**Resulting exploits** (all live against the monthly/podium/championship
surfaces; the all-time window is already immune post-#884):

1. Pump school A → wait out the 90-day lock → leave. A keeps your
   monthly + frozen-snapshot credit forever.
2. Sequentially pump A, leave; pump B, leave: every school retains
   the credit.
3. `worldsOptIn` (see below) can only gate _future_ contribution under
   the current model; it cannot subtract the past.

**The opt-out flag exists but is unenforced.** `worldsOptIn` lives on
`profile.preferences.sharing.worldsOptIn`
([`preferences.ts`](../../../../src/lib/types/preferences.ts), default
`true`, opt-out), surfaced in
[`SettingsPage.svelte`](../../../../src/lib/components/pages/SettingsPage.svelte).
Its doc comment states server-side enforcement is "a separate
follow-up." A sibling effort
(`feat-sharing-opt-out-enforcement`, tracked separately) covers the
**global leaderboard** opt-out; this spec owns the **Worlds**
opt-out, because the Worlds aggregation point is the only place that
can apply it.

**The reuse anchor that collapses the hard part.** The monthly podium
cannot move to live recompute over _profiles_, because profiles store
only lifetime totals: no per-month deltas. But the repo already has a
per-member-per-month store:
[`USER_MONTHLY_STATS`](../../../../src/lib/types/user-monthly-stats.ts)
holds one `${owner}/${YYYY-MM}` doc per user-month with
`{ monthCalls, monthWins, monthConsensus, updatedAtMs }`, written
client-side by `syncMyMonthlyStats`
([`user-monthly-stats.services.ts`](../../../../src/lib/services/user-monthly-stats.services.ts))
from the user's **real clearing history** on every
`calculateAndSyncStats` run, for the current **and** prior month, and
guarded by `assertSetUserMonthlyStats` (own-row, structural sanity).
This is exactly the per-member-per-month delta the monthly Worlds
window needs. It already exists and is already populated; the monthly
window can be recomputed from it the same way `aggregateMembersLifetime`
recomputes all-time from profiles.

Relevant constants (cite, don't restate; see
[vxp-economy.constants.ts](../../../../src/lib/constants/vxp-economy.constants.ts)
and [affiliation-stats.ts](../../../../src/lib/types/affiliation-stats.ts)):
`VXP_WORLDS_PODIUM` (400/200/100), `MIN_CALLS_FOR_RANK` (affiliation
depth floor), `AFFILIATION_LOCK_MS` (90d), `MONTHLY_MIN_CALLS` (per-user
floor on `USER_MONTHLY_STATS`).

Endpoints affected, all registered in
[`satellite/index.ts`](../../../../src/satellite/index.ts):
`getAffiliationStats`, `listAffiliationStats`,
`listAffiliationStatsForMonth`, `listAffiliationChampionships`,
`claimWorldsPodiumPrize`.

## Scope

Replace the append-only monthly path with roster-recompute for the
live windows, freeze closed months at first claim, and apply the
`worldsOptIn` opt-out at every Worlds aggregation point. **The wire
shapes of all affected endpoints are unchanged**: only the internal
data source changes, so there is no `.did`/bindings regen (see
Technical requirements → Upgrade). The `AFFILIATION_STATS` collection
is **kept** but repurposed: it now holds only immutable frozen monthly
snapshots (`${kind}/${affiliationIdentifier}/${monthAnchor}`, 3-segment
keys), written by the podium-claim path as a controller. Its write
rule flips from `public` to `controllers`.

1. **New monthly aggregator** in `cohort.services.ts`:
   `aggregateMembersForMonth({ kind, monthAnchor, affiliationIdentifier? })`,
   the monthly mirror of `aggregateMembersLifetime`. It buckets, per
   affiliation, the sum of each **current, opted-in** member's
   `USER_MONTHLY_STATS[${member}/${monthAnchor}]` `monthCalls` /
   `monthWins`. Pure read helper (no writes), so it is reusable from
   both query and update contexts.

2. **Opt-out filter** applied in **both** aggregators: a member whose
   decoded profile has `preferences.sharing.worldsOptIn === false` is
   excluded from every bucket (all-time and monthly). Missing/legacy
   profiles default to included (opt-out defaults to `true` = shown).
   Closes the gap the all-time path (#884) left open.

3. **Live windows (recompute over current roster):**
   - `listAffiliationStatsFn` (leaderboard): all-time ranking base from
     `aggregateMembersLifetime` (opt-out filtered), current-month column
     from `aggregateMembersForMonth({ kind, monthAnchor: currentAnchor })`.
   - `getAffiliationStatsFn` (detail): same, scoped to one
     `affiliationIdentifier`.

4. **Closed windows (frozen snapshot, live fallback until frozen):**
   - `listAffiliationStatsForMonthFn({ kind, monthAnchor })`: return
     the frozen snapshot docs for that month if any exist; otherwise
     live-recompute from `aggregateMembersForMonth` as a **provisional**
     view. Ranking, tie-break (`compareAffiliationRank`), and the
     `MIN_CALLS_FOR_RANK` floor are unchanged.
   - `listAffiliationChampionshipsFn`: reads the frozen snapshots (a
     month confers a cup only once it has been frozen, i.e. claimed).

5. **Freeze-on-claim** in `vxp-worlds-podium.services.ts`
   (`claimWorldsPodiumPrizeFn`): before ranking, if no frozen snapshot
   exists for `(kind, monthAnchor)`, compute
   `aggregateMembersForMonth` over the current opted-in roster and
   write one immutable snapshot doc **as controller**
   (`getAdminAccessKeys()[0]?.[0]`) per affiliation clearing
   `MIN_CALLS_FOR_RANK`, then rank the frozen rows to find top-3. First
   claimant freezes; every later claim + every display read reads the
   same frozen ranking, so placements can't drift between claimants.
   The award doc stays write-once / idempotent; a member who has left
   or opted out before the freeze is simply absent from the snapshot.

6. **Rewrite `assertSetAffiliationStats`** to guard the repurposed
   collection: accept only 3-segment snapshot keys, enforce write-once
   (reject any overwrite of an existing snapshot) and the
   `wins ≤ totalCalls` / non-negative sanity invariants. The
   membership/forward-only checks are dropped (writes are now
   controller-only and immutable).

7. **Delete the append-only writer:** remove
   `onProfileSetForAffiliationStats` and its registration in
   `onProfileSetComposed`. Nothing increments a rolling doc anymore.

### Out of scope

- **Removing the `AFFILIATION_STATS` collection.** It is retained for
  the frozen snapshots (repurposed, not dropped).
- **Server-side re-verification of `USER_MONTHLY_STATS` against
  clearing history** (see Security + Pending decisions).
- **The global-leaderboard `worldsOptIn`/`leaderboardOptIn`
  enforcement**: owned by `feat-sharing-opt-out-enforcement`. This
  spec only enforces `worldsOptIn` on Worlds surfaces.
- **Backfilling historical months** that predate `USER_MONTHLY_STATS`
  population (see Pending decisions).

## Linked issues

No open issue tracks this exploit in the repository at authoring time;
search of open issues found none for "worlds", "affiliation", or
"leaderboard retraction". If one is filed before the PR opens, link it
as `Closes #N` in the PR body (no em-dash after the number). This spec
is the originating record otherwise.

## Analytics

The change is a server-side integrity rework with no new user-facing
surface, so it warrants **no new analytics events**. The two relevant
user actions are already instrumented:
`affiliation_removed` (a leave, the moment contribution is retracted)
and `affiliation_set`, both in
[`analytics-event.ts`](../../../../src/lib/types/analytics-event.ts).
The `worldsOptIn` toggle lives in Settings; if the sibling opt-out
spec adds a privacy-toggle event, this spec does not duplicate it.
No event is added here; the existing pair already captures the
behaviour that drives a roster change.

## Technical requirements (satellite / backend, mandatory)

**Performance.**

- _Hook removal is a net win._ `onProfileSetForAffiliationStats` fires
  on **every** profile write and today does one `AFFILIATION_STATS`-
  adjacent `listDocsStore(AFFILIATIONS)` scan + up to 2 `getDocStore`
  - up to 4 `setDocStore` under the **update** instruction budget.
    Deleting it removes that cost from the hot profile-write path.
    `USER_MONTHLY_STATS` writes already happen independently in
    `syncMyMonthlyStats`, so no write cost moves elsewhere.
- _Reads move to query budget._ The new aggregator runs inside
  read-only `defineQuery` endpoints (IC query instruction ceiling,
  ~5B, far above the update ceiling). Cost per monthly leaderboard
  read: one `listDocsStore(AFFILIATIONS)` scan + one
  `listDocsStore(USER_MONTHLY_STATS)` scan (filtered by `/${anchor}`
  suffix, the same shape `getMonthlyLeaderboardFn` already uses) +
  one `getDocStore(PROFILES)` per member of the kind for the opt-out
  read. This matches the established cost of the all-time path
  (`aggregateMembersLifetime` already reads one profile per member);
  the monthly path adds a single collection scan, not an extra
  per-member round-trip.
- _The whole-kind recompute happens once per month, at freeze._
  `claimWorldsPodiumPrize` is a `defineUpdate`. The **first** claimant
  of a closed month pays the whole-kind recompute (two full scans +
  per-member profile reads) plus the snapshot writes, under the tighter
  **update** instruction ceiling; this is frozen-at-close, chosen
  precisely so the cost is paid once rather than on every claim. Every
  later claim and every display read of that month is a cheap frozen-
  snapshot scan (`listDocsStore(AFFILIATION_STATS)` filtered by the
  `/${monthAnchor}` suffix), no roster recompute. The freeze bounds its
  writes to affiliations clearing `MIN_CALLS_FOR_RANK` (only rows that
  can rank/appear), so the write count is small, not one per
  affiliation. The freeze is all-or-nothing per month: a
  `hasFrozenMonthlySnapshot` gate means the **first** claim writes the
  whole ranked set and every later claim leaves it untouched, so the
  frozen ranking never grows or drifts as the roster later churns
  (choosing this over per-doc idempotent writes, which would let the
  frozen set grow between claims on the common roster-changed path).
  Edge: if a first claim traps mid-freeze it awards nothing (the whole
  update rolls back, never paying against a partial ranking), but the
  partial snapshots it wrote make the month look frozen to the gate, a
  rare trap-only case that leaves an incomplete month; acceptable at
  realistic ranked-affiliation counts and recoverable by an admin
  re-freeze. A reverse-index would raise the trap ceiling (Scalability).

**Memory & storage.**

- _No new collection._ `USER_MONTHLY_STATS` already exists and is
  already written; this spec only _reads_ it. `AFFILIATION_STATS` is
  reused for frozen snapshots only; its old rolling (2-segment) docs
  stop being written and are ignored by the new readers (harmless dead
  data).
- _Frozen-snapshot growth._ One immutable snapshot doc per ranked
  affiliation (≥ `MIN_CALLS_FOR_RANK`) per closed month per kind,
  bounded by the small count of ranked affiliations, written once at
  first claim. Universities + countries × a handful of ranked slots ×
  months: negligible.
- _Growth (source)._ `USER_MONTHLY_STATS` grows at one doc per active
  user per month they trade (`syncMyMonthlyStats` skips empty months);
  ~10k docs/month at 10k active users, unchanged by this spec (the FE
  already writes them). These rows must be retained for at least the
  claim window of the month they cover; long-tail retention is a
  follow-up (the frozen snapshot preserves the closed-month ranking
  independently, so pruning old user-months does not rewrite history).

**Scalability.**

- The aggregators are O(roster) per kind: bounded by total affiliated
  members, not by markets. At 10×/100× membership the per-read cost
  scales linearly, identical to the already-shipped all-time path.
- Two full collection scans per monthly read (`AFFILIATIONS` +
  `USER_MONTHLY_STATS`) are the dominant term. If membership grows
  past the point where a per-read full scan is too costly, the
  optimization is a reverse-index `affiliationIdentifier → members`
  doc; out of scope here (the all-time path accepts the same scan
  today). Note any such cap explicitly rather than silently sampling.

**Upgrade & compatibility.**

- **Bindings-neutral, non-breaking.** Every affected endpoint keeps
  its current request/response schema (`AffiliationStatsWireSchema` et
  al.), only the handler's data source changes, so **no `npm run did`
  regen is required** and `src/declarations/**` stays byte-identical.
  Still rebuild the functions bundle (`npm run juno:functions:build`);
  no Candid surface change.
- **One collection-rule change:** `AFFILIATION_STATS` write flips
  `public → controllers` in [`juno.config.ts`](../../../../juno.config.ts).
  This is an access-rule change applied on satellite upgrade, not a
  schema/bindings change; existing docs are untouched. Mirrors the
  `RESOLVED_RESULTS` / `SCHOOLS` / `EVENTS` posture (controllers-write,
  server is the sole writer via the privileged `*DocStore` APIs).
- No breaking-change block or `!` title: wire and data are compatible.

**Security.**

- _Collection rules._ `AFFILIATION_STATS` becomes controllers-write, so
  a client can no longer write any stats doc directly. The freeze
  writes snapshots as a controller (`getAdminAccessKeys()[0]?.[0]`)
  with values from the server's own recompute; a user cannot forge a
  frozen ranking. `assertSetAffiliationStats` stays as defence in depth:
  snapshot-key-shape + write-once (immutable history) + `monthAnchor`
  format + finite non-negative-integer counters + `wins ≤ totalCalls`
  on both windows. The freeze also **fails closed**: with no controller
  key it throws rather than paying the podium against an unfrozen (live,
  drift-prone) ranking. `assertSetUserMonthlyStats` (own-row) continues
  to guard the source collection.
- _Residual trust surface: the central risk._ The podium pays VXP
  (`VXP_WORLDS_PODIUM`). The frozen ranking is computed from
  `USER_MONTHLY_STATS`, which is member-written. Those docs are derived
  from the clearing canister's settled events (`syncMyMonthlyStats`
  buckets real history), but `assertSetUserMonthlyStats` does **not**
  re-verify the counters against clearing; a tampered client could
  inflate its own `monthCalls`/`monthWins` to push its affiliation onto
  the podium and trigger payouts to its members. Freezing does not
  remove this (it snapshots whatever the aggregation says); it only
  makes the result immutable and controller-owned once set. The
  pre-existing monthly path had the same root weakness (the hook
  trusted profile-reported `totalTrades`/`winRate`), so this is not a
  _new_ class of trust, but it gates a VXP payout directly. Mitigations
  in place: the `MIN_CALLS_FOR_RANK` depth floor, the per-user
  `MONTHLY_MIN_CALLS` floor, and the bounded blast radius (inflating
  helps the _affiliation_, which must still out-rank others by
  accuracy). Full server-side re-derivation from `RESOLVED_RESULTS` is
  the heavier fix, deferred (Pending decisions).

**Parameters.** Reuse the existing constants cited in Context; add no
new tunables. The depth floor stays `MIN_CALLS_FOR_RANK`.

## Implementation outline

1. In `cohort.services.ts`, add a shared `worldsOptIn` reader:
   decode the profile slice already read by the aggregators and treat
   `preferences?.sharing?.worldsOptIn === false` as opted-out
   (anything else, incl. missing, = included).
2. Add `aggregateMembersForMonth({ kind, monthAnchor, affiliationIdentifier? })`:
   - `listDocsStore(USER_MONTHLY_STATS)`, filter keys ending
     `/${monthAnchor}`, decode to a `Map<owner, { monthCalls, monthWins }>`
     using the per-owner field names from `UserMonthlyStatsDoc` (mirror
     `getMonthlyLeaderboardFn`'s suffix scan).
   - `listDocsStore(AFFILIATIONS)`, filter to the kind (and optional
     `affiliationIdentifier`); for each member read their profile
     (`getDocStore(PROFILES, member)`), drop if opted-out, else fold
     the owner's `monthCalls` / `monthWins` into the affiliation's
     accumulator. Accumulator uses `AffiliationStatsDoc` monthly names
     `{ monthTotalCalls, monthWins }` (`monthCalls → monthTotalCalls`).
   - Return `Map<affiliationIdentifier, { monthTotalCalls, monthWins }>`.
     Pure read (no writes) so both query and update paths can call it.
3. Add the opt-out check to `aggregateMembersLifetime` (one decoded
   field on the profile it already reads; no extra read).
4. Live windows: `listAffiliationStatsFn` + `getAffiliationStatsFn`
   fill the monthly column from
   `aggregateMembersForMonth({ kind, monthAnchor: currentAnchor, … })`;
   all-time ranking base stays `aggregateMembersLifetime`.
5. Closed windows: `listAffiliationStatsForMonthFn` returns the frozen
   snapshot docs for the month when any exist, else live-recomputes via
   `aggregateMembersForMonth` (provisional). `listAffiliationChampionshipsFn`
   keeps reading the frozen snapshot docs (unchanged shape). Retire the
   rolling-doc reads (2-segment keys) from both.
6. Freeze in `vxp-worlds-podium.services.ts`: add
   `freezeMonthlySnapshotsIfNeeded({ kind, monthAnchor, nowMs })`;
   if no snapshot exists for the month, `aggregateMembersForMonth`,
   then for each affiliation ≥ `MIN_CALLS_FOR_RANK` `getDocStore` the
   snapshot key and, when absent, `setDocStore` it as controller
   (`getAdminAccessKeys()[0]?.[0]`), building an `AffiliationStatsDoc`
   (lifetime fields mirror the monthly ones for a frozen row).
   `claimWorldsPodiumPrizeFn` calls it before reading
   `listAffiliationStatsForMonthFn` for the top-3.
7. Rewrite `assertSetAffiliationStats` (in `affiliation-stats.services.ts`):
   snapshot-key-only + write-once + `wins ≤ totalCalls` / non-negative;
   drop the membership and forward-only logic. Delete
   `onProfileSetForAffiliationStats` and drop it from
   `onProfileSetComposed` in `satellite/index.ts`. Remove the now-unused
   rolling-key helper (`affiliationStatsKey`) if nothing references it;
   keep `affiliationStatsSnapshotKey` + `monthAnchorFromMs`.
8. Flip `AFFILIATION_STATS` write to `controllers` in `juno.config.ts`.
9. `npm run juno:functions:build` (confirm `src/declarations/**` is
   unchanged), then `npm run quality` + `npm run check`.
10. Update [`PRODUCT.md`](../../PRODUCT.md): the live Worlds windows
    reflect the current opted-in roster (leaving / opting out retracts);
    a closed month's podium + cup freeze at first claim.

## Acceptance criteria

- [ ] On the **live** windows (all-time + current month), a member who
      leaves (after the lock) or sets `worldsOptIn = false` no longer
      appears in or contributes to the school's standing on the next read.
- [ ] The current-month Worlds column for affiliation X equals the sum
      of `USER_MONTHLY_STATS[member/currentAnchor]` over X's current
      opted-in roster, gated by `MIN_CALLS_FOR_RANK`.
- [ ] A closed month's podium ranking is frozen at first claim: the
      first `claimWorldsPodiumPrize` writes controller-owned, write-once
      snapshot docs; later claims and display reads use the same frozen
      ranking (no drift). A member absent (left/opted-out) at freeze
      time is excluded; a leave **after** freeze does not change that
      month.
- [ ] `claimWorldsPodiumPrize` award docs remain write-once/idempotent;
      a member not on the frozen top-3 is `notEligible`.
- [ ] `onProfileSetForAffiliationStats` is deleted; a profile write no
      longer touches `AFFILIATION_STATS`. `AFFILIATION_STATS` is
      controllers-write; only the freeze (as controller) writes it.
- [ ] No `.did`/bindings change: `src/declarations/**` is unchanged
      after `juno:functions:build`.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- Does `USER_MONTHLY_STATS` have sufficient coverage for the _current_
  closed-month podium claim window? `syncMyMonthlyStats` writes the
  current + prior month on every sync, so an honest user who syncs in
  the first days of month N+1 has month N populated. Confirm that the
  FE podium-claim flow triggers a sync before claiming (so a returning
  user's prior-month doc exists at claim time), or that the typical
  monthly sync cadence makes this reliable.

## Pending decisions

- **Pre-`USER_MONTHLY_STATS` historical months.** Months that closed
  before `USER_MONTHLY_STATS` was populated show reduced/no monthly
  data when first frozen (their old rolling docs are abandoned). Accept
  as historical (those podiums are long claimed), or one-time backfill?
  Recommend accept: no backfill.
- **Server-side verification of monthly counters against
  `RESOLVED_RESULTS`.** Given the podium pays VXP, decide whether to
  re-derive `monthCalls`/`monthWins` server-side rather than trust the
  member-written doc. Heavier; recommend deferring to a follow-up and
  shipping with the existing floors as mitigation.

## Decisions

- **Closed months freeze at close; live windows recompute.** Chosen
  over fully-live. A VXP podium payout and a championship cup are
  records of _that month_; fully-live would let a school lose a cup it
  already won (or shift a placement between two claimants) months later
  as members churn, which is worse UX than the exploit it prevents. The
  live board + all-time already retract on leave (the surface users see
  most), and the 90-day lock means a pump-then-leave already spans
  multiple months, so freezing only the closed months forfeits almost
  no anti-exploit value. It is also cheaper and safer on the paid path:
  the whole-kind recompute runs **once** at freeze, not on every claim,
  and immutability removes cross-claimant drift. Cost: one write-once
  snapshot doc per ranked affiliation per closed month (negligible),
  reusing the existing 3-segment snapshot shape and readers.
- **Reuse `USER_MONTHLY_STATS` rather than introduce a per-affiliation
  contribution ledger.** A new ledger that the leave/opt-out path
  actively decrements was considered and rejected: it fights the
  existing write-once invariants (you would have to mutate frozen
  snapshots to subtract), adds a collection, and needs a migration for
  baked-in totals. `USER_MONTHLY_STATS` already holds the
  per-member-per-month deltas, derived from real clearing history, with
  an own-row assert, so read-time roster-recompute (the same shape
  #884 used for all-time) closes the exploit with no new storage and no
  bindings change.
- **Aggregate at read time, delete the write-time hook.** Moving the
  live windows to read-time recompute is what makes retraction
  automatic (leave = not in the roster scan; opt-out = filtered) and
  removes the append-only writer that caused the bug. The one write
  that remains, the closed-month freeze, is controller-owned and
  immutable, so it can't be forged or pumped.
- **Freeze is controller-written from the server's own recompute.**
  `AFFILIATION_STATS` flips to controllers-write so a client can't
  forge a frozen ranking; the freeze runs inside the podium-claim
  update and writes as admin. Same posture as `RESOLVED_RESULTS` /
  `SCHOOLS` / `EVENTS`.
