# Spec: `resolved_results`: friend-readable per-participant resolution feed

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#988)

## Goal

Add a new satellite datastore collection, `resolved_results`, holding
**per-user, friend-readable** resolved-result rows: one row per
`(owner, market)` resolved call carrying that participant's outcome
(win/loss), side, and net VXP. The rows are written at resolution time
by the controllers-only resolution path and bulk-read friend-scoped by
the Arena Friends results digest. This is a purely additive backend
collection: it has **no visible UI** on its own: the rows are written
and readable, but nothing renders them yet.

The collection exists because there is **no friend-readable
per-participant resolved-result source today**. Clearing trade-history
is exposed caller-scoped only (you can read your **own** per-call
settlements, not a friend's), and the single `ActivityType.SETTLEMENT`
activity row is the **resolver's market-level** result ("Market
Resolved: YES"), keyed by the resolver's principal, not a
per-participant outcome. So no existing surface (clearing
trade-history nor the `activities` stream) yields a friend-readable
per-call result. `resolved_results` is that source.

## Context

**The boundary.** `resolved_results` is the additive backend data
source; the Arena Friends results digest is the FE consumer that reads
it. The two are independent: this collection writes and exposes the
rows, the digest is the only place they become visible, so the backend
has no FE coupling and stands on its own.

**The data shape that does NOT carry what the consumer needs (the gap
this fills).**
[`src/lib/types/social.ts`](../../../../src/lib/types/social.ts)
`Activity` is `{ type, user, targetUser?, marketId?, title, details?,
timestamp }`. It carries the **call** as display text only: no
resolution outcome (win/loss) and no net VXP. The single
`ActivityType.SETTLEMENT`
([`src/lib/enums/social.ts`](../../../../src/lib/enums/social.ts)) row is
logged by the **resolver** (admin), keyed by the resolver's principal,
and says "Market Resolved: YES" with `details =
JSON.stringify({ outcome, price })`
([`src/lib/services/resolution.services.ts`](../../../../src/lib/services/resolution.services.ts)
`logActivity` call), i.e. it describes the **market's** resolution, not
any individual friend's per-call result.

`ResolvedPosition`
([`src/lib/types/position.ts`](../../../../src/lib/types/position.ts):
`{ marketId, result: 'won' | 'lost' | 'neutral', realizedPnlUsd,
timestampNs, … }`) and its derived store
([`src/lib/derived/resolved-positions.derived.ts`](../../../../src/lib/derived/resolved-positions.derived.ts))
are assembled from the clearing trade-history events, which the
clearing canister exposes **caller-scoped only**: you can read your
**own** per-call settlements, not a friend's. Hence the new collection.

**The pattern to mirror: `activity_reaction_counts`.** The existing
`activity_reaction_counts` datastore collection is public-read /
controllers-write and is populated from inside a satellite hook using
`adminCaller()` + `setDocStore`. `resolved_results` mirrors that
shape exactly (see Security and the resolution-time write below), so
there is an established in-repo precedent for the controllers-write
discipline this spec relies on.

**Reuse (cite first: `docs/ai/frontend/reusability.md`).**

- The `activity_reaction_counts` collection wiring (in both
  [`juno.config.ts`](../../../../juno.config.ts) and the `Collection`
  enum in
  [`src/lib/constants/collections.constants.ts`](../../../../src/lib/constants/collections.constants.ts))
  and its `adminCaller()` + `setDocStore` controllers-write path: the
  template for `resolved_results`.
- The resolution/settlement path
  ([`src/lib/services/resolution.services.ts`](../../../../src/lib/services/resolution.services.ts):
  `settleMarket` → `settleSeriesApi` → `logActivity`): the write
  trigger.
- The named time-window constants in
  [`src/lib/constants/app.constants.ts`](../../../../src/lib/constants/app.constants.ts)
  for the retention TTL (never a literal).

## Scope

**Backend / satellite only.** No FE rendering, no FE wiring beyond the
typed `Collection` enum entry that keeps the two declaration sites in
sync.

1. **The `resolved_results` collection.** A new Juno datastore
   collection, `memory: 'stable'`, `read: 'public'`, `write:
'controllers'`, snake_case plural, consistent with `activities` /
   `activity_reaction_counts` / `league_stats`. Doc shape, one per
   `(owner, market)` resolved call:

   ```
   { owner, marketId, title, side, outcome: 'win' | 'loss',
     netVxp /* USD_DECIMALS, signed */, resolvedAtMs }
   ```

   Key `${owner}#${marketId}` so a per-owner read is a bounded
   owner-prefix scan, never N+1.

2. **Collection wiring: two places, must stay in sync** (per
   `.claude/rules/juno.md` and `docs/ai/satellite/structure.md`):
   - [`juno.config.ts`](../../../../juno.config.ts): add
     `RESOLVED_RESULTS = 'resolved_results'` to the
     `JunoDatastoreCollection` enum and a datastore entry
     `{ memory: 'stable', read: 'public', write: 'controllers' }`,
     mirroring the `activity_reaction_counts` entry.
   - [`src/lib/constants/collections.constants.ts`](../../../../src/lib/constants/collections.constants.ts):
     add the matching `RESOLVED_RESULTS` member to the `Collection`
     object with a docstring (public read; controllers write: only the
     resolution path writes it).

3. **Resolution-time write.** Write one row per **participant per
   resolved market** at resolution, via the `adminCaller()` +
   `setDocStore` controllers-write pattern (mirror
   `activity_reaction_counts`). The write fires from a satellite
   `onSetDoc` hook on the `SETTLEMENT` activity and derives every
   participant's outcome + net VXP from the clearing settlement plan
   server-side (see Decisions).

4. **Friend-scoped bulk read.** A friend-scoped read that, given a set
   of friend principals, returns their resolved-result rows over the
   active window in **one** bounded `listDocs` over the friend set,
   **not** one call per friend. Owner-prefix keying keeps it a single
   batched read. This is the surface the results digest consumes.

5. **Retention / pruning.** A periodic controllers-only cleanup that
   prunes rows older than the digest's max `StandingsWindow` horizon,
   keyed on `resolvedAtMs`. The TTL is a named constant (Parameters),
   not a literal.

6. **Regenerate bindings.** Run `npm run juno:functions:build` and
   commit the regenerated `satellite.did` / `satellite_extension.did`
   / `api-schemas.ts`.

### Out of scope

- **All FE rendering / the digest UI**: the `FriendsTab.svelte` work,
  the `FriendDigest` model, the standout-selection client logic,
  copy/i18n, the reaction, and the digest analytics all belong to the
  results digest, not this collection.
- **The W–L / net-VXP aggregate**: that is the existing
  `getLeagueStandings` clearing query (no backend change) and is
  consumed directly by the digest; it is not part of this collection.
- **Removing or altering the `activities` collection**: untouched; it
  still powers market "Recent trades", VXP onboarding counts, etc.
- **Any clearing / `../icdc-core/` change**: this lives entirely in the
  satellite, precisely to avoid the cross-repo path. No clearing `.did`
  regen is implied.

## Linked issues

No related open issue. Searched `ViciApp/vici-app` open issues
for `resolved` / `results` / `collection` / `resolution outcome` /
`friends` / `arena`: the only open Arena issue is
[#970](https://github.com/ViciApp/vici-app/issues/970)
("I see battles duplicated in Arena"), which concerns the Battles tab,
not this collection. No closing keyword.

## Analytics

**None.** This collection has no user-visible surface, so there is
nothing to instrument here: no event is emitted by the write path, the
read path, or the pruning. The digest-engagement analytics
(`friend_digest_opened`, the reused `friend_feed_reaction`) belong to
the results digest, not this collection.

## Technical requirements (satellite / backend, mandatory)

### Chosen design: `resolved_results` collection

A new Juno datastore collection holding **per-user, friend-readable**
resolved-result rows, written at resolution time, bulk-read
friend-scoped. Doc shape, one per `(owner, market)` resolved call:

```
{ owner, marketId, title, side, outcome: 'win' | 'loss',
  netVxp /* USD_DECIMALS, signed */, resolvedAtMs }
```

Key `${owner}#${marketId}` so the per-owner read is a bounded
owner-prefix scan, never N+1. (The digest selects a per-friend standout
client-side from these rows by largest `|netVxp|`, tie-break most recent
`resolvedAtMs`: that selection rule is recorded here for context but
lives in the consumer.)

### Performance

- **Write frequency.** One `set_doc` per **participant per resolved
  market**, written at resolution. Resolution is a rare admin/solver
  action (the existing `SETTLEMENT` log notes "settlements are rare"),
  so this is a bounded fan-out, not a hot path. Instruction-budget
  impact on the resolution write path is O(participants in the market)
  extra `setDocStore` calls, bounded by market size, well under the IC
  instruction cap for a normal market; a pathologically large market is
  the scalability watch item below.
- **Read.** One bounded `listDocs` over the friend set per consumer
  hydration. Owner-prefix keying keeps it a single batched read, **not**
  one call per friend.

### Memory & storage

- New `stable` collection; one small doc per (resolved call,
  participant). Doc is a handful of scalar fields (~150–250 bytes).
- **Growth is unbounded** without a cap: it accrues a row for every
  participant of every resolved market, for all time. **Retention story
  (required):** prune rows older than the digest's max `StandingsWindow`
  horizon (the read never looks past the active window), via a periodic
  controllers-only cleanup keyed on `resolvedAtMs`. The exact TTL is a
  named constant (Parameters) and a Pending decision.

### Scalability

- At 10×/100× friends, the read stays one bulk owner-prefix scan; no
  N+1. At 10×/100× markets, the resolution-time fan-out grows with
  participants-per-market: if a single market's participant count can
  exceed the per-call instruction budget, the write must page across
  multiple resolution calls (Open questions: confirm max participants
  and whether resolution already batches).

### Upgrade & compatibility

- **Additive**: a new collection plus a write at the resolution path
  and a satellite read. Regenerate `satellite.did` /
  `satellite_extension.did` / `api-schemas.ts` via
  `npm run juno:functions:build` and commit. **Not breaking** (no `!`
  title / `BREAKING CHANGE:` block needed). No clearing `.did` regen is
  implied: this lives entirely in the satellite, not `../icdc-core/`,
  precisely to avoid the cross-repo path.

### Security

- **Public read, controllers write.** Only the resolution/controller
  path writes a result, so a user cannot forge a win for themselves or a
  friend. Mirror the `activity_reaction_counts` pattern: the write runs
  inside a satellite hook using `adminCaller()` + `setDocStore`, and the
  collection's `write: 'controllers'` rule rejects any client write at
  the Datastore boundary. Reads are public; in practice the consumer
  scopes them to the caller's friend set.

### Parameters

- The retention TTL is a named constant under
  [`src/lib/constants/`](../../../../src/lib/constants/) (the time
  windows live in `app.constants.ts`), never a literal: a copied
  horizon goes stale silently. The digest `StandingsWindow` that bounds
  the read window constrains the TTL here (the cleanup horizon should not
  be shorter than the active digest window).

## Implementation outline

1. Add the `resolved_results` collection in `juno.config.ts` **and**
   `collections.constants.ts`: public-read / controllers-write,
   `memory: 'stable'`, mirroring `activity_reaction_counts`.
2. Write a row per participant at the resolution path via the
   `adminCaller()` + `setDocStore` controllers-write pattern (mirror
   `activity_reaction_counts`), keyed `${owner}#${marketId}`. The write
   fires from a satellite `onSetDoc` hook on the `SETTLEMENT` activity
   (a client `setDoc`, so the hook genuinely fires), and derives every
   participant's `{ side, outcome, netVxp }` server-side from the
   clearing `get_settlement_plan` positions (see Open questions).
3. Add the friend-scoped bulk read: one bounded `listDocs` over the
   friend set, owner-prefix keyed, no N+1.
4. Add the periodic controllers-only retention cleanup keyed on
   `resolvedAtMs`, with the TTL as a named constant under
   `src/lib/constants/`.
5. Run `npm run juno:functions:build` and commit the regenerated
   `satellite.did` / `satellite_extension.did` / `api-schemas.ts`.
6. `npm run quality` + `npm run check` + `npm run juno:functions:build`.
7. Divergence check; flip status to `Implemented (#PR)`.

## Acceptance criteria

- [ ] The `resolved_results` collection is declared in **both**
      `juno.config.ts` and `collections.constants.ts`, is public-read /
      controllers-write, `memory: 'stable'`, and is written only by the
      resolution path.
- [ ] At resolution, one row per participant is written with the
      `{ owner, marketId, title, side, outcome, netVxp, resolvedAtMs }`
      shape, keyed `${owner}#${marketId}`, via the `adminCaller()` +
      `setDocStore` controllers-write pattern.
- [ ] A client write to the collection is rejected at the Datastore
      boundary (controllers-write rule), so a user cannot forge a result.
- [ ] The friend-scoped read returns a friend set's rows over the active
      window in **one** bounded `listDocs` (owner-prefix scan), not one
      call per friend.
- [ ] Rows older than the retention horizon are pruned by the periodic
      controllers-only cleanup keyed on `resolvedAtMs`; the TTL is a
      named constant under `src/lib/constants/`, not a literal.
- [ ] The collection has **no** user-visible surface in this PR (nothing
      renders the rows yet: that is the results digest).
- [ ] `npm run quality` and `npm run check` pass, plus
      `npm run juno:functions:build` with the regenerated `satellite.did`
      / `satellite_extension.did` / `api-schemas.ts` committed.

## Open questions

- **Maximum participants per market vs. the per-resolution instruction
  budget.** The write fan-out is O(participants); the realistic max
  market size and whether clearing already batches settlement page the
  write if a single market's participant count can exceed the per-call
  budget (Scalability). Current markets are well under that bound, so the
  single-pass fan-out ships; paging is the watch item if a market grows
  pathologically large.

## Pending decisions

- **Which `StandingsWindow` bounds the read / retention**: `'week'` vs
  `'month'` (vs `'all'`). The retention TTL must not be shorter than the
  active digest window; until the digest fixes its window, the TTL is
  sized to the longest bounded window (`'month'`) plus a grace margin, so
  a later choice of `'week'` or `'month'` stays within the horizon.

## Decisions

- **The write fires from a satellite hook on the `SETTLEMENT` activity
  (2026-06-25).** Settlement is FE-initiated (`settleMarket` →
  `settleSeriesApi` → `logActivity`), and `logActivity` is a client
  `setDoc` to `activities`, so an `onSetDoc` hook on that collection
  genuinely fires (a serverless `setDocStore` would not). The hook
  (`onActivitySetForResolvedResults`) writes the rows controllers-write
  via `adminCaller()` + `setDocStore`, mirroring
  `activity_reaction_counts`: no dedicated resolution endpoint is
  needed.
- **Per-participant outcome + net VXP are derived server-side from the
  clearing settlement plan (2026-06-25).** Clearing's
  `get_settlement_plan(series_id)` returns `positions: vec
SettlementPosition { user, net_qty, outcome_id, cashflow_usd }` and is
  **not** caller-scoped, so the hook enumerates every participant and
  their realized signed `cashflow_usd` (the net VXP, in `USD_DECIMALS`)
  directly: no client input, so a result cannot be forged. `outcome`
  is the sign of `cashflow_usd`; `side` is the settlement `outcome_id`,
  or `YES`/`NO` from the sign of `net_qty` for a binary position. (The
  caller-scoped `get_trade_history` could not enumerate another
  principal's history; the settlement plan is the surface that can.) No
  friend-readable per-principal clearing read exists that would let the
  collection be skipped: clearing trade-history is caller-scoped, so
  this collection is the source.
- **Retention TTL: month plus grace (2026-06-25).** The feed grows
  unbounded without a cap (Memory & storage), so the controllers-only
  cleanup (`pruneResolvedResults`) prunes rows whose `resolvedAtMs` is
  older than `RESOLVED_RESULTS_RETENTION_MS` (45 days: a calendar month
  plus a ~2-week grace margin) in `src/lib/constants/app.constants.ts`,
  never a literal. The horizon stays at least the active digest window so
  a slightly delayed prune never drops a row the digest still needs.
- **Standout selection rule: largest |net VXP|, tie-break most recent
  (owner default, 2026-06-25).** Among a friend's resolved-result rows
  in the window, the digest's standout is the call with the greatest
  absolute net VXP (their most consequential result, win or loss); ties
  break to the most recent `resolvedAtMs`. The selection runs in the
  consumer, but it is the reason this collection carries signed `netVxp`
  and `resolvedAtMs` per row, recorded here so the doc shape is
  justified.
