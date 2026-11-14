# Spec: Arena Friends: "Recent results" per-friend digest

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#981)

## Dependencies

Depends on Spec A:
[`2026-06-25-feat-resolved-results-collection.md`](./2026-06-25-feat-resolved-results-collection.md)
(`resolved_results`: friend-readable per-participant resolution feed).
Spec A is the additive satellite backend that writes and exposes the
per-participant resolved-result rows this digest reads for its standout
line; **Spec A merges first**. This spec (B) is a pure-frontend
consumer: it adds no satellite collection, write path, or backend read
of its own.

## Goal

Replace the Arena → Friends "Recent activity" firehose, one row per
individual friend call ("@alice called YES on …"), with a per-friend
"Recent results" digest. Each row summarises **one friend's** resolved
record over a recent window: their win–loss tally, their net VXP, the
**standout market** they called (their most notable resolved
prediction, in v1, see Decisions), and a relative time window
("2h ago" / "today"), with the existing `Zap` reaction kept. Open /
unresolved calls
carry no outcome, so they are excluded: that "did-something" noise is
exactly what the firehose surfaced and what users asked to lose. The
result reads as a quiet, skimmable scoreboard of how your friends are
actually doing, not a stream of every move they make.

## Context

**The design.** The Arena → Friends section presents a per-friend
"Recent results" digest. Each row carries one friend's resolved record
over the window: `{ handle, won, lost, net, when, standout }` where
`standout` is a market id, rendered as `@handle · resolved N calls ·
W–L`, a `{when} · incl. "{standout market question}"` meta line, the
signed `net VXP`, and a reaction. The reaction is the app's `Zap` lucide
glyph (the house icon system; no emoji, see Decisions).

**Friends-as-default-Arena-tab is already shipped** in the app and is
**out of scope** here: this spec only swaps the feed section's data
model and copy.

**App: the surface being changed.**
[`src/lib/components/arena/FriendsTab.svelte`](../../../../src/lib/components/arena/FriendsTab.svelte):

- The "Friends feed" section (template ≈ lines 1149–1237) renders the
  firehose: `friendActivities` (≈ lines 661–663) =
  `$globalActivities.filter((a) => friendIdSet.has(a.user)).slice(0, 20)`:
  individual `Activity` rows drawn from the cached global activity
  stream filtered to the friend set. Each row shows `activity.title`
  ("called YES on …") + an optional `activity.details` market line + the
  `Zap` reaction.
- Eyebrow copy is the i18n key `arena.friends.feed.eyebrow` ("Recent
  activity"); the empty state uses `arena.friends.feed.empty_a` /
  `arena.friends.feed.empty_b`; the reaction's a11y label is
  `arena.friends.feed.like`.
- The reaction machinery (`toggleLike`, optimistic `pendingLikes`,
  `firingKeys`, server like counts from `activityReactionsStore` /
  `activityReactionCountsStore`, the `friend_feed_reaction` analytics
  event) is keyed to a per-`Activity` doc identity
  (`activityReactionKey({ activity })` =
  `${user}#${timestamp}#${type}`). A digest row is **not** an `Activity`
  doc, so reactions cannot attach to a digest row unchanged, see
  Pending decisions.

**App: the data shape that does NOT carry what the digest needs.**
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
any individual friend's per-call result. So neither the global activity
stream nor a settlement activity yields per-friend W–L or net VXP.

**App: where per-friend resolution data DOES / could come from.**

- **Aggregate W–L + net VXP per friend, per window: available today.**
  [`src/lib/services/standings.services.ts`](../../../../src/lib/services/standings.services.ts)
  `getLeagueStandings({ window, members })` returns, per principal in
  `members`, a `StandingEntry`
  ([`src/lib/types/standings.ts`](../../../../src/lib/types/standings.ts)):
  `{ owner, rank, realizedPnl (net VXP, USD_DECIMALS), settledCount,
winCount, accuracy, … }`. `winCount` = W, `settledCount - winCount` =
  L, `realizedPnl` = net VXP. It is sourced from the clearing
  `list_leaderboard` query and accepts a `members` principal filter, so
  it can be scoped to the friend set in **one** bulk call. Window is one
  of the three fixed calendar buckets `'week' | 'month' | 'all'`
  (`StandingsWindow`): **not** an arbitrary "last 48h" range.
  `FriendsTab` already hydrates the all-time slice via
  `loadGlobalStandings({ window: 'all' })` for the ranked list's live
  accuracy (≈ lines 155–159, `globalStandingsStore`), so the
  infrastructure is present.
- **Per-call breakdown (the standout market): supplied by Spec A.** No
  existing app surface yields a friend-readable per-call result:
  clearing trade-history is caller-scoped only (you can read your
  **own** per-call settlements via `ResolvedPosition`
  ([`src/lib/types/position.ts`](../../../../src/lib/types/position.ts))
  and its derived store
  ([`src/lib/derived/resolved-positions.derived.ts`](../../../../src/lib/derived/resolved-positions.derived.ts)),
  not a friend's), and the single `ActivityType.SETTLEMENT` row is the
  resolver's market-level result keyed by the resolver's principal, not
  a per-participant outcome. The standout therefore reads from the
  **`resolved_results` collection delivered by Spec A**
  ([`2026-06-25-feat-resolved-results-collection.md`](./2026-06-25-feat-resolved-results-collection.md)):
  per-`(owner, market)` rows of
  `{ owner, marketId, title, side, outcome, netVxp, resolvedAtMs }`,
  bulk-read friend-scoped via Spec A's read.

**Reuse (cite first: `docs/ai/frontend/reusability.md`).**

- `getLeagueStandings` + `StandingEntry` + `StandingsWindow` +
  `globalStandingsStore`: the per-friend W–L / net-VXP aggregate.
- Spec A's `resolved_results` friend-scoped read: the per-call rows
  backing the standout line.
- `formatRelativeAgoFromNs({ timestampNs, locale })`
  ([`src/lib/utils/format.utils.ts`](../../../../src/lib/utils/format.utils.ts))
  for the "2h ago" / "today" window string (it already drives the
  current `feedRelative`).
- `formatVxpBalance({ value })`
  ([`src/lib/utils/playground-display.utils.ts`](../../../../src/lib/utils/playground-display.utils.ts))
  for the signed net-VXP label (already used for the YOU-row points).
- `Avatar`
  ([`src/lib/components/profile/Avatar.svelte`](../../../../src/lib/components/profile/Avatar.svelte))
  - the `profilesStore` cache for each friend's handle / avatar (the
    feed already reads both).
- The existing `.feed-row` / `.feed-react` / `.react-burst` markup +
  `Zap` glyph in `FriendsTab.svelte`, reused for the digest row's
  layout and reaction (pending the reaction-identity decision below).

## Scope

**Frontend only.** The aggregate W–L / net-VXP slice is built on the
existing `getLeagueStandings` clearing query (no backend change), and
the standout market reads from Spec A's `resolved_results` collection
(merged first: Dependencies). This spec adds no satellite collection,
write path, or backend read; it consumes the two reads and renders the
digest.

1. **Replace `friendActivities` with a per-friend digest model.** In
   `FriendsTab.svelte`, derive `friendDigests: FriendDigest[]` from the
   friend set + a standings slice rather than from `$globalActivities`.
   Each `FriendDigest` = `{ friendId, profile, won, lost, netVxp,
windowLabel, standoutMarketId? }`:
   - `won` / `lost` / `netVxp` from the friend's `StandingEntry`
     (`winCount`, `settledCount - winCount`, `realizedPnl`) in the
     chosen window.
   - Rows with `settledCount === 0` are dropped (no resolved result to
     report: the open-call exclusion).
   - `windowLabel`: see Pending decisions on what timestamp drives it
     (the standings aggregate has no single "last resolved at" instant).
   - `standout` (`{ marketId, title }`): the friend's most notable
     resolved prediction in the window, selected by the **largest
     |net VXP|, tie-break most recent `resolvedAtMs`** rule (Decisions),
     read from Spec A's `resolved_results` collection. Omitted only when
     the friend has no resolved-result rows in the window, in which case
     the "incl. …" line is not rendered.
2. **Fetch the friend-scoped standings slice + resolved-results.** Add
   hydration calls (in `onMount`, alongside the existing all-time fetch):
   - `getLeagueStandings({ window: <chosen>, members: [...friendIds] })`
     for the W–L / net-VXP aggregate: one bulk call, no per-friend N+1.
   - Spec A's friend-scoped `resolved_results` bulk read for the
     standout market: one bounded `listDocs` over the friend set,
     **not** one call per friend. The standout is selected client-side
     per the largest-|net VXP| rule (Decisions).
3. **Rewrite the feed section template** (≈ lines 1149–1237) to render
   `friendDigests`: `@handle · resolved {total} {call|calls} · {W}–{L}`,
   a `{windowLabel}` meta line (plus `· incl. "{standout question}"`
   only when `standoutMarketId` is present), the signed `{netVxp} VXP`
   colored win/loss, and the reaction. Tapping the row navigates to the
   standout market when present (mirroring the current `goToMarket`),
   else is non-navigating (or navigates to the friend profile sheet,
   Pending decisions).
4. **Copy.** Repoint the eyebrow to a "Recent results" string and update
   the empty-state copy to describe results rather than calls. Keep the
   `arena.friends.feed.*` i18n namespace (see Decisions); add/retarget
   keys across **all** locale catalogs under
   `src/lib/constants/messages/` and run `npm run check:i18n`.
5. **Reaction.** Keep the `Zap` reaction visually. Resolve its persisted
   identity per Pending decisions (a digest row is not an `Activity`
   doc, so the current `activity_reactions`-keyed persistence does not
   map 1:1).
6. **Analytics.** Instrument digest engagement (see Analytics).

### Out of scope

- **Friends-as-default-Arena-tab**: already shipped; untouched.
- **The invite hero, pending/incoming requests, ranked list, global-rank
  link, and both bottom sheets** in `FriendsTab.svelte`: only the feed
  section changes.
- **The `resolved_results` collection, its write path, friend-scoped
  read, retention, and collection wiring**: all delivered by Spec A
  ([`2026-06-25-feat-resolved-results-collection.md`](./2026-06-25-feat-resolved-results-collection.md));
  this spec consumes the read, it does not build the backend.
- **A new per-call resolved-position _feed_ for friends** (one visible
  row per resolved call, the firehose in a different coat). The digest
  stays one aggregate row per friend. Spec A's `resolved_results` source
  backs only the single standout line per friend: it is not rendered as
  a per-call stream.
- **Reviving the standalone global `ActivityFeed`** / `MarketRecentTrades`:
  those keep the `Activity` model; this spec does not touch them. The
  `Activity` / `activities` collection itself is **not** removed (it
  still powers market "Recent trades", VXP onboarding counts, etc.):
  only the Friends tab stops reading it.
- **An arbitrary rolling window** (e.g. exactly "last 24h"). v1 uses one
  of the fixed `StandingsWindow` calendar buckets (Pending decisions).

## Linked issues

No related open issue. Searched `ViciApp/vici-app` open issues
for `friends` / `arena` / `activity` / `feed` / `digest` / `results` /
`resolution outcome`: the only open Arena issue is
[#970](https://github.com/ViciApp/vici-app/issues/970)
("I see battles duplicated in Arena"), which concerns the Battles tab,
not the Friends feed. No closing keyword.

## Analytics

Instrument: the feed is otherwise invisible to product analysis, and
"do friends engage with each other's _results_ more than the firehose?"
is the question this change exists to answer. Reuse the existing
`friend_feed_reaction` event for the reaction (its `label: 'like' |
'unlike'`, `source: 'arena'` vocabulary is unchanged) so the
reaction-engagement series stays continuous across the swap.

Add **one** new event for opening a digest row, mirroring the existing
social-event style:

- `friend_digest_opened`: fired when a digest row is tapped through to a
  market / profile. Props: `source: 'arena'` (bounded), and `marketId`
  when the tap targets the standout market (reuses the existing
  `marketId` dimension; omitted otherwise). Behavioural only: no W–L,
  net VXP, or handle is sent (those are per-user values bordering on
  PII-adjacent and add no analytical value here).

A new event name lands in **both** halves of the dual-source pair:
`src/lib/types/analytics-event.ts` (TS union) **and**
`src/lib/schema/analytics-event.schema.ts` (Zod mirror); svelte-check
only catches the union, an enum mismatch fails at runtime. Capture via
`track` in `src/lib/services/analytics.services.ts`. (If the owner
decides a row tap is non-navigating and carries no meaningful action,
drop `friend_digest_opened` and keep only the reused
`friend_feed_reaction`: recorded under Pending decisions.)

## Implementation outline

1. Define `FriendDigest` (co-located in `FriendsTab.svelte` or a small
   `src/lib/types/social.ts` addition) = `{ friendId, profile, won,
lost, netVxp, windowLabel, standout? }` where `standout` is
   `{ marketId, title }`.
2. In `FriendsTab.svelte`, add a `friendDigests` `$derived.by` that, for
   each `rankedFriends` entry, reads its `StandingEntry` from the chosen
   window's `globalStandingsStore` slice (or a dedicated friend-scoped
   store), maps `winCount` → `won`, `settledCount - winCount` → `lost`,
   `realizedPnl` → `netVxp` (via `formatVxpBalance`), and drops rows with
   `settledCount === 0`. Sort newest-result-first per the chosen window
   timestamp rule.
3. Add the friend-scoped hydration in `onMount` (alongside the existing
   all-time fetch): `getLeagueStandings({ window, members:
[...friendIdSet] })` for the aggregate **and** Spec A's
   `resolved_results` friend-scoped bulk read for the standout; guard
   both with the same cache-miss pattern already used for the all-time
   slice so a tab re-mount doesn't re-drain. Select each friend's
   `standout` client-side (largest |netVxp|, tie-break most recent).
4. Replace the feed-section template (≈ lines 1149–1237): render
   `friendDigests` with the result line, window meta line, signed
   net-VXP, and the `Zap` reaction; wire row tap to
   `goToMarket(standout.marketId)` when present (else per the row-tap
   decision). Remove the `$globalActivities`-based `friendActivities` and
   its imports if nothing else in the component uses them.
5. Repoint `arena.friends.feed.eyebrow` to "Recent results" and update
   the empty-state strings (`arena.friends.feed.empty_a/_b`) across all
   locale catalogs under `src/lib/constants/messages/`; add any new keys
   (e.g. the `W–L` / "resolved N calls" templates) to every catalog.
   Run `npm run check:i18n`.
6. Resolve the reaction-identity decision and adjust the reaction
   wiring accordingly (keep `friend_feed_reaction`); add
   `friend_digest_opened` to the analytics TS union **and** Zod mirror,
   and `track` it on row tap.
7. `npm run quality` + `npm run check`.
8. Divergence check; update `docs/ai/PRODUCT.md` (the Friends feed now
   describes results, not calls); flip status to `Implemented (#PR)`.

## Acceptance criteria

- [ ] The Arena → Friends feed section renders **one row per friend** who
      has at least one resolved prediction in the window, not one row per
      call.
- [ ] Each row shows the friend's W–L record and signed net VXP (win/loss
      colored), sourced from the friend's `StandingEntry`
      (`winCount` / `settledCount` / `realizedPnl`), with a relative
      window label.
- [ ] Friends with no resolved predictions in the window do not appear
      (open / unresolved calls are excluded).
- [ ] Each row with resolved results shows a standout "incl.
      '{market}'" line: the friend's resolved call in the window with
      the largest |net VXP| (tie-break most recent), sourced from Spec
      A's `resolved_results` collection.
- [ ] The eyebrow reads "Recent results" (not "Recent activity") and the
      empty state describes results; all strings route through `t(...)`
      and exist in every locale catalog (`npm run check:i18n` passes).
- [ ] The reaction is the `Zap` lucide glyph (no emoji), and toggling it
      still fires `friend_feed_reaction`.
- [ ] `friend_digest_opened` (if retained) fires on row tap and exists in
      both the analytics TS union and the Zod mirror.
- [ ] The `$globalActivities`-based per-call firehose is no longer
      rendered in the Friends tab; the `activities` collection and other
      surfaces that consume it are unaffected.
- [ ] `npm run quality` and `npm run check` pass. (No satellite change in
      this spec: the `resolved_results` collection ships in Spec A.)

## Open questions

- **Does `getLeagueStandings` carry a usable per-entry "last resolved at"
  timestamp, or only the window-aggregate?** Resolved: a `StandingEntry`
  carries no last-activity instant, so the per-friend "2h ago" window
  label derives from the standout's `resolvedAtMs` (Spec A's rows), which
  also drives the newest-first sort. A row with no retained standout shows
  no window label.

## Pending decisions

_All resolved during implementation (#981)._

- **Window backing the digest: `'month'`.** "Recent results" reads as a
  tight bucket, but `'month'` yields fuller rows on a thin friend graph
  and sits inside the `resolved_results` retention horizon
  (`RESOLVED_RESULTS_RETENTION_MS`, a calendar month plus grace), so the
  standings aggregate and the standout source span the same window.
- **Reaction is transient on the digest row.** A digest row is not an
  `Activity` doc, so the `activity_reactions` key has nothing to bind to.
  v1 keeps the reaction transient (visual `Zap` + motion only, no
  persistence) and still fires `friend_feed_reaction` so the
  engagement series stays continuous across the swap. A persisted
  digest-row reaction identity is a possible follow-up.
- **Row-tap target.** A row taps through to its standout market via the
  existing market route (firing `friend_digest_opened` with `marketId`).
  When a friend has no retained standout the tap opens their mini-profile
  sheet (reusing `openFriendSheet`) and fires `friend_digest_opened`
  without a `marketId`, so the row is never a dead tap.

## Decisions

- **Split the backend out into Spec A (owner, 2026-06-25).** The
  `resolved_results` collection (the new satellite collection, its
  resolution-time write, friend-scoped read, retention, and collection
  wiring) was split into Spec A
  ([`2026-06-25-feat-resolved-results-collection.md`](./2026-06-25-feat-resolved-results-collection.md))
  at the data-source / consumer boundary. Spec A is purely additive
  backend with no FE coupling and merges first; this spec (B) is the FE
  consumer and the only place the digest becomes visible. Per the
  workflow's
  [one-spec-one-PR rule](./../workflow.md#non-negotiables), spec'd work
  that cannot fit one reviewable PR is split at the spec level first.
- **Standout market in v1: consume Spec A's backend source (owner,
  2026-06-25).** The spec previously considered shipping the aggregate
  digest frontend-only and deferring the standout line, because no
  friend-readable per-participant resolved-result source existed. The
  owner accepts the backend work (now Spec A) to ship the full digest
  now: the "incl. '<market>'" line is part of v1, not a fast-follow,
  reading from Spec A's `resolved_results` collection.
- **Standout selection rule: largest |net VXP|, tie-break most recent
  (owner default, 2026-06-25).** Among a friend's resolved-result rows
  in the window, the standout is the call with the greatest absolute net
  VXP (their most consequential result, win or loss); ties break to the
  most recent `resolvedAtMs`. Chosen as the sensible default (surfaces
  the result a friend would most want to talk about) over alternatives
  (most recent, biggest win only).
- **Copy: "Recent activity" → "Recent results."** The eyebrow
  (`arena.friends.feed.eyebrow`) and the empty-state copy reframe the
  section from per-call activity to resolved results, matching the new
  aggregate model.
- **Keep the `Zap` reaction icon: no emoji.** The app standardises on
  lucide icons, and the Friends section already uses `Zap`. The reaction
  glyph stays `Zap`, preserving the app's icon system and the existing
  reaction motion / a11y label.
- **Keep the app's `arena.friends.feed.*` i18n namespace.** The existing
  catalog namespace is retained and its keys retargeted in place, per the
  house i18n rule.
- **Aggregate digest over a per-call firehose-in-disguise.** The digest
  is intentionally one summarised row per friend (W–L + net VXP + a
  single standout), not a per-resolved-call list: the latter would
  reintroduce the firehose this change set out to remove. Spec A's
  `resolved_results` source backs only the one standout line per friend,
  not a per-call stream.
