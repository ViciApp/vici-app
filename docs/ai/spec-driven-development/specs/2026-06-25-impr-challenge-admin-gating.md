# Spec: Challenge admin-gating: a league admin (not only the owner) can initiate and respond to battles, plus an owner-driven promote-to-admin control

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#985)

## Goal

A league **admin** (not just the owner) can start a battle, accept or
decline an incoming challenge, and (during the proposal window) retract
one. Today the owner is the only principal who can run any of these,
even though the `LeagueMemberRole` model already carries a distinct
`'admin'` role for exactly this kind of delegated authority. Non-admins
(plain members) keep no challenge powers and now see an explicit reason:
"Only a league owner or admin can start a battle.", instead of an
unexplained absent CTA.

So the new authority is actually reachable, this spec **also ships the
owner-only promote-to-admin / demote-to-member control** in the league
members UI: without it, admin-gating would be inert because no FE path
currently creates an `admin` row (the satellite already permits the
write; only the UI is missing). The two pieces are one feature: the
gating predicate and the means to grant the role it gates on.

## Context

Battle authority is a delegated role, not just an ownership property. The
app's membership model already carries the distinction:
`LeagueMemberRole = 'owner' | 'admin' | 'member'`
(`src/lib/types/league-member.ts`), with `owner` unique and `admin` a
day-2 delegated role. The design lets the `admin` role do what the owner
does for battles: initiate and respond, **in addition to** the owner,
while a plain member sees an explicit "Only a league owner or admin can
start a battle." in place of a silently absent CTA.

Current app state (gates everything on `owner`):

- `src/lib/components/pages/LeagueDetailPage.svelte`:
  `canChallenge = myRole === 'owner'` (line ~159); `canRespondToBattle`,
  `canKickoffBattle` (lines ~658–668) gate on `myRole === 'owner'`; the
  deep-link `?challenge=1` effect (~138) and the `CreateBoutModal` /
  challenge-CTA render guards (~1497, ~1532, ~1597) all key off
  `canChallenge`. The `'admin'` role is rendered (the
  `leagues.detail.battle_admin_chip` "Admin · you" chip, the
  `LeagueRoleBadge`) but grants **no** battle power.
- `src/lib/components/leagues/CreateBoutModal.svelte`: `load()` filters
  `ownedLeagues = mine.filter((m) => m.role === 'owner')` (line ~147);
  the doc comments assert "only the leagues the caller owns can send a
  challenge (the satellite assert hard-rejects non-owners)".
- `src/satellite/services/battle.services.ts`: `assertSetBattle`'s
  `isOwnerOfLeague(leagueId)` helper resolves auth as
  `decodeDocData<LeagueDoc>(...).owner === callerText` (lines ~199–218).
  `isSideOwner` → `isOwnerOfLeague` for `kind='league'`. This gate is
  hit on **creation** (sideA owner check, ~299), **accept**
  (`proposed → in_flight`, sideB owner, ~414), **decline**
  (`proposed → declined`, sideB owner, ~452), and **expire** (sideA/sideB
  owner, ~468). **This is the load-bearing finding: the satellite, not
  just the FE, enforces owner-only, so admin-gating is a backend change,
  not FE-only.**
- `src/lib/services/leagues.services.ts`: `proposeBattle` (~789),
  `acceptBattle` (~899), `declineBattle` (~949), `maybeExpireBattle`
  (~981) are thin write helpers; the assert owns auth, so they need no
  role logic, only the upstream FE guards must widen.

Reuse (per `docs/ai/frontend/reusability.md` and existing code):

- The role-aware UI already exists: `LeagueRoleBadge.svelte`, the
  `battle_admin_chip`, and `canSeeInvite = owner || admin` (the
  precedent that an admin already shares an owner affordance). The new
  gate is the same boolean shape: `myRole === 'owner' || myRole ===
'admin'`.
- The member assert (`src/satellite/services/league-member.services.ts`)
  already lets the **owner** promote a member to `admin` (role change
  requires the league owner, lines ~132–136: `currentDoc.role !==
proposedDoc.role && !callerIsOwner` is the only role-change gate) and
  validates the `admin` role, so the `admin` role is a real, reachable
  state in the data model, and the promote-to-admin write this spec adds
  is **plain FE wiring (a `setDoc` to `LEAGUE_MEMBERS`), no assert
  change**. Verified: `role: 'admin'` is set nowhere in
  `src/lib/components` or the league services today, so no promote UI
  ships yet: this spec adds it.
- Battle analytics taxonomy (`src/lib/types/analytics-event.ts` ~135–140)
  already has `battle_proposed` / `battle_accepted` / `battle_declined`
  and a `leagueId` prop.

## Scope

Two coupled changes:

1. Widen the "can act as this league in a battle" authority from
   **owner-only** to **owner-or-admin**, on both the frontend gates and
   the satellite assert, keeping the trustless resolution model
   untouched.
2. Add an **owner-only promote-to-admin / demote-to-member control** in
   the league members UI so the role the gate keys on is reachable from
   the app. This is FE-only: the `league_members` assert already gates
   role changes on the league owner, so the owner can already write
   `role: 'admin'` (and back to `'member'`): only the UI is new.

**Satellite (`assertSetBattle`).** Introduce a single membership-role
helper: `isOwnerOrAdminOfLeague(leagueId)`, that returns true when the
caller is the league owner (current `LeagueDoc.owner` check) **or** holds
an `admin` role row in `league_members` (`getDocStore` on
`leagueMemberKey({ leagueId, memberPrincipal: callerText })`, decode,
`role === 'admin'`). Replace the owner check in the battle **command**
transitions with it:

- creation: sideA proposer must be owner-or-admin of sideA;
- `proposed → in_flight` (league accept): sideB caller must be
  owner-or-admin of sideB;
- `proposed → declined`: sideB caller must be owner-or-admin of sideB;
- `proposed → expired`: caller must be owner-or-admin of sideA or sideB;
- same-state proposed edits: keep proposer-binds-caller (unchanged: the
  proposer is by definition whoever created it, already an admin/owner).

**Out of band, intentionally unchanged:** `in_flight → resolved` already
allows **any member of either side** (it is trustless: the assert
re-derives scores), so it is strictly more permissive than admin and
needs no change. `accepted → in_flight` (duel/legacy kickoff) and the
duel paths use `isSideOwner` where `kind='duel'` resolves to a bare
principal compare: those are duels, not leagues, and stay as-is. The
**delete/retract** path (`assertDeleteBattle`) stays **proposer-only**:
an admin who didn't create a proposal does not get to retract a peer
admin's; the proposer binds (matches the existing comment "neither
opponent nor admin gets a delete path").

**Frontend.**

- `LeagueDetailPage.svelte`: add a single derived
  `isLeagueAdmin = myRole === 'owner' || myRole === 'admin'` and route
  `canChallenge`, `canRespondToBattle`, `canKickoffBattle`, and the
  `?challenge=1`/`?propose=1` deep-link effect through it. The lazy
  **expire** sweep (currently `myRole !== 'owner'` early-return, ~852)
  widens to owner-or-admin to match the assert. The `battle_admin_chip`
  ("Admin · you") shows whenever `isLeagueAdmin`.
- `CreateBoutModal.svelte`: `load()` filters the challenger leagues to
  `m.role === 'owner' || m.role === 'admin'`; update the doc comments
  (which currently say "only the leagues the caller owns") and the
  no-leagues empty-state copy ("you must own a league to challenge" →
  "you must own or admin a league").
- **Gating copy.** Replace the silent absence of the challenge CTA for
  non-admins with an explicit line. Reuse the app i18n namespace
  (`leagues.*`). The app supports multiple admins plus an owner, so the
  copy is "owner or admin", not "the league admin". New key
  `leagues.detail.battle_admin_only` = "Only a league owner or admin can
  start a battle." rendered in the battle section when `!isLeagueAdmin`.
  The existing `leagues.detail.battle_owner_accepts` ("Only the league
  owner can accept this challenge.") is reworded to "Only a league owner
  or admin can accept this challenge." (key kept, value updated).

**Promote-to-admin / demote-to-member control.** The member detail
bottom-sheet in `LeagueDetailPage.svelte` (the `openMember` sheet, ~1636)
already shows a tapped member's role badge and stats; it is the natural
home for the action: it sits next to the existing owner-only affordances
and avoids a new surface. Render the control **only when `myRole ===
'owner'`** and the opened member is **not** the owner and **not** the
caller. For an `openMember.role === 'member'` show "Make admin"; for
`'admin'` show "Remove admin" (demote to `'member'`). Wire it to a new
thin service helper in `src/lib/services/leagues.services.ts`:
`setMemberRole({ leagueId, memberPrincipal, role })`, that re-reads the
member doc and writes it back via `@junobuild/core` `setDoc<LeagueMemberDoc>`
with the new `role` and the existing immutable identity fields
(`leagueId`, `member`, `joinedAtMs` unchanged), mirroring the `joinLeague`
write shape (~618–629). On success reload the roster (the existing
post-write reload path, e.g. the one `onTransferDone` uses, ~434) so the
badge and battle gates re-derive. The satellite assert is the
authority: a non-owner caller is rejected server-side regardless of the
UI guard.

### Out of scope

- **Transfer / privacy / rename / image** affordances: stay owner-only
  (`canTransfer`, `canEditPrivacy`, `canRename`, `canEditImage`
  unchanged). This spec is battle-authority only.
- **Duels** (`kind='duel'`): bare-principal auth, untouched.
- **Retract by a non-proposer admin**: deliberately not allowed (see
  Scope).
- **Resolution authority**: already any-member, unchanged.

## Linked issues

Searched open issues on `ViciApp/vici-app` for
"league admin battle challenge" and "admin role": **no related issue**
found. (Search terms: `league admin battle challenge`, `admin role`.)

## Analytics

No **new** event names. The change widens _who_ can fire existing
events, not _what_ fires. To make the owner-vs-admin split visible in
product analysis, **add an actor-role dimension to the battle action
events** by reusing the existing bounded `label` prop (no schema change:
`label` already exists in both `AnalyticsEventProps` and the Zod
mirror):

- `battle_proposed`: already carries `label: scope` in
  `CreateBoutModal` (`label: scope`). It cannot also carry the actor
  role without overloading one bounded field; **leave `battle_proposed`
  as-is** (scope is the more valuable cut) and instead rely on the
  existing `leagueId` to join against membership offline if role-of-
  proposer is ever needed. No change.
- `battle_accepted` / `battle_declined`: these do **not** currently set
  `label`. Optionally set `label` to the actor's role
  (`'owner' | 'admin'`) where the handler already knows `myRole`
  (`LeagueDetailPage` handlers). Bounded two-value vocabulary, behavioural,
  no PII. **Pending decision** below, default: include, since the whole
  point of the spec is the owner/admin split and it is otherwise
  invisible.

No new event name lands, so no edit to `src/lib/types/analytics-event.ts`
or `src/lib/schema/analytics-event.schema.ts` is required unless the
pending decision adds the role `label` (which reuses an existing prop and
still needs no schema edit). Capture stays via `track` in
`src/lib/services/analytics.services.ts`.

## Technical requirements (satellite / backend, mandatory)

This change touches `src/satellite/services/battle.services.ts` and reads
the `league_members` collection during the battle assert.

**Promote-to-admin write: no satellite change.** The promote/demote
control writes the **existing** `LEAGUE_MEMBERS` doc with a changed
`role` field. The collection rule (`LEAGUE_MEMBERS`,
`collections.constants.ts` ~59–65) is untouched, and `assertSetLeagueMember`
already permits exactly this write: role transitions on an existing row
are owner-gated (lines ~132–136), identity fields stay immutable. **No
Candid / `satellite_extension.did` change**: it is a plain document
field write through `@junobuild/core` `setDoc`, not a new endpoint or
shape. Confirmed: the only role-change gate in the assert is
`currentDoc.role !== proposedDoc.role && !callerIsOwner`, which this UI
satisfies by construction (owner-only control) and which the satellite
re-enforces.

- **Performance.** The creation, accept, decline, and expire branches
  currently call `isOwnerOfLeague`, which is **one** `getDocStore`
  (`LEAGUES`). The new helper adds **at most one** extra `getDocStore`
  (`LEAGUE_MEMBERS`, by exact key: a point read, not a scan), and only
  when the owner check fails (short-circuit owner-first to keep the
  common owner path at one read). Net: ≤ 1 extra point read per battle
  **command** write, none on the hot resolve path. Battle writes are
  low-frequency (per-proposal, per-accept), so the instruction-budget
  impact is negligible and well within IC caps.
- **Memory & storage.** No new collection, no new doc shape, no new
  field. `league_members` docs already exist (`role` already stored).
  Zero growth-rate change.
- **Scalability.** The added read is an **exact-key point lookup**
  (`leagueMemberKey`), not a prefix scan: O(1) regardless of league
  size, so it is unchanged at 10× / 100× members or battles. No new N+1.
- **Upgrade & compatibility.** **No Candid / wire-format change.**
  `BattleDoc`, `BattleState`, the `battles` API surface are all
  untouched: only the assert's internal authorisation predicate widens.
  No `satellite_extension.did` / `src/declarations/**` regeneration is
  needed for the auth change itself. (`npm run juno:functions:build` is
  still run as a build sanity check; if it regenerates nothing, nothing
  is committed.) **Non-breaking** by `pr-and-ci.md` §1: strictly
  widens who is authorised; every previously-valid call stays valid. No
  `!` title, no `BREAKING CHANGE:` block.
- **Security.** `BATTLES` collection rules unchanged (`read: public`,
  `write: public`; the assert owns auth). The widening is deliberate and
  bounded: an `admin` is a role the **league owner alone** can grant (the
  `league_members` assert gates role changes on the owner), so admit-to-
  admin is itself owner-controlled: no privilege-escalation path is
  opened. A plain `member` still cannot propose/accept/decline/expire. A
  non-member still cannot (no `admin` row). The trustless resolve path is
  untouched, so widening command authority cannot fabricate results.
- **Parameters.** None added; the role set is the existing
  `LEAGUE_MEMBER_ROLES` / `LeagueMemberRole` in
  `src/lib/types/league-member.ts`: reuse, don't restate.

## Implementation outline

1. **Satellite assert** (`src/satellite/services/battle.services.ts`):
   add `isOwnerOrAdminOfLeague(leagueId)` next to `isOwnerOfLeague`:
   owner check first (existing `LeagueDoc.owner === callerText`), then on
   miss a `getDocStore(LEAGUE_MEMBERS, leagueMemberKey(...))` decode with
   `role === 'admin'`. Route the league branch of `isSideOwner` (and the
   creation sideA check) through it for the **command** transitions
   listed in Scope. Leave `in_flight → resolved`, `accepted → in_flight`
   (duel), the duel principal compares, and `assertDeleteBattle`
   untouched. Update the doc-comment in the file header (item 3's
   per-state list) to say "owner or admin" for the affected transitions.
2. **FE league detail** (`LeagueDetailPage.svelte`): introduce
   `const isLeagueAdmin = $derived(myRole === 'owner' || myRole ===
'admin')`; replace `canChallenge`, the `canRespondToBattle` /
   `canKickoffBattle` owner checks, the `?challenge=1` effect guard, the
   `CreateBoutModal` render guard (~1597), and the lazy-expire
   early-return (~852) with it. The `battle_admin_chip` shows on
   `isLeagueAdmin`. Add the `battle_admin_only` line in the battle
   section when `!isLeagueAdmin`.
3. **FE create-battle modal** (`CreateBoutModal.svelte`): filter
   `ownedLeagues` to `owner || admin`; update the doc comments and the
   no-leagues empty-state copy.
4. **FE promote/demote control**
   (`LeagueDetailPage.svelte` member sheet + `leagues.services.ts`): add
   the `setMemberRole` service helper (re-read + `setDoc` with new
   `role`, identity fields preserved); render the owner-only
   "Make admin" / "Remove admin" action in the `openMember` sheet for a
   non-owner, non-self member; reload the roster on success. No assert
   edit. New i18n keys for the two action labels (item 5).
5. **i18n** (`src/lib/constants/messages/*.ts`): add
   `leagues.detail.battle_admin_only`; reword
   `leagues.detail.battle_owner_accepts`; reword the
   `battles.create.empty_*` "must own" copy; add the promote/demote
   action labels (e.g. `leagues.detail.member_make_admin` /
   `leagues.detail.member_remove_admin`). en is the source; the other
   catalogs follow the project's i18n flow (per
   `docs/ai/frontend/i18n.md`); pt-BR mirrors EN per the porting
   convention.
6. **Analytics (pending-decision-gated)**: if the role `label` is
   approved, set `label: myRole` in the `acceptBattle` / `declineBattle`
   `track` calls in `LeagueDetailPage`. No taxonomy edit.
7. **PRODUCT.md**: update the Battles section
   (`docs/ai/PRODUCT.md` ~246–286): "the owner of one league proposes;
   the challenged league's owner accepts or declines" becomes "a league
   **owner or admin** proposes / accepts / declines"; note the owner can
   promote a member to admin from the members list. Keep the rest
   (privacy, trustless resolution) unchanged. Same PR as the behaviour
   change.
8. **Gates**: `npm run quality`, `npm run check`, and
   `npm run juno:functions:build` (commit only if it regenerates).

### PR scope

**Recommendation: one reviewable PR.** The two pieces are a single
feature and share the same files (`LeagueDetailPage.svelte`,
`leagues.services.ts`, the i18n catalogs). The promote/demote control is
small (one service helper + one owner-only action in an existing sheet)
and adds **no** backend change: the only assert edit in the PR is the
battle-gating widen. Splitting would ship the gating inert in PR 1 (the
caveat this decision exists to remove), so they belong together. If
review load is a concern, land the satellite battle-gating commit first
and the FE control commit second **within the same PR** for a clean
read, not as separate PRs.

## Acceptance criteria

- [ ] A league **admin** (a `league_members` row with `role === 'admin'`)
      can open the challenge sheet, propose a battle, and the satellite
      accepts the write.
- [ ] A league admin can **accept** and **decline** an incoming
      challenge to their league; the satellite accepts both.
- [ ] The owner retains every battle power exactly as before (no
      regression).
- [ ] A plain **member** sees "Only a league owner or admin can start a
      battle." in the battle section and has no challenge / accept /
      decline / kickoff affordance; a direct satellite write by a member
      is rejected.
- [ ] A **non-member** principal's battle command write is rejected by
      the assert (no `admin` row, not the owner).
- [ ] The **owner** sees a "Make admin" action on a plain member in the
      member sheet and a "Remove admin" action on an admin; tapping it
      writes the role and the badge updates after reload.
- [ ] A member **promoted to admin** can then open the challenge sheet,
      propose a battle, and accept / decline an incoming challenge.
- [ ] A **non-owner** (admin or member) sees no promote/demote control;
      a direct role-change `setDoc` by a non-owner is rejected by the
      assert.
- [ ] `CreateBoutModal` lists leagues where the caller is owner **or**
      admin as the challenger side; member-only leagues are excluded.
- [ ] The lazy-expire sweep fires for an admin (not only the owner).
- [ ] Retract stays proposer-only: an admin who didn't propose cannot
      retract a peer's proposal.
- [ ] No Candid / declarations diff from the auth change;
      `npm run quality` + `npm run check` pass.
- [ ] `PRODUCT.md` Battles section reads "owner or admin".

## Open questions

- **Is `'admin'` distinct from the league `owner` field?** Yes: `owner`
  is a property of the `LeagueDoc` (one principal), while `admin` is a
  `role` value on a `LEAGUE_MEMBERS` row. The owner also has an
  `owner`-role membership row. Promotion only ever toggles `member ↔
admin`; the assert reserves the `owner` role for the league's owner
  principal and rejects minting a second one. (Stated so the author does
  not conflate the two when wiring the control.)
- **Demote rules.** Demote is the inverse write (`admin → member`), same
  owner-only gate. Open: should an admin be auto-demoted on ownership
  transfer? Today `transferLeagueOwnership` already flips the old owner to
  `admin`; no further demote cascade is in scope here. Confirm no other
  demote trigger is expected.
- **Who may promote: owner only, or admins too?** This spec ships
  **owner-only** promotion (matches the satellite gate:
  `role` changes require `callerIsOwner`). Whether an admin should be
  able to promote other admins is deferred: it would require widening
  the `league_members` assert (a real backend change, unlike this
  FE-only control) and is a separate decision.
- **Duel battles**: confirmed they use bare-principal auth and no FE
  path creates them; no admin concept applies. (Verified in
  `assertSetBattle`; listed for completeness.)

## Pending decisions

- **Actor-role analytics `label` on `battle_accepted` / `battle_declined`.**
  Facts are clear (the `label` prop exists and is bounded; the handler
  knows `myRole`); the call is whether the owner-vs-admin cut is worth
  setting it. Default: **include**: it is the only way the split is
  visible in product analysis, and it reuses an existing bounded field
  with no schema change. Owner: product/analytics.

## Decisions

Recorded for the author (with the why):

- **Ship the promote-to-admin UI alongside the gating**
  (owner decision, 2026-06-25). Gating is useless without a way to create
  admins: with no shipped promote path, the widened authority would never
  be exercisable. Because the write is FE-only (the `league_members`
  assert already gates role changes on the owner), it folds cleanly into
  the same reviewable unit rather than a separate spec.
- **Keep the app i18n namespace** (`leagues.*`): the app's catalog
  convention wins (per `docs/ai/frontend/i18n.md`).
- **No emoji**: the app uses lucide icons.
- **`admin` is delegated authority, not a rename of the owner**: on the
  app's three-value `LeagueMemberRole`, "admin" means the delegated
  `admin` role acting **in addition to** the owner.
- **Gate on both FE and satellite**: chosen because the satellite assert
  independently enforces owner-only (`isOwnerOfLeague`), so an FE-only
  change would leave admin writes rejected by the backend. The auth
  predicate widens server-side; no Candid surface changes.
- **Retract stays proposer-only**: widening command authority to admins
  does not extend to deleting a peer admin's proposal; the proposer
  binds, matching the existing `assertDeleteBattle` contract.
