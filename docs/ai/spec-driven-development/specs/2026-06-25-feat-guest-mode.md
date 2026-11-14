# Spec: Guest mode: predict-then-convert funnel

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#980)

## Goal

A signed-out visitor who takes the "Skip · preview first, sign-up
later" path out of onboarding can predict immediately (no account, no
balance, no wall) and keep previewing freely. Their picks are a
throwaway, in-session preview: they are held only in localStorage to
power the in-session nudges, and they are **discarded on conversion**.
The hook is **"start for real + claim VXP"**, not pick preservation:
loss-aversion is driven by the offer to start a real account and claim
the existing 1,500 VXP starter grant, not by saving demo picks. On
sign-up the guest becomes a member, the existing 1,500 VXP onboarding
grant lands, and they start with an **empty portfolio**: the preview
picks are cleared, never turned into positions.

This is a **demo-drop** funnel, not a retro-stake one (see Decisions). A
guest predicts freely with no hard block; conversion is driven by
loss-aversion, not a gate. That decision **shrinks this spec to
pure-frontend**: no satellite
endpoint, no candid/declarations regen, no new economic action on
convert, which lowers risk and keeps the whole thing to one PR.

## Context

This spec touches the identity/auth gate (signed-out users currently
cannot predict at all), the prediction submit path (real orders go
FE→engine and require an authenticated identity), and the VXP/holdings
derived stores (a guest has no ledger balance). Guest picks are pure
client-side preview state: there is **no new economic action on
convert** (no retro-stake math). It **layers on top of** Onboarding V3
(`specs/2026-06-25-feat-onboarding-v3.md`); the "Skip · preview first,
sign-up later" button is wired there and hands off here. The sign-in
re-skin is a separate spec.

### App side (Svelte 5, the port target)

Current state, **there is no guest mode today**:

- `src/routes/(app)/+layout.svelte` (~209–211) redirects to `/signin`
  when `$userSignedOutResolved && !$userSignedIn`. Every `(app)/*` route
  is gated except the public exemptions (`/markets`, `/markets/*`,
  `/info/*`). A signed-out user cannot reach Flow or a prediction
  surface at all.
- `src/lib/components/market/TradeModal.svelte` (~177–235) renders
  `SignInActions` instead of the stake slider / submit when
  `!$userSignedIn`, so even if the surface were reached, the predict
  control is replaced by a sign-in prompt.
- `src/lib/services/order.services.ts` `placeOrder` (~108) threads the
  identity via `safeGetIdentityOnce`
  (`src/lib/services/identity.services.ts`, ~132) and **throws** if the
  caller is not authenticated. Real orders go FE→engine
  (`docs/engine-integration.md`); the engine is agnostic and requires a
  real principal. **A guest therefore cannot place a real order**: this
  is the architectural reason guest picks live client-side only and are
  never written as positions.

Identity / auth state:

- `src/lib/stores/user.store.ts`: `userStore` (`{ user, profile,
authBusy, profileExisted }`); `user` is the Juno session (undefined
  signed-out).
- `src/lib/derived/user.derived.ts`: `userSignedIn` (~10),
  `userNotSignedIn` (~12), `userSignedOutResolved` (~20, `!authBusy &&
!user`), `authPrincipal` (~25).

The prediction entry path:

- `src/lib/components/market/FlowMode.svelte`: the swipe deck; commits a
  prediction via `flowTradeService.executeTrade`
  (`src/lib/services/flow.services.ts`, ~23) →
  `executeOutcomeTrade` (`src/lib/utils/trade.utils.ts`, ~51) →
  `placeOrder`. This is the chain a guest pick must branch out of
  **before** the identity check.

VXP / holdings derived stores (a guest has none):

- `src/lib/derived/vxp-holdings.derived.ts`: `vxpSpendable` (~196),
  `vxpBacked` (~199), `vxpHoldingsTotal` (~203),
  `vxpHoldingsNotInitialized` (~189). These read the ledger for the
  signed-in principal; for a guest they are simply empty / not
  initialized. The conversion grant is what first populates a real
  balance, and the portfolio starts empty (no preview picks carried in).

The starter grant (already exists, convert reuses it, does not add it):

- The "1,500 VXP starter pack" is the existing onboarding grant. When a
  guest converts and a **new profile is created**, the satellite hook
  `onProfileSetForVxpOnboarding`
  (`src/satellite/services/vxp-onboarding.services.ts`, registered in
  `src/satellite/index.ts`) fires the grant exactly as it does for any
  new member: amount from `newUserVxpAmountMilestone1BaseUnits()` /
  `NEW_USER_VXP_TOTAL_BASE_UNITS`
  (`src/lib/constants/vxp-onboarding.constants.ts`). **Conversion does
  not introduce a new mint** and adds **no new economic action**: it
  routes a guest through the normal new-member creation, so the existing
  grant lands and the portfolio starts empty.

Pre-auth handoff (the mechanism to reuse, not reinvent):

- Governed by
  `specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md`
  (In progress #926). Storage key `PENDING_ONBOARDING_STORAGE_KEY`
  (`'vici:pending-onboarding'`,
  `src/lib/constants/profile.constants.ts` ~54). Writer
  `handleCompletePreAuth` (`src/routes/signup/+page.svelte` ~99),
  merge-safe (preserves referral / league / email). Drain effect in
  `src/routes/(app)/+layout.svelte` (~222) runs `drainPendingOnboarding`
  (`src/lib/services/onboarding-handoff.services.ts` ~406) on the
  new-user branch. Guest mode reuses this pipeline **only for the
  handle/identity handoff**: it does **not** carry guest picks or
  stakes across conversion. The guest preview picks are cleared at
  convert, not drained into positions. (See Pending decisions for the
  exact storage-key / store split.)

Overlay-collision gating (so the save sheet never stacks on a reveal):

- `src/lib/stores/menagerie-celebration.store.ts`:
  `menagerieCelebrationStore` (`{ current, queue }`).
- `src/lib/stores/flow-beat.store.ts`: `flowBeatActiveStore`
  (writable<boolean>), `setFlowBeatActive`.
- `src/lib/components/menagerie/MenagerieCelebrationHost.svelte` (~118)
  gates the reveal on `reveal && !beatActive`: the **exact pattern**
  the guest save-sheet must adopt (render only when no reveal and no Flow
  beat are on screen).

Reusable UI / services (per `docs/ai/frontend/reusability.md`):

- `src/lib/components/ui/BottomSheet.svelte`: `BottomSheet` (`isOpen`,
  `onClose`, `footer`, `desktopCentered`, `labelledBy`). The save sheet
  builds on this.
- `src/lib/components/authn/SignInProviderStack.svelte`:
  `SignInProviderStack` (`mode="signup"`, `handle`, `onSuccess`). The
  save sheet's sign-up CTAs **reuse this stack** so conversion runs through
  the same provider machinery (redirect-safe stashing included).
- `src/lib/stores/notification.store.ts`: `notificationsStore.add(...)`
  for the "1,500 VXP added" toast.

### Behaviour summary

The guest funnel is a single component pair over existing infrastructure:

- The save sheet has two roles in one component: a `soft` celebratory
  first-pick ask and a `remind` every-5th-pick nudge, with a body that
  pluralises the in-session count via `guest.picks_one` /
  `guest.picks_many`. The framing is "start for real + claim VXP", never
  "save your pick".
- Every guest pick forces no stake and drives the cadence off a
  session-scoped pick count (first-celebrate / every-5th-remind), **not** a
  lifetime call count, so a returning guest never re-fires the first-pick
  celebration. The sheet renders only when no reveal and no Flow beat are
  on screen. A standing inline CTA shows on Flow whenever the guest has at
  least one pick.
- Conversion is the **demo-drop** variant: the preview picks reset to a
  clean Day 0 (discarded), the existing onboarding grant lands, and the
  portfolio starts empty.

### Reusability

Guest mode is a re-composition over existing infrastructure, not new
infra: the pre-auth handle/identity handoff, `BottomSheet`,
`SignInProviderStack`, `notificationsStore`, the celebration/beat gate
stores, and the existing onboarding grant. The genuinely new code is (a)
a small guest-session store, (b) the guest-pick branch in the Flow
commit (records an in-session preview pick, never a position), and (c)
the save-sheet component + cadence. There is **no** retro-stake
reconciliation: convert clears the preview and routes through the
normal new-member path.

## Scope

Guest predicting + the convert funnel only. The Skip entry point is
Onboarding V3's; the sign-in re-skin is a separate spec. Because there
is no retro-stake, this spec is **pure-frontend** (no satellite
endpoint) and stays one PR.

### 1. Guest session state

A small client-only guest store (e.g.
`src/lib/stores/guest.store.ts`) holding `{ isGuest, handle,
sessionPickCount }`, hydrated from / persisted to localStorage alongside
the in-session preview picks. `isGuest` is set when the onboarding Skip
path completes (an auto-assigned or claimed handle, no auth).
`sessionPickCount` is **session-scoped** and drives the cadence
(deliberately **not** a lifetime count) so a returning guest cannot
misfire the first-pick celebration. Cleared on conversion and on a real
sign-out.

A `guestMode` derived (`src/lib/derived/`) exposes `isGuest` for surfaces
to gate on.

### 2. Let a guest reach Flow and predict

- **Route gate** (`(app)/+layout.svelte`): allow a guest session to
  reach Flow (and the surfaces guest mode needs) without redirecting to
  `/signin`. The gate currently keys off `userSignedOutResolved`; it must
  treat an active guest session as "may proceed" for the guest-allowed
  routes (at minimum Flow), while still redirecting a plain signed-out
  visitor. Exact allowed-route set under Pending decisions.
- **Predict control** (`TradeModal.svelte` / `FlowMode.svelte` commit):
  for a guest, render the predict control (not `SignInActions`) and route
  the commit through a **guest-pick branch** that does **not** call
  `placeOrder` / `safeGetIdentityOnce`. The guest pick is recorded as an
  in-session preview pick (no stake) in localStorage; no engine call, no
  balance check. (Guest picks never reach the engine at all here, so free
  guest play cannot move market prices.)
- Every guest pick is free; there is **no hard block** at the 2nd pick or
  ever. The funnel is nudges + a standing CTA.

### 3. Guest picks persistence (in-session preview only)

- A guest pick is appended to an in-session preview list in localStorage,
  capturing only what the nudges need: `{ marketId, outcome/side, ts }`
  (no `entryPrice`, no stake: there is nothing to reconcile at convert).
  Its sole purpose is to power the cadence and the "you've made N
  predictions" nudge copy.
- The preview picks are **cleared on conversion** and are **never written
  as positions**. The reused pre-auth handoff pipeline carries only the
  handle/identity handoff (referral / league / email via the existing
  merge-safe writer), **not** picks or stakes.
- Whether the preview picks live under the onboarding store or a sibling
  localStorage key (e.g. `'vici:guest-preview-picks'`) is a Pending
  decision, but either way they are session preview state that is
  cleared at convert, not drained into the new member's portfolio.

### 4. The save sheet + cadence

New `src/lib/components/guest/GuestSaveSheet.svelte` built on
`BottomSheet`, mounted once at the app shell beside the other overlays.

**Copy framing (CRITICAL).** The copy must **not** promise saving picks:
the preview picks are discarded on convert. Re-point every surface
from "save your pick" to a **"create your account / claim 1,500 VXP /
start predicting for real"** framing. The picks are referenced only as
in-session social proof ("you've made N predictions"), never as
something that carries over.

- **Soft** (after pick 1): celebratory, fully dismissible:
  "Enjoying the preview? Sign up to start for real and claim your 1,500
  VXP." Dismiss = keep previewing.
- **Remind** (every 5th pick thereafter): the same "start for real +
  claim 1,500 VXP" nudge, optionally referencing the in-session count as
  social proof ("you've made N predictions"); pluralise that count on
  `guest.picks_one` / `guest.picks_many`. It must not imply the N picks are
  saved.
- **Standing inline CTA**: a calm pill on Flow whenever the guest has ≥1
  pick (`isGuest && sessionPickCount >= 1 && route === Flow`), opening the
  sheet on tap. Framed "Sign up to start for real" / "Claim your 1,500
  VXP", never "save your pick". Never blocks a card.
- **All dismissible; none blocks.** The 1,500 VXP figure comes from
  `newUserVxpAmountMilestone1BaseUnits()` via `formatVxpBalance`, not a
  hardcoded literal.
- **Collision gate:** the sheet renders only when no reveal / beat is
  active: read `menagerieCelebrationStore.current` + `flowBeatActiveStore`
  and gate on `!reveal && !beatActive`, the same pattern
  `MenagerieCelebrationHost` uses. The earned menagerie reveal plays
  uninterrupted; the ask renders the moment the reveal clears. No timing
  hacks.
- **Sign-up CTAs** mount `SignInProviderStack mode="signup"
handle={guestHandle}` so conversion runs through the real provider
  stack (redirect-safe).

> The exact final wording of the soft sheet, the remind nudge, and the
> inline CTA is a **pending copy decision** (see Pending decisions). The
> direction is fixed: account/claim-VXP/start-for-real framing, no
> gambling vocabulary, "prediction" never "bet", no emoji, and no promise
> that preview picks are saved.

### 5. Conversion (create profile + clear the guest session)

On a successful sign-up from the guest funnel: **no new economic
action**:

- The new member profile is created → the **existing**
  `onProfileSetForVxpOnboarding` grant fires (1,500 VXP). No new mint
  surface, no convert-specific grant code, no retro-stake.
- The in-session guest preview picks are **discarded**: the guest store
  and the preview-picks localStorage are **cleared**. None of them
  becomes a position; the new member's portfolio **starts empty**.
- The pre-auth handoff drain (new-user branch, `(app)/+layout.svelte` →
  `onboarding-handoff.services.ts`) carries only the existing onboarding
  handoff (handle / referral / league / email): there is no pick
  reconciliation step.
- After conversion: `notificationsStore.add(...)` toasts "1,500 VXP
  added"; the user lands in Flow as a member with a fresh 1,500 VXP and
  an empty portfolio, ready to make their first real prediction.

### Out of scope

- **The onboarding screen and the Skip button itself**, owned by
  `specs/2026-06-25-feat-onboarding-v3.md`. This spec consumes the Skip
  hand-off, it does not build the screen.
- **The sign-in re-skin** (`/signin`): separate spec.
- **A2HS install nudge**: separate spec; the A2HS auto-prompt is
  **members-only because guests convert first**, so the two funnels are
  deliberately sequenced but built separately.
- **Anti-farm gating of the onboarding grant (#543).** Conversion routes
  a guest through new-member creation, so it inherits the existing
  onboarding-grant threat model and any future #543 hardening: it does
  not change it here. Guest mode **widens the new-account mint surface**
  (a brand-new account can now be created after a frictionless preview);
  demo-drop deliberately keeps that surface no wider than the existing
  grant (no extra mint via retro-stake), but #543 is flagged, not solved
  here.
- **Changing any economy amount or the grant size**: those are the
  signed-off constants.
- **Server-authoritative guest-pick storage.** Guest picks are
  client-only, in-session preview state (no satellite doc for a session
  with no principal) and are discarded at convert; a cleared browser
  simply loses the preview, which is harmless because nothing was ever a
  position.

## Linked issues

Searched the repo's open issues (`guest`, `convert`, `sign up`,
`onboarding`) on 2026-06-25 via the GitHub API. Only **#543**
(anti-farm: gate referral/onboarding payouts on an authoritative trade,
not the client activity log) is adjacent: it bounds the new-account
mint that conversion exercises. It is explicitly **out of scope** here
(no closing keyword); reference it as **Part of the same threat surface**
in Dependencies. No issue tracks guest mode itself: new feature, no
closing keyword.

## Analytics

Instrument the funnel; reuse existing event names and the bounded props
bag (`src/lib/types/analytics-event.ts` + the Zod mirror
`src/lib/schema/analytics-event.schema.ts`). The `source` /
`label` / `ok` / `count` dimensions cover the funnel without a new prop
key, so **no dual-source union/Zod edit and no satellite analytics-wire
regen** is required, preferred over minting new names.

- **Guest first pick / subsequent picks** → reuse `position_taken`
  (`src/lib/types/analytics-event.ts` ~76) with `source: 'guest_flow'`
  and `count` = the session pick number. Distinguishes guest activity
  from member activity by `source` without a new event.
- **Save sheet shown** → reuse `onboarding_step` with `source:
'guest_flow'`, `label: 'soft' | 'remind' | 'inline'`, and `count` (the
  session pick number). Folding the prompt-shown signal into an existing
  event keeps the funnel measurable **without** minting a new name, so
  there is no TS-union / Zod-mirror edit and no analytics-wire regen.
- **Conversion** → `signed_up` (~27) with `source: 'guest_convert'`, so the
  guest→member funnel is separable from a cold signup. No "retro-staked
  count" prop is needed (picks are discarded). `onboarding_completed` still
  fires once via the drain (per the persist spec), so conversion is not
  double-counted as a fresh onboarding.

Behavioural only: bounded vocab, no PII / free-text. The prompt-shown
signal reuses `onboarding_step` rather than a dedicated name, so no
satellite analytics-wire regen is required.

## Implementation outline

1. **Guest store**: `src/lib/stores/guest.store.ts` (`{ isGuest,
handle, sessionPickCount }`, localStorage-backed) + a `guestMode`
   derived under `src/lib/derived/`. Set on onboarding Skip completion;
   cleared on convert / sign-out.
2. **Route gate**: `(app)/+layout.svelte`: let an active guest session
   reach the guest-allowed routes (Flow at minimum) instead of bouncing
   to `/signin`. Keep the plain signed-out redirect intact.
3. **Predict control**: `TradeModal.svelte` / `FlowMode.svelte`: for a
   guest, render the predict control and branch the commit into a
   guest-pick path that records an in-session preview pick, never calls
   `placeOrder` / `safeGetIdentityOnce`. Increment `sessionPickCount`.
4. **Preview picks**: record `{ marketId, side/outcome, ts }` to an
   in-session localStorage list (shared key vs sibling key per Pending
   decision) purely to power the cadence/nudge copy. No `entryPrice`, no
   stake: nothing to reconcile.
5. **Save sheet**: `src/lib/components/guest/GuestSaveSheet.svelte` on
   `BottomSheet`; soft / remind / inline variants; pluralised
   social-proof count; the `!reveal && !beatActive` collision gate;
   `SignInProviderStack mode="signup"` CTAs; VXP figure from
   `newUserVxpAmountMilestone1BaseUnits()`. Copy framed "start for real +
   claim 1,500 VXP", never "save your pick". Mount once at the app shell.
   Cadence: soft on pick 1, remind every 5th, standing inline CTA while
   `sessionPickCount >= 1` on Flow.
6. **Convert**: on a successful sign-up from the funnel: the profile is
   created and the existing grant fires; clear the guest store and the
   preview-picks localStorage so the portfolio starts empty. Toast "1,500
   VXP added" via `notificationsStore`. No pick reconciliation: the
   pre-auth handoff carries only handle/identity.
7. **i18n**: the `guest.*` keys under the app's namespace (see Decisions)
   across all live locales (en/it/es/de/fr/pt/zh-Hans) in
   `src/lib/constants/messages/*.ts`, with the demo-drop copy framing. Run
   `npm run quality` to catch missing-locale gaps.
8. **Analytics**: `position_taken` (`source: 'guest_flow'`), `signed_up`
   (`source: 'guest_convert'`), and the conversion-ask shown reusing
   `onboarding_step` (`source: 'guest_flow'`, `label` = surface): no new
   event name, so no analytics-wire regen; capture via `track()`.
9. **PRODUCT.md**: document the guest funnel (free previewing, no wall,
   loss-aversion conversion via the start-for-real + claim-VXP offer,
   preview picks discarded on convert / portfolio starts empty, the
   client-only preview limitation, and the #543 new-account-mint note) in
   the same PR.
10. `npm run quality` + `npm run check`. (Pure-frontend: no satellite
    build / bindings regen.)

## Acceptance criteria

- [ ] A visitor who takes "Skip · preview first, sign-up later" reaches
      Flow and can make a prediction with no account and no balance: the
      predict control shows, not a sign-in prompt.
- [ ] A guest can keep predicting indefinitely; no pick is ever blocked
      (no hard gate at the 2nd pick or any later pick).
- [ ] Guest picks are recorded as in-session preview picks and never
      reach the engine (no `placeOrder` / identity call): free guest
      play cannot move market prices.
- [ ] After pick 1 the **soft** sheet shows (celebratory, dismissible);
      every 5th pick after shows the **remind** sheet with correctly
      **pluralised** social-proof copy; a standing inline CTA shows on
      Flow whenever the guest has ≥1 pick. All dismissible; none blocks a
      card.
- [ ] No funnel copy promises saving picks: every surface is framed
      "create your account / claim 1,500 VXP / start predicting for
      real".
- [ ] The save sheet never stacks on a menagerie reveal or a Flow beat:
      it waits until `!reveal && !beatActive`, then renders.
- [ ] The cadence uses a **session-scoped** pick count, so a returning
      guest does not re-fire the first-pick celebration.
- [ ] On sign-up from the funnel the guest becomes a member, the existing
      1,500 VXP grant lands via the existing onboarding path, the guest
      session and preview-picks localStorage are **cleared**, no pick is
      staked, and the new member's portfolio **starts empty**.
- [ ] A "1,500 VXP added" toast shows on conversion; the guest session
      state is cleared.
- [ ] All `guest.*` keys resolve in en/it/es/de/fr/pt/zh-Hans; no gambling
      vocabulary, no "bet", no emoji (lucide icons only).
- [ ] Analytics fire: guest pick emits `position_taken` with
      `source: 'guest_flow'`, the conversion ask emits `onboarding_step`
      with `source: 'guest_flow'`, and conversion emits `signed_up` with
      `source: 'guest_convert'`: all existing event names, no wire regen.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- **1: Does the existing onboarding-grant hook fire correctly for a
  converted guest, and exactly once?** Confirm `onProfileSetForVxpOnboarding`
  treats a converted-guest profile creation identically to a cold signup
  (it should, since convert creates a normal new profile), and that the
  #926 persist-spec drain reconciliation and the grant do not race or
  double-fire.
- **2: Where exactly does the route gate let a guest through?** Confirm
  the minimal allowed-route set (Flow only, or also market detail /
  results) against what the guest funnel actually needs, and that
  `userSignedOutResolved` consumers elsewhere don't misread a guest
  session as signed-in.

## Pending decisions

- **Guest preview-picks storage.** Resolved: a **sibling guest store**
  (`src/lib/stores/guest.store.ts`, `localStorage` key
  `'vici:guest-session'`) holds `{ isGuest, handle, sessionPickCount,
previewPicks[] }`, separate from `PENDING_ONBOARDING_STORAGE_KEY`. This
  keeps the merge-safe handoff writer untouched and the onboarding payload
  unbloated; the guest store is cleared wholesale at convert.
- **Nudge cadence.** Resolved: soft on pick 1, remind every 5th pick after,
  standing inline CTA while `sessionPickCount >= 1` on Flow.
- **Final copy for the save sheet, remind nudge, and inline CTA.** Resolved
  in the `guest.*` catalog keys; framing is account / claim 1,500 VXP /
  start for real, no "save your pick", no gambling vocab, no emoji.
- **Analytics: dedicated prompt-shown event vs. fold-in.** Resolved: fold
  the prompt-shown signal into `onboarding_step` (`source: 'guest_flow'`,
  `label` = surface), so no new event name and no analytics-wire regen.
- **Guest-allowed route set.** Resolved: **Flow only** (tightest): all the
  preview funnel needs. A plain signed-out visitor stays bounced to
  `/signin` everywhere.

## Decisions

- **Demo-drop, not retro-stake.** When a guest converts, their guest
  preview-predictions are **discarded**, not turned into real positions.
  The converted user starts with the existing 1,500 VXP onboarding grant
  and an **empty portfolio**. Rationale:
  - Guest/demo picks are **low-intent**: users often tap randomly while
    previewing and don't care about the outcome yet, so preserving them
    has little value.
  - Retro-staking at a locked entry price is an **EV exploit**
    (look-ahead: convert only once the market has moved your way) and
    widens the new-account-mint abuse surface tracked in **#543**.
  - Honoring a locked entry price would require a **new icdc-core /
    satellite endpoint** (atomic grant-then-stake, with candid regen).
    Demo-drop removes that dependency entirely, keeping the spec
    pure-frontend and one PR.
  - Rejected alternatives: **(B) retro-stake at the locked entry price**
    and **(C) retro-stake at the conversion price**. Both add
    cost/abuse-surface for marginal benefit given the low-intent demo
    picks, so neither is taken.
- **The app's i18n namespace.** The funnel keys land under a `guest.*`
  namespace per the project's namespace rule, mirroring how the one-screen
  onboarding keys live under `onboarding.v3.*`.
- **No emoji.** lucide icons only.
- **No hard wall.** A guest predicts freely with no hard block; conversion
  is driven by loss-aversion (the offer to start for real and claim 1,500
  VXP), not a gate.
- **Reuse the pre-auth handoff pipeline for handle/identity only.** Guest
  conversion reuses the `PENDING_ONBOARDING_STORAGE_KEY` stash →
  first-authenticated-layout drain shape already governed by the #926
  persist spec for the handle / referral / league / email handoff: it
  does **not** carry picks or stakes.
- **Reuse the existing onboarding grant for the 1,500 VXP, not a
  convert-specific mint.** Conversion creates a normal new member, so
  `onProfileSetForVxpOnboarding` fires the grant as-is: conversion adds
  no new mint surface and no new economic action.
- **Reuse `BottomSheet` + `SignInProviderStack`.** The save sheet is
  `BottomSheet` and its sign-up CTAs are the real provider stack
  (redirect-safe), so there is one source of truth for sheets and for auth.
- **Session-scoped cadence.** First-celebrate / every-5th-remind keys off a
  session pick count, not a lifetime call count, so a returning guest never
  misfires the first-pick celebration.

## Dependencies

- **Onboarding V3 (`specs/2026-06-25-feat-onboarding-v3.md`, Draft).**
  Provides the "Skip · preview first, sign-up later" entry into this
  funnel; that spec wires the button, this spec owns the funnel. If V3
  ships first, V3's interim-Skip-target pending decision covers the gap.
- **Onboarding picks persist across providers
  (`specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md`,
  In progress #926).** Guest mode reuses its stash-before-auth + the
  new-user drain branch for the handle/identity handoff; Open question 1
  and the storage-key decision bind to #926 as merged.
- **Anti-farm gating (#543, open).** Conversion exercises the new-account
  mint #543 hardens; guest mode lowers the friction to reach it but
  demo-drop keeps the mint no wider than the existing grant (no extra
  retro-stake mint): Part of #543's threat scope, tracked there.
- **Sign-in re-skin (separate spec).** The save sheet links into
  sign-up; the `/signin` re-skin is its own work.
