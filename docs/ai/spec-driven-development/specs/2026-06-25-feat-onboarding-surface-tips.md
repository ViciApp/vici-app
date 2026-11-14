# Spec: Onboarding surface-tips (first-visit just-in-time tips)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#983)

## Goal

The first time a new or guest user lands on a main app surface (Dash,
Arena, Profile), slide in a single small, non-blocking tip above the tab
bar explaining what that surface is for. One tip at a time, dismissible,
shown at most once per surface per device. Nothing fires up front: a tip
only appears when the user actually navigates to that surface
(progressive disclosure, not an up-front tour). This is layer 2 of the
first-run tutorial system; layer 1 (the in-flow gesture coach,
`FlowCoach`) already ships. The Profile tip does double duty: it nudges
the team pick that onboarding defers out of the signup flow.

## Context

The intended behaviour: a `SurfaceTip` component does a route → tip
lookup, enters after a short settle delay (~420 ms), marks itself seen
on show (so it appears exactly once per device, even if ignored), and
self-gates on route + seen-state. Seen-state is
per-surface (Dash / Arena / Profile), persisted under the app's
`vici.tip-*-seen` flags alongside the existing `vici.coach-*`
convention. Copy lives in the app's `tip.dash.*` / `tip.arena.*` /
`tip.profile.*` i18n keys (English authored; other locales follow the
repo's new-key approach). Gating: new/guest users with calls < 5, one
tip at a time, placed just above the tab bar.

App side (real paths to touch / reuse):

- App shell where overlays mount: `src/routes/(app)/+layout.svelte`. It
  already hosts shell-level overlays beside `<MobileNav>`
  (`MenagerieCelebrationHost`, `NotifToastHost`, `CompanionOverlay`,
  `AccountReturnGate`), all gated on `$userSignedIn`. The new tip host
  mounts here, same pattern.
- Tab bar / placement anchor: `src/lib/components/layout/MobileNav.svelte`:
  the floating `.pillnav-wrap` is `position: fixed; bottom: 0; z-index:
50`. The tip sits just above it.
- One-time-seen flags: `src/lib/utils/onboarding-flags.utils.ts`,
  existing `vici.coach-*` keys (`COACH_FLOW_SEEN_KEY`,
  `COACH_ONBOARDING_SEEN_KEY`, `BATTLES_INTRO_SEEN_KEY`),
  `ONBOARDING_SEEN_KEYS`, and `clearOnboardingSeenFlags()`. These are
  identity-scoped (cleared on principal change via
  `reconcileIdentityScopedStorage`). The new per-surface tip flags extend
  this file.
- Seen-flag read/write idiom: `FlowCoach.svelte` already implements the
  exact `localStorage`-backed, browser-guarded, try/catch one-time pattern
  (`readSeen()` → `localStorage.getItem`, `dismiss()` →
  `localStorage.setItem(key, '1')`). The tip host reuses this idiom rather
  than inventing a new persistence path. `del`/storage helpers live in
  `src/lib/utils/storage.utils.ts`.
- Queue/host shape to mirror: `MenagerieCelebrationHost.svelte` +
  `src/lib/stores/menagerie-celebration.store.ts`: the canonical
  "one-at-a-time, shell-mounted, store-driven reveal" style in the app.
  The surface-tip host is simpler (route-gated, not a queue) but follows
  the same host-component + small-module shape.
- Routes / active-tab aliasing: `src/lib/constants/routes.constants.ts`
  (`AppPath.Dash`, `AppPath.Arena`, `AppPath.Profile`, plus the aliased
  paths `Portfolio`, `Album`, `Wallet`, `Settings`, `Notifications`). The
  surface→tip mapping must reuse `MobileNav`'s existing `isActive`
  aliasing so e.g. `/portfolio` counts as Dash and `/wallet` /
  `/settings` count as Profile: the tip keys off the same five-tab model
  the nav already defines.
- Gating signal (calls < 5): the lifetime call count is
  `UserProfile.totalTrades` (`src/lib/schema/profile.schema.ts`), read
  from `$userStore.profile`. Guest detection: see Open questions, guest
  mode is not yet in the app, so v1 gates on `totalTrades` only.
- i18n catalogs: `src/lib/constants/messages/*` (12 locales: `de`, `en`,
  `es`, `es-419`, `es-AR`, `es-MX`, `fr`, `it`, `ja`, `pt`, `pt-BR`,
  `zh-Hans`). New keys must land in every catalog or the i18n lint fails
  (`docs/ai/frontend/i18n.md`). Translation via `t()` from
  `#lib/utils/i18n.utils`, locale from `localeStore`.
- Analytics: `track()` in `src/lib/services/analytics.services.ts`;
  taxonomy `src/lib/types/analytics-event.ts` + Zod mirror
  `src/lib/schema/analytics-event.schema.ts`.

Reusability: this is a new shell overlay + copy + per-surface seen flags.
Reuse the `FlowCoach` seen-flag idiom, the `MobileNav` `isActive`
aliasing, the `MenagerieCelebrationHost` mount/host shape, and the
existing lucide `X` icon for dismiss: do **not** introduce a new inline
SVG, a global seen-state engine, or any emoji.

## Scope

- New component `src/lib/components/onboarding/SurfaceTip.svelte`: a
  small non-blocking card pinned just above the floating pillnav. Slides
  in after a short settle delay (~420 ms), `role="status"`, a lucide `X`
  dismiss button (`aria-label` from i18n), and a leading accent dot.
  Never traps focus, never blocks interaction below it.
- New `src/lib/components/onboarding/SurfaceTipHost.svelte` mounted once in
  `src/routes/(app)/+layout.svelte` beside `<MobileNav>`, gated on
  `$userSignedIn`. It maps the current route to its surface tip (Dash /
  Arena / Profile) using the same active-tab aliasing as `MobileNav`,
  self-gates on the per-surface seen flag and the new-user gate, and
  renders at most one `SurfaceTip` at a time.
- New per-surface seen flags in `src/lib/utils/onboarding-flags.utils.ts`:
  `TIP_DASH_SEEN_KEY` (`vici.tip-dash-seen`), `TIP_ARENA_SEEN_KEY`
  (`vici.tip-arena-seen`), `TIP_PROFILE_SEEN_KEY` (`vici.tip-profile-seen`),
  added to `ONBOARDING_SEEN_KEYS` so `clearOnboardingSeenFlags()` (and the
  identity-change reconcile) sweep them too.
- New i18n keys in the app's `tip.*`/onboarding namespace across all 12
  catalogs (English authored; other locales follow the repo's existing
  approach for new keys): one `title` + `body` per surface, plus a
  shared dismiss `aria` label.
- Gating: a tip shows only when the surface's seen flag is unset **and**
  the user is early (`totalTrades < 5`), so an established user is never
  interrupted. The surface is marked seen as soon as the tip is shown
  (seen-on-show), so it appears exactly once per device even if ignored.
- Intended behaviour: one tip at a time, fires only on actual navigation
  to the surface, resets its local enter/dismiss state on route change,
  renders nothing on surfaces without a tip or already seen.

### Out of scope

- The other first-run tutorial pieces: a generic global seen-state engine
  (the app already has per-flag seen state: we extend it, we don't add a
  global engine), the getting-started checklist, and the Tweaks "Replay
  tutorial" reset action. The "reset" path already exists as
  `clearOnboardingSeenFlags()`; wiring a user-facing replay control is a
  fast-follow, not this spec.
- Guest mode: not yet in the app. The "gate to new **and guest** users"
  clause degrades to "gate to new users" (`totalTrades < 5`) until guest
  mode lands; revisit then (see Open questions).
- The Profile team-pick affordance itself: the Profile tip only _nudges_
  toward picking a team (copy); the Affiliations picker is existing
  surface, untouched here.
- Desktop chrome. The tip is anchored to the mobile floating pillnav; the
  desktop top-nav (`DesktopAppNav`) is out of scope for v1 (see Pending
  decisions on desktop placement).
- Any new surfaces beyond Dash / Arena / Profile (the design enumerates
  exactly these three, see Decisions).

## Linked issues

GitHub MCP issue tools were not available in this authoring session, so
open issues could not be searched directly. Suggested search terms for
the implementer / reviewer to run before opening the PR: `onboarding tip`,
`surface tip`, `coachmark`, `tooltip`, `first-run`, `just-in-time`,
`tutorial`, `FlowCoach`. Treat as "no related issue found" unless that
search surfaces one; if it does, reference it (`Closes #N` if fully
addressed, else `Part of #N`).

## Analytics

Instrument the tip surface: a new onboarding affordance with no events is
invisible to product analysis (workflow default: yes). Reuse the existing
`onboarding_step` event name (already in both the TS union and the Zod
mirror) rather than minting a new name, so no taxonomy regen is needed:

- **`onboarding_step`** when a surface tip is shown, props:
  `source: 'surface_tip'`, `label: <surface>` where `<surface>` is the
  bounded vocabulary `'dash' | 'arena' | 'profile'`.
- **`onboarding_step`** when a tip is dismissed, props:
  `source: 'surface_tip_dismiss'`, `label: <surface>` (same vocabulary).

Both reuse existing `AnalyticsEventProps` keys (`source`, `label`):
bounded, behavioural, no PII, no free-form text. Capture via `track()` in
`src/lib/services/analytics.services.ts`.

If review prefers a dedicated name over overloading `onboarding_step`
(e.g. `surface_tip_shown` / `surface_tip_dismissed`), that requires the
dual-source addition (TS union in `analytics-event.ts` **and** the Zod
mirror in `analytics-event.schema.ts`) plus a declarations regen, since
the event name is a Candid variant. The `onboarding_step` reuse is the
recommended default precisely to avoid that cost, see Pending decisions.

## Implementation outline

1. Add `TIP_DASH_SEEN_KEY` / `TIP_ARENA_SEEN_KEY` / `TIP_PROFILE_SEEN_KEY`
   to `src/lib/utils/onboarding-flags.utils.ts` and append them to
   `ONBOARDING_SEEN_KEYS` so `clearOnboardingSeenFlags()` and the
   identity-scoped reconcile sweep them.
2. Add the `tip.*` i18n keys to `src/lib/constants/messages/en.ts`
   (titles, bodies, dismiss `aria`), then mirror into the other 11
   catalogs per the repo's new-key approach.
3. Build `src/lib/components/onboarding/SurfaceTip.svelte`: props
   `{ title, body, onDismiss }`; `role="status"`; lucide `X` dismiss
   button; accent dot; slide-in transition that respects
   `prefers-reduced-motion`; styled to sit above the pillnav in light /
   dark / peach themes (mirror `MobileNav`'s theme-variant pattern).
4. Build `src/lib/components/onboarding/SurfaceTipHost.svelte`:
   - derive the current surface from `page.url.pathname` using the same
     active-tab aliasing as `MobileNav.isActive` (extract that mapping to
     a shared helper if it would otherwise be duplicated: meta-update the
     reusability doc if so);
   - map surface → `{ seenKey, titleKey, bodyKey }`;
   - gate: render nothing unless `browser`, the seen flag is unset, and
     the user is early: `nonNullish($userStore.profile)` **and**
     `$userStore.profile.totalTrades < 5`. Require an actually-hydrated
     profile so an established user can't slip through the
     auth-hydration window (`undefined` profile) and get a tip shown;
   - on a qualifying surface, after the settle delay show the `SurfaceTip`,
     write the seen flag (FlowCoach idiom) and fire the `onboarding_step`
     shown event once: seen-on-show;
   - on dismiss, fire the dismiss event and hide;
   - reset local enter/dismiss state on route change.
5. Mount `<SurfaceTipHost />` in `src/routes/(app)/+layout.svelte` beside
   `<MobileNav>`, inside the `{#if $userSignedIn}` block.
6. `npm run quality` (covers prettier + eslint + the i18n completeness
   lint) and `npm run check` (svelte-check).

## Acceptance criteria

- [ ] First navigation to Dash / Arena / Profile by a qualifying user
      (`totalTrades < 5`, surface not yet seen) slides one tip in above
      the floating pillnav after a short settle delay.
- [ ] Only one tip is ever on screen; navigating to a second surface shows
      that surface's tip (if unseen), not a stack.
- [ ] The tip never blocks interaction with the content or the tab bar
      below it; it is dismissible via its `X` button and is `role="status"`
      (non-modal).
- [ ] Showing a tip marks that surface seen on the device (seen-on-show);
      it does not reappear on later visits in the same or a new session,
      whether or not it was dismissed.
- [ ] An established user (`totalTrades >= 5`) never sees any surface tip.
- [ ] `clearOnboardingSeenFlags()` and an identity (principal) change both
      clear the three new tip flags, so a fresh account re-sees the tips.
- [ ] Tip copy renders from i18n in all 12 catalogs (no raw keys); the
      Profile tip nudges picking a team.
- [ ] `onboarding_step` fires on show and on dismiss with the bounded
      `source` / `label` props; no new event name added to the taxonomy
      (unless the Pending decision flips to a dedicated name).
- [ ] Renders correctly in light, dark, and peach themes and respects
      `prefers-reduced-motion`.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- **Guest gating.** The design gates to "new **or** guest" users; the
  app has no guest mode yet. Confirm v1 gates on `totalTrades < 5` only,
  and that the gate should be revisited (add a guest predicate) when
  guest mode lands. Until then there is no guest path to interrupt.
- **`totalTrades` is the right early-user signal.** Confirm
  `UserProfile.totalTrades` is the lifetime call count that maps to the
  "calls < 5" gate (it reads as such in
  `src/lib/schema/profile.schema.ts`), and that it's populated on
  `$userStore.profile` early enough that a brand-new user's first surface
  visit still satisfies `< 5` (it should: a new profile defaults to 0).
- **Profile aliasing breadth.** `MobileNav` aliases `/wallet`,
  `/settings`, `/notifications`, `/profile/album` all to the Profile tab.
  Confirm the Profile tip should fire on the _first_ of any of these (the
  design keys off the Profile surface only). Recommended: fire on the
  canonical `/profile` route only, to avoid a "your identity lives here"
  tip popping on the Settings screen.

## Pending decisions

- **Analytics event naming.** Reuse `onboarding_step` (no regen, the
  recommended default) vs. mint dedicated `surface_tip_shown` /
  `surface_tip_dismissed` names (clearer funnels, but needs the dual-source
  taxonomy addition + declarations regen). Owner: product analytics.
- **Desktop placement.** v1 anchors to the mobile pillnav only. Decide
  whether a desktop equivalent (anchored to `DesktopAppNav`) ships now or
  as a fast-follow. Recommended: **fast-follow**: the first-run tutorial
  system is mobile-first and the pillnav is the intended anchor.

## Decisions

- **Surfaces and copy (the enumerated set).** Exactly three surfaces get
  a first-visit tip: Dash, Arena, Profile, with copy in the app's
  `tip.*` keys (English):
  - **Dash**: title: "This is your record"; body: "Accuracy, streak and
    rank build with every prediction you make. Check back to see how
    you're trending."
  - **Arena**: title: "Where you face off"; body: "Arena is leagues,
    friends and Worlds leaderboards: see how you rank against everyone
    else."
  - **Profile**: title: "Your identity lives here"; body: "Your handle,
    your Menagerie, and your team. Pick a team anytime to join the Worlds
    race." (this is the deferred-team-pick nudge.)
- **Keep the app i18n namespace and terminology.** Use the app's `tip.*`
  keys; always "prediction", never "bet"/"call" in user-facing copy.
- **No emoji, lucide icons.** Dismiss uses the lucide `X`; the leading
  accent dot is a styled element, not an emoji glyph.
- **Persistence via per-surface seen flags, reusing the existing pattern.**
  Three `vici.tip-*-seen` keys added to `onboarding-flags.utils.ts` and to
  `ONBOARDING_SEEN_KEYS`, using the `FlowCoach` `localStorage` idiom:
  identity-scoped, swept by `clearOnboardingSeenFlags()` and the principal
  reconcile. No new global seen-state engine.
- **Reuse `onboarding_step` for analytics by default**: avoids a taxonomy
  regen; see Pending decisions for the dedicated-name alternative.
- **Seen-on-show, not seen-on-dismiss.** A surface is marked seen as soon
  as its tip is shown, so it appears exactly once per device even if
  ignored: these are low-stakes, non-blocking nudges, and re-showing an
  ignored tip every session is more annoying than a single missed read.
  The `shown` event writes the seen flag; `dismiss` only fires analytics.
