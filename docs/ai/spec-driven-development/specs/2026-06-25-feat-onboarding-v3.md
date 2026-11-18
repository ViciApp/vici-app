# Spec: Onboarding: one-screen handle + sign-up

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#979)

## Goal

Make new-user onboarding a single screen: the user claims a handle (live
availability + Roman-pool suggestion) and signs up (Google or
email→passkey) in one view, sees the "1,500 VXP starter pack" reward
anchor, and can either skip to preview the app or jump to sign-in if they
already have an account. Team selection and an in-onboarding first call are
not part of this flow: the team is set later in the post-signup Profile,
and the first prediction happens free in-app. The one-screen flow ships
flag-gated and default-on, with the earlier multi-beat flow left intact and
reachable behind the off path until the one-screen flow is verified in
production.

## Context

- Entry route: `src/routes/signup/+page.svelte`: mounts the onboarding
  surface, owns the pre-auth stash (`handleCompletePreAuth`), the
  authenticated direct-write (`handleCompleteAuthenticated`), and the
  returning-user bounce to `AppPath.Flow`.
- Multi-beat flow under `src/lib/components/onboarding/`:
  - `OnboardingFlow.svelte`: the `1a → 1b → 2 → 3` state machine.
  - `OnboardingBeat1.svelte` / `OnboardingBeat1Card.svelte`: team picker
    and derived first call (not part of the one-screen flow).
  - `OnboardingBeat2.svelte`: handle picker. **Reuse target.** Holds the
    live-availability probe, the pool sampling, and the claim-time TOCTOU
    re-check recomposed into the one-screen flow.
  - `OnboardingBeat3.svelte`: auth gate; mounts
    `SignInProviderStack mode="signup"` + the starter-pack strip + ToS.
  - `OnboardingStepTracker.svelte`: `Vici · N of 3` tracker (the
    one-screen flow has a single surface → not rendered).
  - `FlowCoach.svelte`: first-run in-app coach. Already shipped, out of
    scope; the flow hands off to it unchanged after sign-up.
- Auth surface: `src/lib/components/authn/SignInProviderStack.svelte`,
  `apple | google | email | ii | passkey | dev`, per-provider enable
  flags, the pre-`run()` provider/email stashing, the Google full-page
  redirect. **Reused as-is.**
- Handle logic to reuse (cite, don't re-implement):
  - `checkNicknameAvailability` (`src/lib/services/profile.services.ts`):
    the satellite availability query (live probe + claim-time re-check).
  - `HANDLE_POOL` (`src/lib/constants/handle-pool.constants.ts`): the
    Roman/Latin suggestion pool.
  - `sanitizeNickname`, `NICKNAME_PATTERN`, `MIN_NICKNAME_LENGTH`,
    `MAX_NICKNAME_LENGTH`, `RESERVED_HANDLES`, `PENDING_ONBOARDING_STORAGE_KEY`
    (`src/lib/constants/profile.constants.ts`).
  - `applyOnboardingPicks` (`src/lib/services/profile.services.ts`): the
    serialized profile write the handoff already uses.
- Starter-pack VXP: `newUserVxpAmountMilestone1BaseUnits()`
  (`src/lib/constants/vxp-onboarding.constants.ts`) formatted via
  `formatVxpBalance`, reused so the "1,500 VXP" chip stays in lock-step
  with the economy config rather than hardcoding the literal.
- Feature-flag mechanism: build-time boolean constants in
  `src/lib/constants/feature-flags.constants.ts` (e.g.
  `MARKET_DETAIL_DIRECT_TRADE_ENABLED`). This is the app's only flag
  idiom: hardcoded booleans flipped through review, not runtime config.
- i18n: flat dotted keys in `src/lib/constants/messages/*.ts`, looked up
  via `t({ locale, key })` (`src/lib/utils/i18n.utils.ts`). Existing
  namespace: `onboarding.*`. Live locales (en, es, pt, it, fr, de,
  zh-Hans) must mirror `en` exactly; soon locales fall back to English.
- Onboarding handoff / persistence (the dependency below):
  `src/lib/services/onboarding-handoff.services.ts` (`drainPendingOnboarding`),
  `src/routes/(app)/+layout.svelte` (the drain effect), the
  `applyOnboardingPicks` write, governed by
  `specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md`.

### Reusability

Per `docs/ai/frontend/reusability.md`: the handle field, pool suggestions,
live availability, and claim-time re-check already exist in
`OnboardingBeat2.svelte`; the auth cluster in `SignInProviderStack.svelte`;
the starter VXP in `vxp-onboarding.constants.ts`. The one-screen flow is a
re-composition of these into a single surface, not new infrastructure.
Country flags use `CountryFlag.svelte` (no emoji); icons are lucide
(`Gift`, check/x marks).

## Scope

A new single-screen onboarding component, gated by a new build-time flag,
mounted by `signup/+page.svelte` in place of `OnboardingFlow` when the flag
is on. The multi-beat flow stays in the tree, reachable when the flag is
off.

### 1. The one-screen flow

New `src/lib/components/onboarding/OnboardingV3.svelte`, IA order: brand →
hero → handle → reward → auth → escapes → legal. Theme-aware (dark +
light/peach), reusing the `ob2-*` surface primitives.

- **Handle field**: a single typed input. Live availability uses the same
  debounced probe pattern as `OnboardingBeat2` (`checkNicknameAvailability`,
  monotonic cancel token, `sessionTaken` cache, offline-tolerant `failed`
  state stays claimable-but-neutral). Validation reuses
  `MIN_NICKNAME_LENGTH` / `MAX_NICKNAME_LENGTH` / `NICKNAME_PATTERN` /
  `sanitizeNickname` and screens `RESERVED_HANDLES`. The check/x state is
  rendered with lucide icons. On empty input, the placeholder shows a
  pool-derived suggestion (`@<HANDLE_POOL pick>`); selecting it claims it. A
  claim-time re-check (the TOCTOU guard) runs before the picked handle is
  handed to the auth/stash path.
- **Reward chip**: "1,500 VXP starter pack" + a "Predict the FIFA World
  Cup 2026" sub. VXP from `newUserVxpAmountMilestone1BaseUnits()` via
  `formatVxpBalance`; event title from `$featuredEvent`. lucide `Gift`, no
  emoji.
- **Auth**: mount `SignInProviderStack mode="signup" handle={handle}`. The
  stack's provider set is the authority and already carries the
  redirect-safe stashing, so it is reused rather than re-created. A "lock
  cue" (`Locking @handle` / `Enter an available handle to continue`) sits
  as a label above the stack.
- **Escapes & footer**: "Skip · preview first, sign up later" (hands off
  to the signed-out preview, see Dependencies), "Already a member? Sign in"
  link (routes to `/signin`), and the legal fine print ("VXP is gameplay
  currency · no real money" / "Resolution on public data"): no gambling
  vocabulary, no "bet".

### 2. Wire into `signup/+page.svelte`

- Gate on the new flag: render `OnboardingV3` when on, `OnboardingFlow`
  when off. The authenticated post-signin path and the returning-user
  bounce stay as-is.
- The one-screen flow emits the **same handoff shape** the page already
  consumes: `{ participantId: null, side: null, handle }`, so
  `handleCompletePreAuth` / `handleCompleteAuthenticated` / `onPicksReady`
  need **no signature change**: team and side are simply always `null`
  (deferred to Profile). The persist-across-providers machinery
  (stash-before-auth, drain, analytics) is reused unchanged.
- Emit `onPicksReady` (handle-only) when an available handle is claimed,
  before any provider runs, so a Google redirect carries the handle
  through, exactly as the multi-beat flow's auth-gate entry does today.

### 3. New flag

`ONBOARDING_V3_ENABLED = true` in
`src/lib/constants/feature-flags.constants.ts` (default on), with a doc
comment noting the multi-beat flow is kept behind the off path until the
one-screen flow is verified in prod.

### 4. i18n: the `onboarding.v3.*` keys

Add the `onboarding.v3.*` keys under the app's `onboarding.*` namespace
(e.g. `onboarding.v3.h1_pre`, `onboarding.v3.avail.checking`,
`onboarding.v3.avail.taken`, …) across all live locales (en, es, pt, it,
fr, de, zh-Hans) in `src/lib/constants/messages/*.ts`. Reuse existing
`onboarding.*` strings where the copy already matches (the ToS lines) rather
than duplicating.

### Out of scope

- **Guest mode.** The Skip path hands off to the signed-out preview but the
  guest funnel is a separate spec, see Dependencies. This flow only wires
  the entry point.
- **Sign-in / auth re-skin** (`/signin`): a separate spec. This flow only
  links to `/signin`.
- **The PWA install nudge and the guest save-sheet / convert flow**:
  separate work.
- **Deleting the multi-beat flow.** It stays in the tree, reachable with the
  flag off, until the one-screen flow is verified in prod. The cleanup PR is
  a later follow-up (see Pending decisions).
- **Team selection in onboarding.** Deferred to the post-signup Profile
  (Affiliations): this flow is handle + auth only. Building the
  Profile-side team entry point is its own work, not this spec.
- **The satellite write path / schema / handle-uniqueness assertion**:
  already correct and unchanged; the flow reuses `checkNicknameAvailability`
  and `applyOnboardingPicks` with team/side `null`.
- **Anti-farm gating of the onboarding VXP grant** (issue #543):
  untouched.

## Linked issues

No open issue tracks this work. Searched the repo's open issues
(`onboarding`, `handle`, `signup`, `signin`, `guest`): only #543
(anti-farm gating of onboarding/referral payouts) is adjacent, and it is
explicitly out of scope (no closing keyword). New feature, no closing
keyword. Searched 2026-06-25.

## Analytics

Onboarding is already instrumented; the flow reuses the existing taxonomy
(`src/lib/types/analytics-event.ts`, mirrored in
`src/lib/schema/analytics-event.schema.ts`): **no new event names, no new
prop keys**, so no dual-source union/Zod edit and no satellite
analytics-wire regen.

- `onboarding_started`: emit on mount, `source: 'onboarding'`,
  `label: 'v3'` to distinguish the surface. (`label` is the bounded
  categorical dimension; `'v3'` is a fixed value.)
- `handle_checked`: emit on a completed live availability probe (custom
  typed handle), carrying `ok` (available?). The pool-fallback placeholder
  doesn't fire it.
- `onboarding_completed`: **not added here.** It already fires once in the
  drain's `applied` outcome (`onboarding-handoff.services.ts`, per the
  persist spec), the single point every completed flow passes through,
  carrying the finishing `provider` (`label`) and team-picked (`ok`). Team
  is always absent here, so `ok` is `false`: a correct, expected signal,
  not a new event. The Skip→preview path does **not** complete onboarding;
  its conversion analytics belong to the guest-mode spec.

All events behavioural, bounded vocab, no PII/free-text. Capture via
`track()` (`src/lib/services/analytics.services.ts`).

## Implementation outline

1. Add `ONBOARDING_V3_ENABLED = true` to
   `src/lib/constants/feature-flags.constants.ts` with the
   multi-beat-retention doc comment.
2. Add the `onboarding.v3.*` keys to all live locales in
   `src/lib/constants/messages/*.ts`. Run `npm run quality` so the i18n
   lint catches any missing-locale gaps.
3. Create `src/lib/components/onboarding/OnboardingV3.svelte`
   (Svelte 5 runes, `interface Props` + destructure):
   - Props: `onComplete`, `onPicksReady`, `onSignIn`, `onSkip`,
     `authenticated?` (team/side always `null`).
   - Handle state + the debounced live-availability `$effect` ported from
     `OnboardingBeat2` (`checkNicknameAvailability`, monotonic token,
     `sessionTaken` `SvelteSet`, `failed` → neutral-claimable), plus
     `RESERVED_HANDLES` screening and the empty-input pool-suggestion
     placeholder from `HANDLE_POOL`.
   - Reward chip from `newUserVxpAmountMilestone1BaseUnits()` +
     `$featuredEvent`; lucide `Gift`.
   - Mount `SignInProviderStack mode="signup" handle={handle}
onSuccess={...}`; lock-cue label above it.
   - Claim-time re-check before handing the handle to the stash/complete
     path (the TOCTOU guard).
   - Skip button → `onSkip`; "Already a member?" → `onSignIn`; legal fine
     print.
   - Scoped `.ob-v3` styles using the app's theme tokens; verify dark +
     light/peach (the Google-pill contrast must survive).
4. `signup/+page.svelte`: import `ONBOARDING_V3_ENABLED`; render
   `OnboardingV3` when on, `OnboardingFlow` when off. Pass
   `onComplete={handleComplete}`, `onPicksReady={handleCompletePreAuth}`,
   `onSignIn={() => goto('/signin')}`, and `onSkip` → the signed-out
   preview (`AppPath.Flow`) until the guest-mode spec lands. Confirm the
   handoff shape (`participantId`/`side` always `null`) flows through
   unchanged.
5. Analytics: emit `onboarding_started` (`label: 'v3'`,
   `source: 'onboarding'`) on mount and `handle_checked` (`ok`) on a
   completed custom-handle probe, via `track()`.
6. Update `docs/ai/PRODUCT.md` onboarding section: the one-screen flow is
   the default (handle + auth, team deferred to Profile, first prediction
   free in-app), the multi-beat flow retained behind the flag, the persist
   machinery and `onboarding_completed` emit unchanged.
7. `npm run quality` + `npm run check`.

## Acceptance criteria

- [ ] With `ONBOARDING_V3_ENABLED` on, `/signup` renders the single
      onboarding screen: no team picker, no first-call beat, no step
      tracker.
- [ ] Typing a handle runs the live availability check (debounced,
      cancel-on-keystroke) and shows available / taken / format-error /
      reserved states; an empty field shows a Roman-pool suggestion as a
      claimable placeholder.
- [ ] The reward chip shows the starter VXP sourced from
      `newUserVxpAmountMilestone1BaseUnits()` (not a hardcoded literal) and
      the featured-event title.
- [ ] Signing up with any enabled provider lands the claimed handle on the
      new profile (team/side `null`), via the existing
      persist-across-providers stash + drain, including a Google full-page
      redirect.
- [ ] "Skip · preview first, sign up later" routes to the signed-out
      preview (the agreed interim target until the guest-mode spec lands).
- [ ] "Already a member? Sign in" routes to `/signin`.
- [ ] The screen renders correctly in dark and light/peach themes; the
      Google CTA is a dark-ink pill with white text in light/peach (no
      cream-on-cream, no transition flash).
- [ ] All `onboarding.v3.*` keys resolve in the live locales; no gambling
      vocabulary, no "bet", no emoji.
- [ ] `onboarding_started` (`label: 'v3'`) and `handle_checked` (`ok`)
      fire; `onboarding_completed` still fires once via the drain with the
      finishing provider.
- [ ] Flipping `ONBOARDING_V3_ENABLED` off restores the intact multi-beat
      flow.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- **How does onboarding handoff/persistence behave with a handle-only
  payload?** The persist spec
  (`specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md`)
  stashes `{ participantId, side, handle }` and the drain applies them on
  the new-user branch. A payload with `participantId: null` + `side: null`
  - a non-null `handle` drains cleanly: `applyOnboardingPicks` writes the
    handle and stamps `onboardingCompleted` without a team/side,
    `handleCompletePreAuth`'s "nothing to stash" guard still fires only when
    the handle is also absent, and `onboarding_completed`'s `ok` (team-picked)
    reads `false`. Confirmed against the merged persist code.
- **Is `OnboardingV3` better as a sibling of `OnboardingFlow` or rendered
  through it?** It has no beats, so a standalone component mounted by the
  page (bypassing the `1a→3` state machine) is the natural shape: confirm
  nothing downstream (FlowCoach trigger, the `(app)` drain, `data-tid`
  hooks used by e2e) depends on the `OnboardingFlow` wrapper element being
  present. The flow reuses `TestId.OnboardingFlow` on its envelope so those
  hooks still resolve.

## Pending decisions

- **V2 → one-screen cutover / cleanup plan.** This spec ships the
  one-screen flow flag-gated with the multi-beat flow retained. Decide the
  trigger to flip the flag permanently and the follow-up PR that deletes the
  multi-beat flow (`OnboardingFlow`, `OnboardingBeat1/1Card/2/3`,
  `OnboardingStepTracker`, the multi-beat-only `onboarding.beat*` i18n keys
  and `.ob2-*`/`.ob-v2` styles): owner + timing, not built here.
- **Interim Skip target until the guest-mode spec lands.** Until guest mode
  ships, the Skip button routes into the signed-out Flow preview
  (`AppPath.Flow`) so it never ships a dead button.

## Decisions

- **Ship the one-screen flow flag-gated, default on; keep the multi-beat
  flow reachable.** The multi-beat flow is not deleted in this spec: it
  stays behind the off path until the one-screen flow is verified in prod,
  so a regression is a one-line flag flip back, not a revert. The app's
  `feature-flags.constants.ts` build-time-boolean idiom is the vehicle
  (review-gated, no runtime config).
- **Defer team selection to the post-signup Profile.** The one-screen flow
  is handle + auth only. The first prediction is now free in-app (Option-A
  economy), so the in-onboarding team pick and first call are dropped; team
  affiliation moves to Profile → Affiliations. The handoff shape is
  unchanged: `participantId`/`side` are simply always `null`, so the
  persist-across-providers machinery is reused verbatim.
- **Keep the app's i18n namespace.** The keys land under `onboarding.v3.*`,
  per the project's namespace convention.
- **Reuse, don't re-implement, the handle + auth machinery.** The live
  availability probe, pool suggestions, claim-time TOCTOU re-check
  (`OnboardingBeat2`), the provider stack (`SignInProviderStack`), the
  starter-VXP source (`vxp-onboarding.constants.ts`), and the
  persist-across-providers stash/drain are all reused: the one-screen flow
  is a re-composition into a single surface, keeping a single source of
  truth for each behaviour.

## Dependencies

- **Guest mode (`specs/2026-06-25-feat-guest-mode.md`, separate spec).**
  The Skip → "preview first, sign up later" path is the entry point into
  the guest funnel; this flow wires the button, guest mode owns the funnel.
  Until it ships, Skip routes into the signed-out Flow preview.
- **Sign-in re-skin (separate spec).** "Already a member? Sign in" links to
  `/signin`; the sign-in screen's matching re-skin is its own spec. This
  flow only depends on `/signin` existing.
- **Onboarding picks persist across providers
  (`specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md`).**
  The flow reuses its stash-before-auth + drain + the single
  `onboarding_completed` emit.
