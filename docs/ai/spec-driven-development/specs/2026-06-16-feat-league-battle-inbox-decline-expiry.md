# Spec: League battle inbox: surface, decline, expire, and start the clock on accept

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#917)

## Goal

A league owner can see and act on **every** incoming battle challenge:
accept or decline, even while their league already has battles in
flight. Unaccepted proposals no longer pile up forever: a proposal
expires if it isn't answered by its respond-by deadline. And accepting a
challenge is what **starts the competition clock**: the N-day accuracy
window begins at acceptance, not at a date the proposer guessed in
advance. This completes the battle dynamic that
[`2026-06-15-feat-battle-auto-resolution.md`](./2026-06-15-feat-battle-auto-resolution.md)
(#912) started: that spec made resolution real and automatic; this one
makes the **proposal → accept/decline/expire → kickoff** half coherent.

## Context

#912 already shipped the hard part: scores are each league's real
windowed accuracy (`Δwins/Δcalls` from a kickoff baseline), the
satellite re-derives and rejects any falsified result, and a settled
battle auto-resolves lazily on read. What it did **not** address, and
what this spec fixes:

1. **Incoming proposals are masked.** The league detail battle section
   renders a single `activeBattle`, chosen as
   `battles.find((b) => b.state === 'in_flight') ?? battles.find((b) => b.state === 'accepted' || b.state === 'proposed')`:
   [`LeagueDetailPage.svelte:536`](../../../../src/lib/components/pages/LeagueDetailPage.svelte).
   When a league already has an `in_flight` battle, an incoming
   `proposed` challenge is never the selected battle, so the
   `canAcceptBattle` CTA never renders. The proposal is invisible except
   as a dead "PROPOSED" row in the recent-activity feed. This is the
   reported bug: a league with a live battle cannot accept new
   challenges.
2. **No decline.** The only recipient action is Accept; a recipient who
   doesn't want a battle can only ignore it (it sits `proposed`
   forever). `assertSetBattle` has no `proposed → declined` path.
3. **No expiry.** Proposals never time out. `BattleDoc` has no
   respond-by field and no lazy-expire path.
4. **Kickoff is a separate manual step on a guessed window.** The
   proposer picks a duration in
   [`ChallengeLeagueModal.svelte`](../../../../src/lib/components/leagues/ChallengeLeagueModal.svelte)
   (lines 135–136: `kickoffMs = Date.now() + DAY_IN_MS`,
   `settleMs = kickoffMs + duration * DAY_IN_MS`), so the window is fixed
   at propose time and someone must later click "Kick off" once
   `kickoffMs` passes. The fair model is: the window starts when the
   opponent accepts.

Files in scope:

- `src/lib/types/battle.ts`: `BattleDoc`, `BattleState`,
  `BATTLE_TRANSITIONS`, `BATTLE_STATES`. Adds states + two doc fields.
- `src/satellite/services/battle.services.ts`: `assertSetBattle`
  (per-transition auth + the trustless scoring guard). New transitions:
  `proposed → in_flight` (league accept-fuses-kickoff),
  `proposed → declined`, `proposed → expired`.
- `src/lib/services/leagues.services.ts`: `proposeBattle` (767+),
  `acceptBattle` (848+), `kickoffBattle` (905+, folded into accept for
  leagues), `resolveBattle` (974+, unchanged), `retractBattle`. New:
  `declineBattle`, lazy `maybeExpireBattle`.
- `src/lib/components/pages/LeagueDetailPage.svelte`: replace the
  single-slot battle section with an active-battles list + a "Battle
  requests" list (Accept / Decline per row); add the lazy-expire sweep
  alongside the existing `autoResolveAttempted` lazy-resolve
  (line 639).
- `src/lib/components/pages/BattleDetailPage.svelte`: handle the new
  terminal states; decline CTA for the recipient.
- `src/lib/components/pages/BattlesInboxPage.svelte`: already lists
  incoming `proposed` where `sideB === leagueId`; add inline
  Accept / Decline (or keep deep-link) and hide expired/declined.
- `src/lib/components/leagues/ChallengeLeagueModal.svelte` /
  `CreateBoutModal.svelte`: propose a `durationMs` + `respondByMs`
  instead of a precomputed `kickoffMs`/`settleMs`.
- Generated wire layer: `src/satellite/utils/wire-format.utils.ts`,
  `satellite_extension.did`, `src/declarations/**`: regenerated, never
  hand-edited.

Reuse: the **lazy-on-read** pattern is already established by #912's
auto-resolve (`autoResolveAttempted` set +
`resolveBattle` idempotent early-return). Expiry mirrors it exactly.
The accept-stamps-baseline mechanic already exists in `kickoffBattle`
(905–934): we move it onto the accept call.

## Scope

**Concurrency (FE only).** The backend already permits any number of
battles per league: nothing in `assertSetBattle` caps them. Stop
collapsing to one `activeBattle`: render **all** `in_flight` battles and
**all** incoming `proposed` requests. The masking bug is purely the
single-slot `$derived`.

**Decline.** New terminal state `declined`. `proposed → declined` by the
`sideB` owner (the challenged side). FE: a Decline button beside Accept
in each request row. Decline both writes a recent-activity row on both
leagues **and** sends the proposer a notification, because Juno docs
are **not** live-pushed across users (the proposer's client only sees
the `declined` flip on its next read), the notification is what actively
surfaces it. Accept sends the proposer the symmetric "your challenge was
accepted: battle is live" notification through the same mechanism.

**Expiry.** New terminal state `expired` + a `respondByMs` field on
`BattleDoc`. A `proposed` battle whose `respondByMs` has passed is
expired the first time a side owner reads the league/battle (lazy write,
no scheduler: Juno has none). `proposed → expired` allowed by either
side owner once `now >= respondByMs`.

**Accept starts the clock.** The proposer picks a **duration**
(`durationMs`, from the existing 7/14/30 presets); the **respond-by**
deadline (`respondByMs`) is a fixed `now + 3 days` (a named constant, not
exposed in the modal). `kickoffMs` / `settleMs` are **no longer set at
propose time**. On accept, the `sideB` owner transitions a league battle
`proposed → in_flight` in one write: set `kickoffMs = now`,
`settleMs = now + durationMs`, and stamp `baselineA` / `baselineB` from
the current `league_stats` (the same snapshot `kickoffBattle` does
today). The separate manual "Kick off" step is removed for league
battles.

**Concurrency cap (safety rail).** No product-level limit, but a far
upper bound of **100 simultaneous `in_flight` battles per league**
(`BATTLE_MAX_CONCURRENT_IN_FLIGHT`). Enforced **client-side**; the
accept CTA is blocked at the cap, deliberately **not** in the assert: a
server-side count needs a full `listDocsStore` scan (a league appears as
both the `sideA` key prefix and an embedded `sideB`, so no single prefix
catches it) on every accept, which isn't worth the instruction budget
for a bound normal use never approaches.

**State machine (league battles):**

```
proposed ─accept─▶ in_flight ─(auto, #912)─▶ resolved
   │
   ├─decline──▶ declined        (terminal)
   └─expire───▶ expired         (terminal, lazy)
```

### Out of scope

- **Wager escrow.** `wager` is a validated number on the doc but moves
  no VXP anywhere (confirmed: no transfer in services or satellite). No
  refund-on-decline/expire logic is needed because nothing is reserved.
  Real staking is its own future spec.
- **Duels.** No FE path creates `kind='duel'` battles; they stay on the
  existing `proposed → accepted → in_flight → resolved` manual-score
  path. New `declined`/`expired` transitions apply to both kinds for the
  proposal phase, but the accept-fuses-kickoff change is league-only.
- **Server-side enforcement of the concurrency cap**: the 100-battle
  rail is a client-side guard only (see the cap note above).
- **Cross-device dismissal** of the battles intro card (still
  localStorage, unchanged).

## Linked issues

Search the repo's open issues before finalizing (none confirmed yet,
see open questions). If a "can't accept league challenge" issue exists,
close it; otherwise state none.

## Analytics

Instrument the new user actions. Existing taxonomy
(`src/lib/types/analytics-event.ts` 135–140) already has
`battle_proposed`, `battle_accepted`, `battle_resolved` and a
`battleId` prop.

- Add **`battle_declined`**: user action; props: `battleId`. Goes in
  **both** the TS union (`analytics-event.ts`) and the Zod mirror
  (`src/lib/schema/analytics-event.schema.ts`); capture via `track` in
  `analytics.services.ts`.
- **`battle_expired`**: system-driven (lazy, not a tap). Proposed as
  optional; if we want expiry volume visible, add it the same way and
  fire it from the lazy-expire writer. Default: include it, since a
  proposal dying silently is otherwise invisible to product.
- No new free-form props; `battleId` is bounded id data, no PII.

## Technical requirements (satellite / backend, mandatory)

- **Performance.** No new endpoints; all transitions stay client
  `setDoc` + `assertSetBattle`. The assert already does up to ~4
  `getDocStore` cross-collection reads (league, members, league_stats ×2)
  per battle write; decline/expire add a strictly cheaper subset (no
  baseline reads). Lazy-expire piggybacks on the existing
  league/battle-detail read path: one extra `setDoc` per stale proposal,
  once.
- **Memory & storage.** Two new optional `BattleDoc` fields
  (`durationMs`, `respondByMs`: `number`). Two new `BattleState`
  variants. No new collection. Terminal `declined`/`expired` rows are
  retained as history like `resolved` (or pruned, see pending
  decisions); growth is bounded by battle volume, same order as today.
- **Scalability.** Surfacing all proposals is a client-side filter over
  the already-loaded `leagueBattlesStore` list: no new fan-out. At 10×
  battles per league the request list is still a short filtered render.
- **Upgrade & compatibility.** `BattleState` gains `declined` /
  `expired` and `BattleDoc` gains two fields → the satellite wire format
  (`wire-format.utils.ts`), `satellite_extension.did`, and
  `src/declarations/**` regenerate via `npm run juno:functions:build`
  (commit the result; the `state` Candid variant is **hash-sorted**:
  regenerate, never hand-place). This is a Candid surface change:
  FE reads must tolerate the new variants. **Legacy `proposed` rows**
  (written pre-spec, with a real `kickoffMs`/`settleMs` and no
  `respondByMs`/`durationMs`): on read, fall back `respondByMs ←
kickoffMs` (their old "starts tomorrow") so they expire sanely, and on
  accept set the window from `settleMs - kickoffMs` as the implied
  duration. Decide breaking-vs-not per `pr-and-ci.md` §1 (new enum
  variants on a read surface are typically non-breaking for additive
  consumers, but confirm against the generated `.did`).
- **Security.** `BATTLES` collection rules unchanged (`read: public`,
  `write: public`; the assert owns auth). New transition auth:
  `proposed → declined` requires the `sideB` owner; `proposed → expired`
  requires a side owner **and** `now >= respondByMs`;
  `proposed → in_flight` (league) requires the `sideB` owner, stamps +
  re-validates baselines exactly as the current `accepted → in_flight`
  guard does, and pins `kickoffMs ≈ now` / `settleMs = kickoffMs +
durationMs` server-side so the recipient can't backdate the window.
- **Concurrency-cap cost.** The 100-in-flight rail is **client-side**
  only. A server-side count would need a full `listDocsStore` scan per
  accept (a league appears as both the `sideA` key prefix and an
  embedded `sideB`, so no single prefix catches it), not worth the
  instruction budget for a far rail. Documented as a known gap.
- **Notifications: no satellite change.** There is no notifications
  collection; the inbox is client-derived (the friend-request /
  like-received pattern). The proposer already loads their battles via
  `listMyBattles`, so a decline/accept card is derived from the battle
  doc's own state + `respondedAtMs` in `inbox.store.ts`: no
  cross-principal write, no new collection.
- **Parameters.** Duration presets and any default respond-by window
  live as named constants (extend the battle constants in
  `src/lib/types/battle.ts` / `app.constants.ts`); don't restate values
  here.

## Implementation outline

1. **Types** (`battle.ts`): add `'declined' | 'expired'` to
   `BattleState` + `BATTLE_STATES`; add `durationMs?`, `respondByMs?` to
   `BattleDoc`; update `BATTLE_TRANSITIONS`:
   `proposed: {accepted, in_flight, declined, expired}`,
   `accepted: {in_flight}` (duel only), terminals empty.
2. **Assert** (`battle.services.ts`): add the three transition branches
   with the auth + window/baseline rules above; keep the existing
   `accepted → in_flight` and `in_flight → resolved` branches for duels /
   legacy.
3. **FE services** (`leagues.services.ts`): fold baseline-stamping +
   window-setting into `acceptBattle` for league battles (reusing
   `readLeagueStatsBucket`); add `declineBattle`; add idempotent
   `maybeExpireBattle` (mirror `resolveBattle`'s early-return);
   `proposeBattle` takes `durationMs` + `respondByMs`.
4. **League detail** (`LeagueDetailPage.svelte`): replace the single
   `activeBattle` slot with (a) an active-battles list and (b) a "Battle
   requests" list with Accept / Decline per incoming `proposed` row;
   add a lazy-expire sweep next to `autoResolveAttempted`.
5. **Battle detail + inbox**: render `declined`/`expired`; recipient
   Decline CTA; `BattlesInboxPage` inline actions + hide terminal rows.
6. **Propose modals**: pass `durationMs` + `respondByMs`; drop the
   precomputed kickoff/settle.
7. **Regenerate** wire/did/declarations; run `npm run quality`,
   `npm run check`, `npm run juno:functions:build`.
8. **PRODUCT.md**: update the battle section to describe the full
   dynamic (propose → accept/decline/expire → live → auto-resolve).

## Acceptance criteria

- [ ] A league with an `in_flight` battle still shows every incoming
      `proposed` challenge with a working Accept and Decline.
- [ ] Declining a proposal moves it to `declined`; it leaves the
      requests list and cannot be accepted afterward.
- [ ] A `proposed` battle past `respondByMs` becomes `expired` the next
      time a side owner opens the league or battle; expired proposals
      can't be accepted.
- [ ] Accepting a league challenge starts the window at acceptance:
      `kickoffMs ≈ now`, `settleMs = now + durationMs`, baselines
      stamped, state `in_flight`, no separate kickoff tap.
- [ ] The satellite rejects: a non-`sideB` decline; an expire before
      `respondByMs`; an accept that backdates the window or fakes
      baselines.
- [ ] Declining notifies the proposer and writes an activity row on both
      leagues; accepting fires the symmetric notification.
- [ ] The assert rejects accepting a 101st simultaneous `in_flight`
      battle for a league (far abuse rail).
- [ ] `battle_declined` (and `battle_expired` if kept) fire and validate
      against the Zod mirror.
- [ ] Generated `.did` / declarations are regenerated and committed;
      `npm run quality` + `npm run check` pass.

## Open questions

Resolved during the build:

- **Generated `state` Candid variant**: regenerated via
  `npm run juno:functions:build`; `svelte-check` passes against the new
  declarations, so the added `declined` / `expired` members decode
  cleanly.
- **Notification mechanism**: there is no notifications collection; the
  inbox is client-derived. No cross-principal write is needed (resolved
  in the technical-requirements note).
- **Concurrency-cap counting**: resolved by keeping the cap client-side
  (see the cap note); no assert scan.

Still to verify against production data (no code dependency):

- Legacy `proposed` rows (e.g. the 6/8, 6/11 proposals): the
  `respondByMs ← kickoffMs` fallback should expire them at their old
  kickoff; confirm once deployed.
- No open GitHub issue was found for "can't accept a league challenge".

## Decisions

Resolved with the product owner during spec authoring (2026-06-16):

- **Concurrency:** fully concurrent, multiple live battles per league.
  Backend already supports it; this spec only fixes FE rendering. Far
  abuse rail at **100** simultaneous `in_flight` battles per league.
- **Decline:** yes, explicit recipient Decline → terminal `declined`.
  Surfaced **both** ways: a recent-activity row on both leagues **and** a
  notification to the proposer (Juno isn't live across users, so the
  notification is what actively reaches them). Accept fires the
  symmetric notification.
- **Expiry:** yes, proposals auto-expire at `respondByMs` (lazy, no
  scheduler). `respondByMs` is a **fixed `now + 3 days`** (named
  constant, not user-adjustable).
- **Clock start:** at acceptance, N-day duration runs from accept;
  accept fuses the old kickoff (stamps baselines, sets the window).
- **Terminal-row retention:** keep `declined`/`expired` as history like
  `resolved`, bounded by the existing recent-activity row cap: no
  prune logic.
- **Resolution / real accuracy scoring:** already shipped by #912, not
  re-specced here; this spec builds on it.
- **Slicing:** one spec, one PR (per workflow) covering all of the
  above.
