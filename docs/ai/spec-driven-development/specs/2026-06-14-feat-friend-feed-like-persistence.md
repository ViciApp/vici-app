# Spec: Friend activity feed: persist likes

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#891)

## Goal

A like on a row of the Arena → Friends "Recent activity" feed survives a
page refresh, and each row shows how many people liked it. Today a tap
only flips an in-memory flag, so every like is lost the moment the
component remounts. After this change a like is a real, server-stored
reaction: when you come back, the rows you liked are still highlighted
and the like count reflects everyone who reacted: the standard social
"like" model.

## Context

The reaction is purely client-local today, explicitly deferred by the
reaction-redesign spec
([`2026-06-12-feat-friend-feed-reaction-redesign.md`](./2026-06-12-feat-friend-feed-reaction-redesign.md),
Out of scope: "A persisted, satellite-backed reaction model (counts, who
reacted) … persistence is a tracked follow-up"). This spec is that
follow-up.

**This is spec A of a two-spec split.** It delivers persistence + counts
on the Friends feed. Notifying the activity's author when their call is
liked is spec B,
[`2026-06-14-feat-like-received-notifications.md`](./2026-06-14-feat-like-received-notifications.md),
which derives an inbox card from the `activity_reactions` collection
this spec introduces. The doc shape below is deliberately defined once
here (including the fields B's card needs) so B adds no schema/assert
change.

Frontend, [`src/lib/components/arena/FriendsTab.svelte`](../../../../src/lib/components/arena/FriendsTab.svelte):

- `likedKeys = new SvelteSet<string>()` (line 665): the local-only set
  that loses everything on remount. `firingKeys` (line 670) drives the
  commit animation and stays local (transient motion only).
- `activityKey(activity)` (line 674) returns `${activity.timestamp}#${activity.user}`:
  a per-row UI identity, **not** the satellite doc key.
- `toggleLike(activity)` (line 678) mutates `likedKeys` only; no service
  call.
- Button markup ≈ lines 1090–1110 (`button.feed-react`, `class:is-liked`,
  `aria-label` = `arena.friends.feed.like`, the `<Zap>` glyph and the
  `.react-burst`).

Activities, [`src/lib/services/activity.services.ts`](../../../../src/lib/services/activity.services.ts):

- `logActivity` keys every activity doc `${user}#${timestamp}#${type}`
  (line 9), enforced by the satellite assert (below). This is the
  globally-unique identity of an activity.
- `getGlobalActivities` / `listActivities` map `({ data }) => data`
  (line 33): they **drop the doc key**. The FE never sees the activity
  doc key, but can reconstruct it from the `Activity` fields
  (`user`, `timestamp`, `type`), since the assert guarantees that exact
  shape.
- `Activity` type: [`src/lib/types/social.ts`](../../../../src/lib/types/social.ts)
  (`type`, `user`, `timestamp` are all present).

Loader / store wiring:

- [`src/lib/components/loaders/LoaderGlobalActivities.svelte`](../../../../src/lib/components/loaders/LoaderGlobalActivities.svelte)
  calls `getGlobalActivities()` and writes the
  [`src/lib/stores/activities.store.ts`](../../../../src/lib/stores/activities.store.ts)
  writable.
- Derived feed:
  [`src/lib/derived/activities.derived.ts`](../../../../src/lib/derived/activities.derived.ts)
  → `FriendsTab.svelte`.

Pattern to mirror: comment votes
([`src/lib/services/discussion.services.ts`](../../../../src/lib/services/discussion.services.ts),
`upvoteComment`/`downvoteComment`): a binary, per-user reaction read back
on load. Note the mechanism differs from this spec's: comment votes
`getDoc` the comment then `setDoc` it back with the caller added to /
removed from `upvotes: PrincipalText[]` **on the comment doc** (no
`deleteDoc`), which works only because the comment author isn't
write-guarded against other voters. Activity docs **are** write-guarded
([`src/satellite/services/activity.services.ts`](../../../../src/satellite/services/activity.services.ts),
`assertSetActivity`: `data.user` must equal the caller, key must be
`${caller}#${timestamp}#${type}`), so a different user **cannot** write
the actor's activity doc. Reactions therefore need their own collection,
one doc per liker (a join table), not an array on the activity.

Satellite scaffolding to mirror when adding a collection:
[`docs/ai/satellite/structure.md`](../../satellite/structure.md) §
"Collections and `juno.config.ts`": a new collection is pinned in
**both** [`juno.config.ts`](../../../../juno.config.ts) (`JunoDatastoreCollection`
enum + the `datastore` array) and
[`src/lib/constants/collections.constants.ts`](../../../../src/lib/constants/collections.constants.ts)
(`Collection`), and gets an assert wired via `assertSetDocCollections`
in `src/satellite/index.ts`.

## Scope

### Backend

1. New Datastore collection `activity_reactions` (one doc per
   activity-per-liker). Public read, public write.
   - **Doc key**: `${activityDocKey}#${liker}` where
     `activityDocKey = ${actor}#${timestamp}#${type}`: four `#`-split
     segments total (`actor`, `timestamp`, `type`, `liker`). Principals,
     numeric timestamps, and `ActivityType` tokens never contain `#`, so
     the split is exact (same guarantee `assertSetActivity` relies on).
   - **Doc data**: `{ activityKey: string; liker: PrincipalText; timestamp: number; activityTitle: string; marketId?: string }`.
     `activityKey` = the `activityDocKey` above. `activityTitle` (and the
     optional `marketId` for deep-linking) are **denormalized copies of
     the liked activity's fields**, carried so spec B's notification card
     reads "Alice liked your call: <title>" without a second fetch. They
     are not used by spec A itself; they are written now so the doc shape
     and assert stay stable across both PRs. Low-stakes spoofability: a
     liker writes the title, so it could be falsified, but it only affects
     the card shown to the activity's own author about their own call:
     noted, accepted.
2. Write-time guard `assertSetActivityReaction` in a new
   `src/satellite/services/activity-reaction.services.ts`, wired into
   `assertSetDocCollections` in `src/satellite/index.ts`. It enforces:
   - `data.liker === caller` (no liking as someone else),
   - the key is exactly `${activityKey}#${caller}` with a well-formed
     embedded `activityDocKey` (3 inner segments, middle is `^\d+$`, last
     is a known `ActivityType`),
   - `timestamp` is a safe integer,
   - `activityTitle` is a bounded string (cap its length, mirroring how
     `assertSetActivity` bounds activity fields) and `marketId`, when
     present, is a string.
     No delete guard: a liker deletes only their own doc (Juno owner-scoped
     delete on a public collection already restricts this to the doc owner;
     confirm, see Open questions).

### Frontend

3. New `activity-reaction.services.ts` under `src/lib/services/`:
   - `activityReactionKey({ activity })` → the reconstructed
     `${user}#${timestamp}#${type}` doc key (shared helper so the
     component and loader agree).
   - `likeActivity({ activity, liker })` → `setDoc(ACTIVITY_REACTIONS, …)`,
     writing `activityTitle` (and `marketId` when set) from the `Activity`
     for spec B's card.
   - `unlikeActivity({ activity, liker })` → `getDoc` then `deleteDoc`
     (mirrors `deleteComment`).
   - `getActivityReactions({ limit })` → one bounded `listDocs`
     (`order: { field: 'created_at', desc: true }`, `paginate.limit`),
     returning the reaction docs.
4. New store `activityReactionsStore` (or fold into the existing
   activities loader) holding, per `activityKey`: the total like count and
   whether the current user is among the likers. A loader call in
   `LoaderGlobalActivities.svelte` (alongside `getGlobalActivities`)
   populates it, so counts + my-likes hydrate on the same mount.
5. `FriendsTab.svelte`:
   - Seed `likedKeys` from the store (the current user's reactions) on
     mount/derivation instead of starting empty; key `likedKeys` by the
     full `activityReactionKey` so it matches the persisted identity
     (reconcile with the current `${timestamp}#${user}` UI key).
   - `toggleLike` becomes optimistic + persistent: flip `likedKeys` and
     fire the existing motion immediately (unchanged UX), then
     `await likeActivity`/`unlikeActivity`; on failure, roll the local
     flag back and surface the standard error toast.
   - Render the like count next to the `<Zap>` when `count > 0` (reuse
     the existing `.feed-react` layout; add a small count element).
   - Keep `firingKeys` exactly as-is (transient animation, never
     persisted).
6. i18n: the existing `arena.friends.feed.like` key stays. If a count
   needs an accessible label (e.g. "{n} likes"), add one key across all 8
   catalogs and run `npm run check:i18n`.

### Out of scope

- **Server-maintained rollup counters.** v1 computes counts on read from
  one bounded `listDocs` (see Decisions). A per-activity rollup-counter
  doc maintained by `onSetDoc`/`onDeleteDoc` hooks (the
  `league_stats`/`affiliation_stats` fan-out idiom) is the 100×-scale
  follow-up, see Technical requirements § Scalability.
- **Notifying the actor** that someone liked their call, owned by spec B
  ([`2026-06-14-feat-like-received-notifications.md`](./2026-06-14-feat-like-received-notifications.md)).
  Spec A only persists the reactions B reads; it adds no inbox card.
- **Reactions beyond a single binary like** (emoji set, multiple reaction
  types).
- The non-friend / ranked-friends fallback branches of the feed and the
  feed's data source, owned by other specs.
- **Other activity surfaces.** The like button stays on the Arena →
  Friends feed only. `MarketRecentTrades` (market detail "Recent trades")
  gets no button, and the standalone global `ActivityFeed` / `ActivityItem`
  is currently unmounted (zero `<ActivityFeed>` usages in `src/`; only
  stale comments reference a former Leaderboard "Activity" tab), reviving
  it is not in scope. The backend model is surface-agnostic, so adding
  these later needs no schema change.

## Linked issues

No open issue tracks this. Searched open issues for
`like`/`reaction`/`feed`/`persist`: only unrelated results. The
reaction-redesign spec named it a "tracked follow-up" but filed no
GitHub issue. No closing keyword.

## Analytics

Instrument: a like is a core social signal and the feed is otherwise
invisible to product analysis. Propose one event:

- `friend_feed_reaction`, prop `label: 'like' | 'unlike'` (bounded
  vocabulary, no PII), captured via `track` in
  `src/lib/services/analytics.services.ts` from `toggleLike` after the
  write resolves.

The new name lands in **both** halves of the dual-source pair:
`src/lib/types/analytics-event.ts` (TS union) **and**
`src/lib/schema/analytics-event.schema.ts` (Zod mirror), per the
analytics dual-source rule; svelte-check only catches the union, the enum
mismatch fails at runtime.

## Technical requirements (satellite / backend, mandatory)

- **Performance.** Writes: one `set_doc` per like, one `delete_doc` per
  unlike: same cost class as a comment vote. The assert is O(1) string
  parsing, no cross-canister calls. Reads: one extra bounded `listDocs`
  per feed mount (the count-on-read query), parallel to the existing
  `getGlobalActivities` call.
- **Memory & storage.** New `activity_reactions` collection, `stable`
  memory. One small doc per (activity, liker): key
  `${actor}#${ts}#${type}#${liker}` plus `{ activityKey, liker, timestamp,
activityTitle, marketId? }` (the last two denormalized for spec B's
  card). Growth = total likes ever cast; append-mostly, with
  deletes on unlike. No retention/cleanup story in v1 (reactions persist
  with their activity); a cleanup pass can piggyback on activity
  pruning if/when that lands.
- **Scalability.** Count-on-read does a single `listDocs` capped at
  `paginate.limit` (e.g. 1000), tallied client-side: flat per mount, but
  it under-counts activities whose reactions fall outside the most-recent
  window. Acceptable for current (staging) volume; the spec logs the
  ceiling. At 10×/100× total likes, migrate counts to a per-activity
  rollup-counter doc bumped by `onSetDoc`/`onDeleteDoc` hooks on
  `activity_reactions` (writing the counter via `setDocStore` as admin,
  mirroring `affiliation_stats`/`league_stats`); that hook must detect
  create-vs-update to stay idempotent (see Open questions). Deferred to
  keep this a single shippable PR.
- **Upgrade & compatibility.** Additive: a new collection + a new assert.
  No change to existing doc shapes. Regenerate satellite bindings
  (`npm run juno:functions:build`) and commit the regenerated
  `satellite.did` / `satellite_extension.did` / `api-schemas.ts`. Not
  breaking: no `!`/`BREAKING CHANGE:`.
- **Security.** `activity_reactions` is public-read/public-write; the
  `assertSetActivityReaction` guard binds `liker === caller` and the key
  shape, so a client cannot forge a like as another principal or under a
  malformed key (the same threat model `assertSetActivity` addresses for
  activities). Deletes are owner-scoped by Juno: confirm a non-owner
  cannot delete another user's reaction (Open questions).
- **Parameters.** The count-on-read page size is the one new tunable;
  define it as a named constant rather than a literal at the call site.

## Implementation outline

1. Add `ACTIVITY_REACTIONS = 'activity_reactions'` to the
   `JunoDatastoreCollection` enum + the `datastore` array in
   `juno.config.ts`, and to `Collection` in `collections.constants.ts`
   (keep both in sync).
2. Add `src/satellite/services/activity-reaction.services.ts` with
   `assertSetActivityReaction`; wire it into `assertSetDocCollections` in
   `src/satellite/index.ts`. Run `npm run juno:functions:build`; commit
   regenerated `.did` / `api-schemas.ts`.
3. Add `src/lib/services/activity-reaction.services.ts`
   (`activityReactionKey`, `likeActivity`, `unlikeActivity`,
   `getActivityReactions`) mirroring `discussion.services.ts`.
4. Add the reactions store + the loader call in
   `LoaderGlobalActivities.svelte`; build the per-`activityKey`
   `{ count, mineLiked }` map.
5. Update `FriendsTab.svelte`: seed `likedKeys` from the store, make
   `toggleLike` optimistic + persistent with rollback, render the count.
6. Add the `friend_feed_reaction` event to the analytics TS union + Zod
   mirror; `track` it in `toggleLike`.
7. Add any new i18n key across all 8 catalogs; `npm run quality` +
   `npm run check`.
8. Divergence check; flip status to `Implemented (#PR)`; update
   `docs/ai/PRODUCT.md` for the now-persistent reaction.

## Acceptance criteria

- [ ] Liking a feed row writes an `activity_reactions` doc; after a full
      page refresh the row is still shown as liked.
- [ ] Unliking deletes the doc; after refresh the row is no longer liked.
- [ ] Each row shows a like count aggregated across all likers (rendered
      only when `> 0`), correct after refresh.
- [ ] A user cannot forge a like as another principal (assert rejects a
      mismatched `liker`/caller or malformed key); a user cannot delete
      another user's reaction.
- [ ] `toggleLike` is optimistic and rolls back the local flag on write
      failure; the commit animation is unchanged and reduced-motion still
      honoured.
- [ ] `friend_feed_reaction` fires on like and unlike; the name exists in
      both the TS union and the Zod mirror.
- [ ] `npm run quality` (incl. i18n), `npm run check`, and
      `npm run juno:functions:build` (with regenerated files committed)
      all pass.

## Open questions

- ~~Juno owner-scoped delete on a public-write collection~~ **Resolved:**
  no delete assert was added. The existing public-write `comments`
  collection deletes the same way (`deleteComment` is a bare
  `getDoc` + `deleteDoc` with no `assertDeleteDoc`), so Juno's
  owner-scoped delete is the established model: an unlike can only remove
  the liker's own reaction doc.
- For the deferred rollup-hook counts (not built here): confirm the
  `onSetDoc` context exposes a create-vs-update signal (prior-doc
  presence) so the counter increments only on a genuine new like. Carries
  over to the rollup follow-up.

## Decisions

- **Separate `activity_reactions` collection over an array on the
  activity doc.** The comment-vote pattern stores voters on the target
  doc, but `assertSetActivity` write-guards activity docs to their actor,
  so another user physically cannot append themselves. A per-liker join
  doc is the only model compatible with the existing guard, and it avoids
  the lost-update race a shared array has under concurrent likes.
- **Count-on-read in v1 over a server-maintained rollup.** Counts come
  from one bounded `listDocs` tallied client-side. It keeps the change a
  single shippable PR, adds no hook (and sidesteps the `onSetDoc`
  create-vs-update idempotency wrinkle), and is correct at current
  volume. The rollup-counter + hook is documented as the explicit
  100×-scale follow-up rather than built speculatively.
- **Optimistic UI retained.** The existing instant highlight + motion is
  kept (the persisted write happens after), so the redesign's tactile
  feel is unchanged; only a failed write rolls back.
- **Count-on-read confirmed (owner-delegated).** The owner delegated the
  count-architecture call; count-on-read is chosen for the reasons above,
  with the rollup as the documented scale follow-up.
- **Two-spec split + denormalized card fields.** Persistence+counts (this
  spec) and notifications (spec B) ship as separate PRs per the
  one-spec-one-PR rule. To avoid a doc-shape/assert change in B, the
  reaction doc carries `activityTitle` + `marketId` now, even though spec
  A doesn't render them.
- **Friends feed only.** The standalone global feed is dead code
  (unmounted) and `MarketRecentTrades` has no like affordance today;
  scoping to the one live surface that already has the button keeps this
  PR tight, and the surface-agnostic backend leaves the door open.

### Divergences from the spec (recorded at implementation)

- **No new i18n key for the count.** The spec left the accessible count
  label optional. Rather than add a key across all 12 catalogs, the count
  is composed into the existing localized `arena.friends.feed.like` label
  for the button's accessible name (`"Like · 3"`) and shown as an
  aria-hidden numeral: zero i18n churn, catalogs stay in parity.
- **Error toast reuses `common.error.generic`** instead of a bespoke
  "like failed" string (same no-new-key reasoning).
- **`likedKeys` re-keyed to the full activity doc key**
  (`${user}#${timestamp}#${type}`) via the shared `activityReactionKey`,
  replacing the old `${timestamp}#${user}` UI key, so the optimistic
  mirror, the store summaries, and the persisted docs all agree.
