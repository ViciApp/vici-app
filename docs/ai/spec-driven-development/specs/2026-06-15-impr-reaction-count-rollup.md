# Spec: Reaction like-count rollup (scale path)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#897)

## Goal

Make the friend-feed like count read in O(1) per activity instead of
scanning the reaction collection on every feed mount. Today the count is
computed client-side from a bounded page of `activity_reactions`
(count-on-read), which under-reports once an activity's likes fall outside
the most-recent window. This replaces that read path with a
server-maintained per-activity counter, so counts stay correct as total
likes grow: the 100×-scale follow-up the persistence spec deferred.

## Context

Spec A,
[`2026-06-14-feat-friend-feed-like-persistence.md`](./2026-06-14-feat-friend-feed-like-persistence.md),
shipped count-on-read and explicitly documented this rollup as the scale
path (its Decisions + Scalability). The user-visible behaviour (a like
count per row) does not change; only how it's computed.

What exists today:

- [`src/lib/services/activity-reaction.services.ts`](../../../../src/lib/services/activity-reaction.services.ts):
  `getActivityReactions` (bounded `listDocs` over `activity_reactions`)
  - `countActivityReactions` (client tally). `FriendsTab` reads the tally
    from `activityReactionsStore` (populated by `LoaderGlobalActivities`).
- `activity_reactions` docs are written by client `setDoc` (like) and
  removed by client `deleteDoc` (unlike), so an `onSetDoc` / `onDeleteDoc`
  hook on that collection genuinely fires (contrast the serverless-write
  caveat in [`satellite/patterns.md`](../../satellite/patterns.md#hooks-fire-only-for-client-writes-never-for-serverless-setdocstore)).

Pattern to mirror: the stats fan-out hooks
([`league-stats.services.ts`](../../../../src/satellite/services/league-stats.services.ts),
`affiliation-stats.services.ts`): an `onSetDoc` hook reads the target
counter via `getDocStore`, computes the next value, and writes it back with
`setDocStore` using `version: existing?.version` (optimistic lock). The
`OnSetDocContext` exposes `data: { before, after }`: `before` is nullish
on a create, which is the create-vs-update signal Spec A flagged as an
open question.

## Scope

### Backend

1. New Datastore collection `activity_reaction_counts`: one doc per
   activity, keyed by the activity doc key (`${author}#${ts}#${type}` =
   `ActivityReaction.activityKey`). Data `{ activityKey: string; count:
number; updatedAtMs: number }`. **Public read** (the feed reads counts),
   **controllers write** (server-authoritative: only the hook writes it,
   so a client can't forge a count). Pinned in `juno.config.ts`,
   `juno.collections.json`, and the `Collection` enum.
2. `onSetDoc` hook on `activity_reactions` (`onActivityReactionSet`):
   **increment** the activity's counter, but only on a genuine create
   (`isNullish(before)`): an update of an existing reaction doc is a
   no-op, so a double-`setDoc` of the same like can't double-count.
3. `onDeleteDoc` hook on `activity_reactions` (`onActivityReactionDelete`):
   **decrement** the counter (floored at 0).
4. Both hooks write the counter via `setDocStore` as **admin**
   (`getAdminAccessKeys()[0]?.[0]` as caller: the controllers-write
   collection rejects a non-controller caller), version-locked
   (`version: existing?.version`), mirroring `incrementLeagueStats`.
5. Wire both hooks into the `setDocCollections` / `deleteDocCollections`
   dispatch tables in `src/satellite/index.ts`. No assert needed: the
   collection is controllers-write, so only the hook (admin) can write.

### Frontend

6. `getActivityReactionCounts({ activityKeys })` (or a bounded `listDocs`
   over `activity_reaction_counts`) + a store, populated by a loader
   (reuse the `LoaderGlobalActivities` mount). `FriendsTab.reactionCount`
   reads the counter doc instead of tallying `activityReactionsStore`.
7. **Keep the viewer's own-like state on the existing read.** Whether
   _you_ liked a row is still derived from `activity_reactions`
   (`serverLikedKeys` in `FriendsTab`, scoped to the recent page): the
   counter only replaces the aggregate _number_. Optimistic +1/−1 on the
   displayed count stays (a tap adjusts the shown count immediately;
   reconciles to the counter on reload).

### Out of scope

- The like button, persistence, the reaction collection/assert, and the
  like-received inbox card (spec A / B).
- Backfilling counts for reactions created before this ships: the counter
  starts from the hook's first fire; a one-shot recompute endpoint is a
  follow-up if staging data needs it (see Open questions).

## Linked issues

None.

## Analytics

No new analytics. This is an internal read-path change with no new
user-facing action; the like itself is already tracked
(`friend_feed_reaction`).

## Technical requirements (satellite / backend, mandatory)

- **Performance.** +1 `getDocStore` + 1 `setDocStore` per like/unlike
  (inside the hook, O(1)); the prior count-on-read `listDocs` over the
  whole reactions page is removed from the feed path. Hooks add bounded
  work per write, no cross-canister calls.
- **Memory & storage.** New `activity_reaction_counts` collection, `stable`:
  one small doc per activity that has ≥1 like; bounded by activity count,
  not like count. No cleanup story in v1 (counts persist with the
  activity).
- **Scalability.** Counter read is O(1) per activity at any like volume:
  the point of the change. The feed reads counts for its ~20 visible
  activities (bounded `listDocs` or a small batched read), independent of
  total likes.
- **Concurrency: known limitation.** The counter is a version-locked
  read-modify-write. Two likes on the **same** activity landing in the same
  fraction of a second can collide: the second `setDocStore` traps on the
  stale version, and a canister trap **cannot be caught inside a hook**, so
  that increment is lost (the reaction doc still persists: only the count
  drifts by one). This matches the accepted behaviour of the existing
  `league_stats` / `affiliation_stats` fan-out hooks. It's an
  under-count drift on hot activities, bounded and cosmetic. If it proves
  material, a periodic/admin recompute endpoint (re-derive `count` from a
  prefix scan of `activity_reactions`) is the corrective, noted as a
  follow-up, not built here. **This is the main reason to review the design
  before implementing.**
- **Upgrade & compatibility.** Additive: a new collection, two hooks, and
  the admin `recomputeActivityReactionCounts` endpoint (the owner-chosen
  drift corrector, see Decisions). The endpoint adds a method to the
  `.did` surface, so bindings **do** regenerate (`src/declarations/**` +
  `satellite_extension.did` committed). No change to existing doc shapes;
  not breaking.
- **Security.** `activity_reaction_counts` is controllers-write, so clients
  can't forge counts; public read. The hooks write as admin via
  `getAdminAccessKeys`.
- **Parameters.** The feed-count read page size is the one new tunable,
  named constant.

## Implementation outline

1. Add the collection (3 pin sites) + `ActivityReactionCount` type +
   `activityReactionCountKey` helper.
2. `src/satellite/services/activity-reaction-count.services.ts`:
   `onActivityReactionSet` (create-only increment) +
   `onActivityReactionDelete` (decrement, floor 0), both version-locked
   `setDocStore` as admin. Wire into `index.ts` hook tables.
3. `npm run juno:functions:build`; confirm no `.did` drift (commit only if
   something regenerates).
4. FE: counts reader + store + loader wiring; switch `FriendsTab`'s count
   source; keep own-like state + optimistic delta as-is.
5. `npm run quality` + `npm run check` (+ `juno:functions:build`).
6. Update `PRODUCT.md` only if wording needs it (behaviour is unchanged,
   likely no change). Flip status to `Implemented (#PR)`.

## Acceptance criteria

- [ ] Liking an activity increments its `activity_reaction_counts` doc by
      exactly 1 (a repeated `setDoc` of the same like does not).
- [ ] Unliking decrements it (never below 0).
- [ ] The feed shows the counter's value, correct for activities whose
      likes are outside the recent `activity_reactions` window (the
      count-on-read ceiling is gone).
- [ ] A client cannot write `activity_reaction_counts` directly (controllers-write).
- [ ] Optimistic count delta on tap still applies and reconciles on reload.
- [ ] `npm run quality`, `npm run check`, and `npm run juno:functions:build`
      (no unexpected `.did` drift) pass.

## Open questions

- ~~Backfill for pre-hook likes?~~ **Resolved:** the admin
  `recomputeActivityReactionCounts` endpoint doubles as the backfill: run
  it once after deploy to seed counts from existing reactions; no separate
  migration.
- ~~FE count read: bounded `listDocs` vs per-activity `getDoc`?~~
  **Resolved:** a single bounded `listDocs` over `activity_reaction_counts`
  ordered by `updated_at desc` (`ACTIVITY_REACTION_COUNTS_READ_LIMIT`). One
  call; the counts collection is one doc per activity (far smaller than the
  reactions collection), and a fed activity's last-like recency keeps its
  counter inside the window, so the residual window is far higher than the
  count-on-read ceiling it replaces, without N+1 reads.

## Decisions

- **Counter drift correction: admin recompute endpoint (owner-decided).**
  Ship the version-locked counter (option a's behaviour) **and** an
  admin-gated `recomputeActivityReactionCounts` endpoint that re-derives
  exact counts from `activity_reactions`, so any same-instant-race drift
  (or pre-rollup backfill gap) is correctable on demand without a migration.
  The endpoint scans `activity_reactions`, tallies per `activityKey`, and
  upserts the counter docs as admin. Admin-gated via `isAdmin`
  (`_authz.ts`), mirroring `sweepExpiredDeletions`. This adds a
  `defineUpdate` to the Candid surface, so unlike the rest of the rollup,
  bindings **do** regenerate.

- **Counter collection, not an array on the activity.** Same reasoning as
  spec A's per-liker docs: an array invites lost-update races and the
  activity doc is write-guarded to its author.
- **Hook-maintained (server), not client-written.** A count many users
  contribute to must move on the server so no single user can forge it:
  the `league_stats`/`affiliation_stats` rule (shared stat → hook;
  owned/cosmetic → client-write). Hence controllers-write + admin
  `setDocStore`.
- **Create-only increment via `before`-presence.** The `OnSetDocContext`
  `before` field (nullish ⇒ create) resolves spec A's open question and
  makes the increment idempotent against a re-`setDoc` of an existing like.
