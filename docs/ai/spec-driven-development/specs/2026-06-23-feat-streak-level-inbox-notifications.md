# Spec: Live streak + level inbox notifications

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1006)

## Goal

Two inbox notification kinds left without a producer when the mock seed was
removed get live, real-data producers, following the established
derived-store pattern in `inbox.store.ts`:

- **`streak`**: when the viewer's daily flame advances to a higher
  milestone stage (the flame grows), they get an inbox card ("Your flame
  reached FLAME: 7 days running"), unread, deep-linking to Flow.
- **`level`**: when the viewer's profile level increases, they get a card
  ("You reached level 4"), unread, deep-linking to their profile.

Both derive from profile state already loaded client-side; no satellite
change.

## Context

This is **one of a two-spec pair** reviving the producerless inbox kinds.
This spec owns `streak` + `level` (pure client-side, no new signal). The
sibling,
[`2026-06-23-feat-market-move-inbox-notifications.md`](./2026-06-23-feat-market-move-inbox-notifications.md),
owns the `market` kind (move alerts on saved markets), which needs a new
probability-delta signal. The two are independent; this one ships first.

The inbox is a merge of _derived_ `Readable<InboxNotification[]>` sources
in
[`src/lib/stores/inbox.store.ts`](../../../../src/lib/stores/inbox.store.ts).
The mock `seedInbox()` that once carried `streak` / `level` / `market`
placeholder cards has **already been removed upstream** (the inbox is now
fully live-derived, no seed layer), so this spec is purely additive: it
adds the `streak` and `level` producers. Patterns to mirror:

- **`friendRequestInboxStore`** (≈ line 127): synthetic, non-persisted,
  derived from a live source + `userStore` + `localeStore`; the per-id
  read overlay (`inboxReadStore`, `INBOX_READ_STORAGE_KEY`) drives
  read/unread. Closest shape for streak/level.
- **`settledInboxStore`** + **`settledReadStore`** (≈ line 254): a
  per-_event_ read-set keyed by a monotonic id, persisted to localStorage,
  so a card stops being unread once acknowledged and a cold-start backlog
  isn't replayed. Streak/level need an analogous **high-water marker**
  (below).
- **`combinedInboxStore`** (≈ line 543): merges every source; new stores
  join its dependency list + spread.
- The **cold-start toast gate** (`sourcesHydrated`, ≈ line 622).

Backing data (all already client-side):

- **Profile** (`userStore.profile`, type `UserProfile`): `dailyStreak`
  (current run: the live field across DashPage / FlowMode / leaderboard /
  flame UI; the bare `streak` field is satellite wire-format only),
  `points`, `level`.
- **Level**: `level = Math.floor(points / 500) + 1`
  ([`profile.services.ts:1173`](../../../../src/lib/services/profile.services.ts)).
  The producer reads the persisted `profile.level`; it does not recompute.
- **Flame stages**:
  [`streak.utils.ts`](../../../../src/lib/utils/streak.utils.ts)
  `stageForStreak(days)` → `spark | ember | flame | blaze | inferno`
  (thresholds 1 / 3 / 7 / 15 / 30), `FLAME_STAGE_LABEL_KEYS`. A milestone
  = a stage threshold crossing (3 / 7 / 15 / 30), aligning with the
  existing `streak_milestone` analytics event and the
  `streak_3 | streak_7 | streak_14 | streak_30` VXP award types.
- **Streak-reminder preference**: `preferences.notify.streakReminder`
  (read via
  [`preferences.store.ts`](../../../../src/lib/stores/preferences.store.ts);
  the field lives under the `notify` slice), defaulting `true`. The streak
  producer respects it (off → no streak cards).
- **Kind config**:
  [`notification-kind.constants.ts`](../../../../src/lib/constants/notification-kind.constants.ts):
  `streak` → `Flame` / `AppPath.Flow`; `level` → `Sparkles` /
  `AppPath.Profile`. Both destinations already sensible; no `mid` needed.
- **i18n**: 13 locale catalogs under
  [`messages/`](../../../../src/lib/constants/messages/); existing
  `inbox.*` keys at `en.ts` ≈ 1055. `npm run check:i18n` gates.

### The high-water marker (the one new mechanism)

`level` and `dailyStreak` are **monotonic counters**. A pure derivation of
"current level is 4" would surface the card _forever_, and a returning user
on a fresh device would see "you reached level 10" replayed. So, mirroring
`settledReadStore`'s intent for monotonic values, add a small persisted
marker:

- `inboxProgressStore`: a writable persisting
  `{ seenLevel: number; seenStreakMilestone: number }` under a new
  `INBOX_PROGRESS_STORAGE_KEY` in
  [`inbox.constants.ts`](../../../../src/lib/constants/inbox.constants.ts)
  (the side-effect-free constants module the identity-storage reconcile
  clears, alongside the other inbox keys).
- **First-observation seeding:** when the profile first hydrates and the
  marker is absent, seed it to the _current_ level / streak-milestone so
  only **future** increases produce cards (no retroactive backlog): the
  level/streak analogue of how `sourcesHydrated` absorbs the
  settled/like backlog into the baseline.
- **A card exists iff** the live value exceeds the marker. Marking the
  card read, dismissing it, or `markAllInboxRead` advances the marker to
  the live value, exactly as `markAllSettledRead` advances
  `settledReadStore`.
- **Streak reset-lowering.** `level` is monotonic, but `dailyStreak`
  resets on a break (`applyDailyStreakBump` → SPARK 1). So the marker is
  not purely seed-once: when the live milestone drops **below**
  `seenStreakMilestone` (the run broke), lower the marker to the current
  milestone, so re-climbing past it re-notifies. The marker only moves up
  on acknowledge (which is what produces the card in the first place).
- **Maintenance host.** Seeding + reset-lowering run in a small
  `initInboxProgress()` subscription mounted from `NotifToastHost`'s
  `onMount` beside `initInboxToasts()` (torn down on destroy), so the
  side-effect only runs while the shell is rendered, not at module scope.
  The card stores themselves stay pure derivations.

## Scope

1. **`streakInboxStore: Readable<InboxNotification[]>`** in
   `inbox.store.ts`, derived from
   `[userStore, preferencesStore, inboxProgressStore, localeStore]`:
   - No card when `preferences.notify.streakReminder === false`, signed
     out, or `dailyStreak` has not crossed a higher milestone than
     `seenStreakMilestone`.
   - When `stageForStreak(dailyStreak)` is a milestone above the marker,
     emit one card: `id = streak-milestone-<milestoneDays>` (stable so the
     read overlay sticks), `kind: 'streak'`, title/body i18n keyed on the
     reached stage + day count, `when` a relative-time string, `unread`
     from the per-id overlay, no `mid` (routes to Flow via the kind
     default).
2. **`levelInboxStore: Readable<InboxNotification[]>`** in
   `inbox.store.ts`, derived from
   `[userStore, inboxProgressStore, localeStore]`:
   - No card when signed out or `profile.level <= seenLevel`.
   - Emit one card for the current level: `id = level-<level>`,
     `kind: 'level'`, title/body i18n with the level number, routes to
     Profile via the kind default.
3. **`inboxProgressStore`** + persistence helpers (load / seed / persist),
   `INBOX_PROGRESS_STORAGE_KEY`, and first-observation seeding wired so a
   returning user gets no retroactive cards.
4. **Merge both stores** into `combinedInboxStore` (dependency list +
   spread) so they count toward the unread badge, the `/notifications`
   list, the toast channel, mark-read, dismiss, and `markAllInboxRead`.
5. **`markInboxRead` / `dismissInboxNotification` / `markAllInboxRead`**:
   advance `inboxProgressStore` for `streak-`/`level-` ids (mirroring the
   `settled-` branch in `markInboxRead`), so acknowledging a card clears it
   durably rather than only overlaying a read flag a later identical id
   would re-surface.
6. **i18n**: add `inbox.streak.*` (per-stage title + body with day count)
   and `inbox.level.*` (title + body with level number) across all live
   catalogs; `npm run check:i18n`. (No seed cleanup: already removed
   upstream.)

### Out of scope

- **The `market` kind.** Owned by the sibling spec. This spec does not
  touch `InboxNotificationKind` or the kind config (the sibling keeps
  `market`, so neither spec deletes it).
- **The mock seed.** Already removed upstream; there is no seed layer left
  to clean up here.
- **`social` / `challenge` kinds.** `social` already has a live producer
  (`likesReceivedInboxStore`); `challenge` is untouched here.
- **Push / OS notifications.** In-app inbox only.
- **Server-side notification docs.** Pure client-side derivation.
- **Recomputing level/points.** Reads the persisted `profile.level`.

## Linked issues

None. Searched the open issues (5 total): none tracks notifications,
inbox, streak, or level. No closing keyword.

## Analytics

**Resolved: no new event.** Opening any inbox card is already covered by
`notification_opened`, whose `label` carries the kind, so `streak` and
`level` opens are sliceable the moment they have producers, with no
taxonomy change. The underlying actions are already instrumented
(`streak_milestone`; level derives from already-tracked `points`).
Reviving these cards adds no behaviour that isn't captured, so this spec
ships no new analytics event.

## Technical requirements (satellite / backend: mandatory)

**No satellite/backend change.** Both producers are pure client-side
derivations over already-loaded profile state + localStorage; no
collection, doc shape, assert, hook, endpoint, or `.did` regeneration.

- **Performance.** Two extra `derived` stores over data already in
  `userStore` + a tiny localStorage marker. No new network calls.
- **Scalability.** O(1) per viewer: at most one streak card and one level
  card. No fan-out.
- **Security.** Reads only the viewer's own profile + viewer-scoped
  localStorage. No new permissions.
- **Upgrade & compatibility.** Additive, client-only, non-breaking.

## Implementation outline

1. Add `INBOX_PROGRESS_STORAGE_KEY` + `inboxProgressStore` (load / seed /
   persist) in `inbox.constants.ts` / `inbox.store.ts`; wire
   first-observation seeding from the hydrated profile.
2. Add `streakInboxStore` (respecting `notify.streakReminder`, gated on
   milestone-vs-marker) and `levelInboxStore` (level-vs-marker), mirroring
   `friendRequestInboxStore`.
3. Merge both into `combinedInboxStore`; extend `markInboxRead` /
   `dismissInboxNotification` / `markAllInboxRead` to advance the marker
   for `streak-`/`level-` ids.
4. Remove the `streak` + `level` seed entries.
5. Add `inbox.streak.*` + `inbox.level.*` keys across all 13 catalogs.
6. Divergence check; flip status to `Implemented (#PR)`; update
   `docs/ai/PRODUCT.md` (inbox surfaces streak milestones + level-ups).
7. `npm run quality` + `npm run check`.

## Acceptance criteria

- [ ] When `dailyStreak` crosses a flame milestone (3 / 7 / 15 / 30), an
      unread `streak` card appears at `/notifications`, taps route to Flow,
      and it counts toward the unread badge.
- [ ] When `notify.streakReminder` is off, no streak card is produced.
- [ ] When profile `level` increases, an unread `level` card appears, taps
      route to Profile, counted in the badge.
- [ ] A returning user on a fresh device / cleared storage sees **no**
      retroactive streak/level card (marker seeds to current on first
      observation); only future increases fire.
- [ ] Marking a streak/level card read (in place, mark-all, or dismiss)
      clears it durably: no reappearance after reload while the underlying
      value is unchanged.
- [ ] No arrival toast replays an existing streak/level backlog on cold
      start.
- [ ] `npm run quality` (incl. i18n) and `npm run check` pass; no satellite
      build needed.

## Pending decisions

None: milestone-only streak trigger decided (see Decisions).

## Decisions

- **Streak trigger is milestone-only** (stage crossings 3 / 7 / 15 / 30),
  not one card per advancing day. Avoids daily-noise and reuses the
  existing milestone vocabulary (`streak_milestone`, `streak_N` awards).
  The mock's "Streak protected" framing is not a separate v1 variant.
- **High-water marker for monotonic values.** Level and streak only climb,
  so a pure derivation would pin a card permanently and replay history on a
  fresh device. A persisted `seenLevel` / `seenStreakMilestone`, seeded to
  current on first observation and advanced on acknowledge, mirrors
  `settledReadStore`'s role for settled events.
- **Respect `notify.streakReminder`.** The preference already gates streak
  nudges; the streak inbox card honours it so the two never disagree.
- **Read the persisted `profile.level`, don't recompute.** The
  points→level formula lives in `profile.services`; duplicating it would
  risk drift.
