# Spec: Battle opponent notification — tell the challenged league's admin a face-off is waiting

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#986)

## Goal

When a league owner challenges another league to an accuracy face-off,
the **challenged** league's admin gets an inbox notification — "{from}
challenged your league to a {days}-day accuracy face-off" — that
deep-links straight to the battle so they can accept or decline. Today
the challenger gets a notification when the opponent responds, but the
opponent gets nothing when the challenge first lands: an incoming
proposal is silent unless they happen to wander into Battles or the
league detail. This closes that asymmetry — the inbound side of the
battle dynamic finally pings.

## Context

The inbox is **client-derived** — there is no notifications collection,
no cross-principal write. `src/lib/stores/inbox.store.ts` builds cards
from live data the viewer can already read (friend requests, settled
positions, likes received, battle responses), and
`combinedInboxStore` merges them. The bell badge
(`combinedInboxUnreadCount`), the Notifications page
(`src/routes/(app)/notifications/+page.svelte` →
`src/lib/components/pages/NotificationsPage.svelte`), and the
slide-in toast (`initInboxToasts` → `NotifToastHost`) all read from
that one store.

`battleInboxStore` (inbox.store.ts:97) already derives battle **outcome**
cards — but only for the **proposer**: it filters
`battle.proposer === viewer && (state === 'in_flight' || state === 'declined')`
and deep-links to the proposer's league. There is no card for the
**recipient** of a still-`proposed` challenge. That is exactly the gap.

The data needed for the recipient card is **already loaded client-side**.
`leagueBattlesStore` (`src/lib/stores/leagues.store.ts:39`) is a
`Map<leagueId, BattleDoc[]>` hydrated for every league the caller
belongs to via `listLeagueBattles` — and the satellite endpoint
`listLeagueBattlesFn`
(`src/satellite/services/cohort.services.ts:218`) returns every battle
referencing the league as **either** `sideA` **or** `sideB`. So a
`proposed` battle where the caller's league is the challenged side
(`sideB`) is already in the store. `BattlesInboxPage`
(`src/lib/components/pages/BattlesInboxPage.svelte:99`) proves the exact
derivation works today:

```
myLeaguesStore
  .filter((m) => m.role === 'owner')
  .flatMap(...battles for that league...
    .filter((b) => b.kind === 'league' && b.state === 'proposed' && b.sideB === m.league.id))
```

This spec lifts that same filter into `inbox.store.ts` as a new derived
store so the existing bell / toast / Notifications-page surfaces light
up — **no satellite change**.

Patterns to reuse (all already in `inbox.store.ts`):

- The `battleInboxStore` shape (id, kind, title/body via `t(...)`,
  `when` via `formatRelativeAgoFromNs`, `href` deep-link) — the new
  store mirrors it.
- `leagueDirectoryStore` (`src/lib/stores/league-directory.store.ts`) +
  `shortLeagueId` (`src/lib/utils/format.utils.ts:447`) to name the
  challenging league (`sideA`), same as the response card names `sideB`.
- The `{days}` duration is the window length already computed elsewhere:
  `Math.max(1, Math.ceil((settleMs - kickoffMs) / DAY_IN_MS))`
  (`BattlesInboxPage.svelte:122`, `DAY_IN_MS` from
  `#lib/constants/app.constants.ts`).
- `notificationDestination` / `NOTIFICATION_KIND_CONFIG`
  (`src/lib/constants/notification-kind.constants.ts`) — every kind
  needs one entry. The deep-link is the league detail
  (`${AppPath.Arena}/leagues/${sideB}`), where the owner accepts —
  matching the existing battle-response card's `href` form.
- The per-id read overlay + dismissed set already cover any card whose
  id isn't a `settled-…` id, so the new card gets mark-read /
  dismiss / mark-all-read for free.

## Scope

Add a **recipient-side incoming-challenge** inbox card, client-derived,
delivered through the existing inbox plumbing.

1. **New derived store** `battleIncomingInboxStore` in `inbox.store.ts`,
   sourced from `[leagueBattlesStore, myLeaguesStore,
leagueDirectoryStore, userStore, localeStore]`. For each league the
   viewer **owns** (the admin), emit one card per `proposed`,
   `kind='league'` battle where `sideB === league.id` (the league is the
   challenged side). Card:
   - `id`: `battle-proposed-${battle.id}` (stable per proposal;
     mark-read / dismiss stick across reloads).
   - `kind`: new `'battle_incoming'`.
   - `title` / `body`: new i18n keys `inbox.battle_incoming.title` /
     `inbox.battle_incoming.body`, params `{ opponent, days }`. Opponent
     = `sideA` league name from `leagueDirectoryStore` (fallback
     `shortLeagueId(sideA)`); `days` = window length per the reuse note.
   - `when`: `formatRelativeAgoFromNs` from `kickoffMs` (proposal time —
     `proposed` rows carry the provisional window stamped at propose).
   - `href`: `${AppPath.Arena}/leagues/${battle.sideB}` (the recipient's
     own league detail, where the Accept / Decline CTA lives).
   - Aged out by a window mirroring `BATTLE_NOTIFICATION_WINDOW_MS`
     (3 days) so a long-lived proposal can't pin the bell forever — and
     it naturally drops when the proposal leaves `proposed` (accepted /
     declined / expired) since the filter no longer matches.
2. **Merge** `battleIncomingInboxStore` into `combinedInboxStore`
   (inbox.store.ts:466) — placed with the other battle cards. The
   unread-count, toast diff, mark-read, dismiss, and mark-all-read paths
   all already operate on the combined list, so no other store wiring
   changes.
3. **Type** (`src/lib/types/inbox.ts`): add `'battle_incoming'` to
   `InboxNotificationKind`.
4. **Kind config** (`notification-kind.constants.ts`): add
   `battle_incoming: { icon: Swords, dest: AppPath.Arena, label:
'Battle challenge' }`.
5. **i18n** (`src/lib/constants/messages/*.ts`, all locales): add
   `inbox.battle_incoming.title` and `inbox.battle_incoming.body` to
   **every** catalog under `src/lib/constants/messages/` (per AGENTS.md
   §3 — never just `en.ts`). Copy lives in the app's `inbox.*` namespace:
   - title — "New league challenge"
   - body — "{opponent} challenged your league to a {days}-day accuracy
     face-off."
     (No "Tap to respond." tail — the card is tappable and the other
     inbox bodies don't narrate the tap.)
6. **Analytics** — see the Analytics section.

### Out of scope

- **Cross-session push / server-authoritative delivery.** The card is
  client-derived: it appears the next time the recipient's client reads
  their leagues' battles (app open / leagues refresh), exactly like the
  existing friend-request and battle-response cards. True push (write a
  notification at proposal time so it arrives without the recipient
  re-reading) is a deliberate non-goal here — see Pending decisions for
  the build-vs-defer call and its sizing. No notifications collection,
  no satellite write. Delivery is same-session client-only.
- **Duels** (`kind='duel'`). No FE path creates duels and they have no
  challenged-league admin; the filter is `kind='league'` only.
- **Changing the proposer-side cards** (`battle_accepted` /
  `battle_declined`) — untouched.
- **Inline Accept / Decline from the notification.** The card
  deep-links to the league detail where those CTAs already live
  (shipped by #917); it does not add new action buttons.
- **Expired / declined recipient cards.** Only a live `proposed`
  challenge is actionable; terminal states surface in Battles / league
  detail, not the inbox.

## Linked issues

Searched `ViciApp/vici-app` open issues for "battle",
"notification", "challenge", "opponent" — no related issue found. No
related issue.

## Analytics

The card is a **derived view of existing data**, not a new user action,
so no new _write_ event is warranted. The meaningful behavioural signal
is whether the notification drives the recipient to the battle — and
that is already captured downstream: tapping the card lands on the
league detail, where Accept fires `battle_accepted` and Decline fires
`battle_declined` (`src/lib/types/analytics-event.ts:137–140`, mirrored
in `src/lib/schema/analytics-event.schema.ts`). The proposal itself
already emits `battle_proposed` on the challenger's side.

No new event name, no taxonomy change, no Zod-mirror edit. Rationale
recorded here so the omission reads as considered, not skipped: the
inbox today does not instrument per-card _impressions_ for any kind
(friend requests, settled, likes), and adding impression tracking for
one card type alone would be inconsistent and low-value. If, later, the
team wants notification-funnel analytics, it should land as one event
across **all** inbox kinds, not bolted onto this card — out of scope
here.

## Implementation outline

1. **Type** (`src/lib/types/inbox.ts`): add `'battle_incoming'` to the
   `InboxNotificationKind` union.
2. **Kind config**
   (`src/lib/constants/notification-kind.constants.ts`): add the
   `battle_incoming` entry (`Swords`, `AppPath.Arena`,
   label `'Battle challenge'`).
3. **Derived store** (`src/lib/stores/inbox.store.ts`): add
   `battleIncomingInboxStore` per Scope §1, modelled on
   `battleInboxStore` (reuse `leagueDirectoryStore`, `shortLeagueId`,
   `formatRelativeAgoFromNs`, the 3-day window constant, and the
   `${AppPath.Arena}/leagues/${id}` href form). Dedupe by battle id
   (a battle can't appear under two owned leagues for the same side,
   but keep the `new Map(...)` guard the response store uses).
4. **Merge** into `combinedInboxStore` (inbox.store.ts:466) and its
   derived input list — drop `battleIncomingInboxStore` into the spread
   beside `$battles`. Nothing else changes: `combinedInboxUnreadCount`,
   `initInboxToasts`, `markInboxRead`, `dismissInboxNotification`, and
   `markAllInboxRead` all already operate over the combined list.
5. **i18n**: add `inbox.battle_incoming.title` /
   `inbox.battle_incoming.body` to **every** locale catalog under
   `src/lib/constants/messages/` (en, plus each other `SUPPORTED_LOCALES`
   entry from `#lib/constants/locale.constants`). `pt-BR` falls back to
   EN per the existing battle keys if no localized copy is supplied.
6. **Quality gates**: `npm run quality` (format + lint + i18n catalog
   parity via `npm run check:i18n`) and `npm run check`
   (svelte-check). No satellite build — this PR touches no
   `src/satellite/**`.
7. **PRODUCT.md**: extend the battle / notifications description to note
   the recipient now gets an incoming-challenge inbox card (the
   proposer-response cards are already described).

## Acceptance criteria

- [ ] When league B is challenged by league A, the owner/admin of
      league B sees an inbox card "{A} challenged your league to a
      {days}-day accuracy face-off" with the correct day count, the bell
      badge increments, and a new-arrival toast fires (subject to the
      existing toast-hydration gate).
- [ ] Tapping the card deep-links to league B's detail page, where the
      Accept / Decline CTA is shown.
- [ ] The card disappears once the proposal leaves `proposed` (accepted,
      declined, or expired) and once it ages past the 3-day window.
- [ ] The challenger (proposer) does **not** see the incoming card for
      their own challenge; they continue to get only the response cards.
- [ ] A non-owner member of league B does **not** see the card (only the
      admin/owner).
- [ ] Mark-read, swipe-dismiss, and mark-all-read work on the card and
      persist across reload (per-id read/dismissed overlay).
- [ ] The card body and title are present in every locale catalog;
      `npm run check:i18n` passes.
- [ ] `npm run quality` and `npm run check` pass. No `src/satellite/**`,
      `.did`, or `src/declarations/**` change.

## Open questions

- **Recipient identity = league owner only?** The codebase models the
  admin as `league.owner` (the satellite assert authorizes accept by
  `sideB` owner; `BattlesInboxPage` filters `role === 'owner'`). The
  challenged league's admin is its owner. Confirm the app has no separate
  `adminId` distinct from `owner` for leagues — if owner is the admin (as
  the code indicates), filter on `role === 'owner'`. (Strongly expected to
  be owner; verify there is no admin-role split before build.)

## Pending decisions

- **Build now vs. defer the recipient card (the crux).** Three options
  were considered for _how_ the recipient learns of an incoming
  challenge:
  - **(a) Client-side derive (RECOMMENDED — this spec).** Derive the
    card in `inbox.store.ts` from the `proposed` battle docs the
    recipient admin **can already read** (`leagueBattlesStore`, populated
    via `listLeagueBattlesFn`, which returns `sideB` battles too).
    **Cost:** ~1 new derived store + 1 union member + 1 kind-config
    entry + 2 i18n keys. **No collection, no satellite write, no Candid
    change.** Matches the established inbox pattern exactly (friend
    requests, battle responses are all client-derived). **Limitation:**
    delivery is "next read", not push — the card appears when the
    recipient's client next loads their leagues' battles, not the instant
    the challenge is sent. Acceptable: it is identical to how every other
    inbox card already behaves, and same-session client-only delivery is
    the established behaviour for this surface.

  - **(b) Server-authoritative notification.** Write a notification doc
    at proposal time so it arrives without the recipient re-reading.
    **Cost (sizing):** a **new `notifications` collection** in
    `juno.config.ts` **and** the typed `Collection` enum
    (`src/lib/constants/collections.constants.ts`) — the two must stay
    in sync (`.claude/rules/juno.md`); a doc shape + wire format; an
    `assertSetNotification` guard (cross-principal write — the proposer
    writes a doc _the recipient owns/reads_, which the satellite must
    authorize without letting anyone spam arbitrary principals — a
    non-trivial auth model); collection read/write rules; a FE read
    path/store; regenerated `satellite_extension.did` +
    `src/declarations/**` via `npm run juno:functions:build`; a
    retention/cleanup story (notification docs accrue unbounded). This is
    a **multi-file satellite change with a new Candid surface and a
    novel cross-principal write-authorization model** — clearly its own
    larger spec, not foldable into this one. Recommend **defer**.

  - **(c) Defer entirely (tech debt).** Ship nothing; recipients keep
    discovering challenges only via the Battles tab / league detail.
    Rejected: option (a) closes the gap cheaply and consistently with
    the existing inbox, so there's no reason to carry the debt.

  **Recommendation: build (a) now.** The recipient admin can already
  read the `proposed` battle (`listLeagueBattlesFn` returns `sideB`
  rows; `BattlesInboxPage` already derives exactly this list), so the
  cheapest correct delivery is a client-side derive through the existing
  inbox — no new collection, no satellite write. Escalate to (b) only if
  product later requires instant cross-device push _before_ the
  recipient's next read; that is a separate, larger satellite spec
  (sized above), explicitly out of scope here.

- **Toast on cold-start backlog.** `initInboxToasts` gates arrival
  toasts behind `sourcesHydrated` (resolved positions + friend relations
  - received reactions). The new card's source (`leagueBattlesStore`)
    is **not** in that gate, so a cold-start backlog of pending challenges
    could replay as toasts on first hydrated tick. Decide whether to add
    `leaguesLoadedStore` to the `sourcesHydrated` derivation so the
    existing-proposals backlog is absorbed into the baseline rather than
    toasting. (Recommended: yes — add `leaguesLoadedStore` to the gate,
    mirroring how the other async sources are gated.)

## Decisions

Handed to this spec at authoring (2026-06-25):

- **Namespace:** keep the app's `inbox.*` i18n namespace
  (`inbox.battle_incoming.title` / `.body`), consistent with the other
  inbox keys.
- **No emoji.** The card uses the lucide `Swords` icon via the kind
  config, matching the existing battle cards.
- **Derive from persisted state.** The card is derived from the
  persisted `proposed` battle state, not fired imperatively on send — the
  same user-visible outcome (an incoming-challenge notification
  deep-linking to the bout) through the app's client-derived inbox
  architecture.
- **Recipient delivery model:** client-side derive (option (a)) — see
  Pending decisions for the build-vs-defer rationale and the sizing of
  the server-authoritative alternative.
- **One spec, one PR.** Pure-frontend; no `src/satellite/**` change, so
  no Technical-requirements section is required (per workflow §
  "Required content by area").
