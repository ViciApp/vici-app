# Spec: Notify the author when their call is liked

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#894)

## Goal

When someone likes your call in the Arena → Friends feed, you find out:
an inbox notification appears ("Alice liked your call: <title>"), unread,
deep-linking to the market. Today a like is invisible to its recipient:
the author has no way to know anyone reacted.

## Context

**This is spec B of a two-spec split.** Spec A,
[`2026-06-14-feat-friend-feed-like-persistence.md`](./2026-06-14-feat-friend-feed-like-persistence.md),
introduces the `activity_reactions` collection (one doc per
activity-per-liker) and persists likes + counts. **This spec depends on
spec A being merged** and adds no new collection, doc shape, or assert:
it only _reads_ the reactions A writes. The reaction doc already carries
the fields this card needs (`activityKey`, `liker`, `timestamp`,
`activityTitle`, `marketId?`), denormalized by A precisely so B needs no
schema change.

Reaction doc key (from spec A): `${actor}#${ts}#${type}#${liker}`. The
**first** `#`-segment is the liked activity's author, so "likes on _my_
calls" is a single key-prefix query (`matcher: { key: '^${myPrincipal}#' }`),
the same shape `getSettlementActivities` already uses for key matchers in
[`src/lib/services/activity.services.ts`](../../../../src/lib/services/activity.services.ts).

Existing notification system to plug into (no new mechanism):

- [`src/lib/stores/inbox.store.ts`](../../../../src/lib/stores/inbox.store.ts):
  the inbox is a merge of _derived_ sources. The exact pattern to
  mirror is `friendRequestInboxStore` (≈ line 117):
  `derived([friendRequestsStore, profilesStore, userStore, localeStore], …)`
  maps pending `relations` docs → `InboxNotification[]` live; cards
  appear/disappear as the underlying collection changes. There is also a
  per-id read overlay (`inboxReadStore`, `INBOX_READ_STORAGE_KEY`) and a
  toast channel (`latestInboxToast`).
- [`src/lib/types/inbox.ts`](../../../../src/lib/types/inbox.ts):
  `InboxNotification { id; kind; title; body; when; unread; mid?; href? }`.
  `InboxNotificationKind` already includes `'social'` and `'friend_request'`.
- [`src/lib/constants/notification-kind.constants.ts`](../../../../src/lib/constants/notification-kind.constants.ts):
  maps each kind to an icon + default route + taxonomy label.
- [`src/routes/(app)/notifications/+page.svelte`](<../../../../src/routes/(app)/notifications/+page.svelte>)
  renders the inbox at `/notifications` (unread + earlier sections,
  dismiss / mark-read).
- Profiles for the liker's name/avatar come from `profilesStore`
  (hydrated via `loadProfilesByPrincipals`), exactly as
  `friendRequestInboxStore` resolves requester profiles.

## Scope

1. New derived store `likesReceivedInboxStore: Readable<InboxNotification[]>`
   in `inbox.store.ts`, mirroring `friendRequestInboxStore`:
   - Source: the current user's _received_ reactions: reactions whose
     `activityKey` author segment equals `$userStore` principal. Loaded by
     a new `getReceivedActivityReactions({ liker?: never })`-style service
     call in spec A's `activity-reaction.services.ts` (a key-prefix
     `listDocs` on `ACTIVITY_REACTIONS`), surfaced through a store the
     derivation can read (e.g. `receivedReactionsStore`), populated by a
     loader (below).
   - Map each reaction → `InboxNotification`:
     `id = reaction doc key` (stable, dedupes across refreshes),
     `kind = 'social'`,
     `title` = an i18n string with the liker's display name,
     `body` = the denormalized `activityTitle`,
     `when` = a user-facing relative-time **string** (`InboxNotification.when`
     is a `string`), formatted from `reaction.timestamp` (ms) the way
     `settledInboxStore` formats its `when` via `formatRelativeAgoFromNs`:
     use that helper's millisecond analogue (or convert ms→ns), keyed on
     `$localeStore`,
     `mid = reaction.marketId` (deep-link to the market) / `href` to the
     market route,
     `unread` = derived from the per-id read overlay.
   - Exclude self-likes (liker === author) so liking your own call never
     notifies you.
   - Hydrate liker profiles via `loadProfilesByPrincipals`.
2. Merge `likesReceivedInboxStore` into the combined inbox alongside
   `friendRequestInboxStore` / `settledInboxStore`, so it participates in
   unread counts, the `/notifications` list, mark-all-read, and the toast
   channel.
3. A loader to populate `receivedReactionsStore` on app load / inbox
   open, mirroring how friend requests / settlements are loaded (reuse an
   existing loader mount rather than adding a bespoke one if one fits).
4. `notification-kind.constants.ts`: reuse the existing `'social'` kind
   (icon + route already defined): confirm its default route points
   somewhere sensible for a like (market deep-link via `mid`/`href`
   overrides it anyway).
5. i18n: add the card copy keys (title "{name} liked your call",
   accessible label) across all 8 locale catalogs; run
   `npm run check:i18n`.

### Out of scope

- **Persistence, counts, the like button, the reactions collection /
  assert**: all owned by spec A.
- **Push / OS notifications.** In-app inbox only (matches every existing
  inbox source).
- **Aggregation** ("5 people liked your call" as one card). v1 is one card
  per like, like the existing per-event settlement cards. Collapsing
  bursts into a single card is a fast-follow if the volume warrants it
  (see Pending decisions).
- **Notifying on unlike**: no special handling. Because the card is
  derived live from the `activity_reactions` docs and spec A deletes the
  doc on unlike, the card simply disappears from the inbox, **regardless
  of whether it had been marked read**: there is no separate history
  store to retain it (consistent with not persisting cards elsewhere).
  This is the accepted behaviour, not a gap: an unlike fully withdraws the
  notification.

## Linked issues

None: same as spec A (no open issue tracks reactions). No closing
keyword.

## Analytics

The like/unlike action itself is already instrumented by spec A
(`friend_feed_reaction`). For B, the meaningful new signal would be
engagement with the resulting notification.

**Resolved (no analytics added in B).** Checked `NotificationsPage` and
`NotifToastHost`: the inbox emits **no** open/click event today, for any
kind. A `notification_opened` event would therefore be a new cross-cutting
instrument on the shared inbox tap handler (it spans every notification
kind, not this card) so it belongs to a dedicated inbox-analytics change,
not this single-card feature. The like itself is already captured by spec
A's `friend_feed_reaction`, so B ships with no new event. Recorded under
Decisions.

## Technical requirements (satellite / backend, mandatory)

No satellite change. B reads the spec-A collection; it adds no
collection, doc shape, assert, hook, endpoint, or `.did` regeneration.

- **Performance.** One extra `listDocs` on `ACTIVITY_REACTIONS` with a
  key-prefix matcher (`^${myPrincipal}#`) + `paginate.limit`, run on
  inbox load: same cost class as the existing friend-request /
  settlement loads. The derivation is pure client-side over already-loaded
  docs + profiles.
- **Scalability.** The received-reactions query is naturally bounded to
  one author's calls; pagination caps the page. At high volume the
  per-like card model (not aggregation) is the cost, addressed by the
  aggregation fast-follow, not by backend work.
- **Security.** Read-only over a public-read collection. No new caller
  permissions. The card is shown only to the activity's author (client
  filters by author segment); `activityTitle` is liker-written
  (spoofable, low stakes, see spec A) and is shown to the author about
  their own call.
- **Upgrade & compatibility.** Additive, client-only, non-breaking.

## Implementation outline

1. In spec A's `activity-reaction.services.ts`, add the received-reactions
   reader (key-prefix `listDocs`) + `receivedReactionsStore`.
2. Add a loader call to populate it on the inbox/app mount, hydrating
   liker profiles.
3. Add `likesReceivedInboxStore` in `inbox.store.ts` mirroring
   `friendRequestInboxStore`; exclude self-likes; wire into the combined
   inbox + toast.
4. Add i18n card-copy keys across all 8 catalogs.
5. Resolve the analytics open question; add the event only if the inbox
   has none.
6. Divergence check; flip status to `Implemented (#PR)`; update
   `docs/ai/PRODUCT.md` (inbox now surfaces likes received).

## Acceptance criteria

- [ ] When user B likes user A's friend-feed call, A sees an unread inbox
      card ("B liked your call: <title>") at `/notifications`, persisting
      across refresh.
- [ ] Tapping the card deep-links to the liked call's market.
- [ ] The card counts toward the unread badge and respects mark-read /
      mark-all-read.
- [ ] Liking your own call produces no card.
- [ ] Unliking removes the card from the inbox whether or not it was read
      (the reaction doc is deleted; no history store retains it); no error
      in either case.
- [ ] `npm run quality` (incl. i18n) and `npm run check` pass. No
      satellite build needed (no `src/satellite/**` change).

## Open questions

- ~~Does the inbox already emit an open/click analytics event?~~
  **Resolved:** no, so B adds none (see Analytics + Decisions).
- ~~Which existing loader mount hosts the received-reactions fetch?~~
  **Resolved:** `LoaderReceivedReactions` mounts in the deferred block of
  `src/lib/components/loaders/Loaders.svelte`, beside `LoaderFollowing` /
  `LoaderGlobalActivities`: identity-scoped, off the critical-path burst.

## Pending decisions

- **Aggregation vs one-card-per-like.** v1 ships one card per like
  (simplest, matches per-event settlement cards). If like volume makes
  that noisy, collapse a burst into a single "N people liked your call"
  card: a fast-follow, not v1. Owner call before the volume becomes a
  problem; defaulting to per-like for now.

## Decisions

- **Derive from the reactions collection, not a new LIKE activity row /
  notifications collection.** The activity model has a spare `targetUser`
  field and the codebase logs comment upvotes as activities, so a
  `LIKE`-typed activity row was an option, rejected because it would
  surface like rows in the activity feed and double-write (reaction doc +
  activity doc). Deriving the inbox card straight from the reaction doc
  (author = key prefix) reuses the established `friendRequestInboxStore`
  pattern, keeps a single source of truth, and needs no new write path.
- **In-app inbox only.** Every existing notification source is in-app;
  matching that keeps B client-only and avoids a push-infra dependency.
- **No analytics event in B.** The inbox has no open/click instrument
  today; adding one is a cross-cutting concern across every kind, not this
  card, and the like is already tracked by spec A. Deferred to a dedicated
  inbox-analytics change rather than bolted onto this feature.
- **Cold-start toast gate extended.** `receivedReactionsStore` joins the
  `sourcesHydrated` gate so a backlog of existing likes is absorbed as the
  toast baseline instead of replaying as arrival toasts on load; `Authn`
  resets the store on every auth transition (mirroring the other
  user-scoped caches) so a previous principal's likes never leak or replay.
- **Reused spec A's denormalized fields + key prefix.** The card needs no
  new read shape: `activityTitle` / `marketId` ride on the reaction doc,
  and "likes on my calls" is the doc-key prefix (`^${me}#`), so B is a
  pure client-side read + derive with no satellite change.
