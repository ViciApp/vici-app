# Spec: PWA install (Add-to-Home-Screen)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#978)

## Goal

Let a mobile user add VICI to their home screen so it launches
full-screen, like an app. On Android/Chrome the captured
`beforeinstallprompt` drives a one-tap native install dialog; on iOS
(where no install API exists) we show the manual Share → Add to Home
Screen steps. The ask appears in two calm, non-interruptive places: a
permanent row in Settings, and a contextual install row on the
end-of-session summary (`FlowEnd`) at the day's 10th- and 15th-call
milestones: never an auto-popup over Flow. The manifest, icons, and
iOS meta are already shipped (see Context); this spec adds only the
behaviour layer.

## Context

The install **chrome** already exists and is out of scope:

- `static/manifest.webmanifest` + `static/branding/*` (192 / 512 / 1024
  PNGs, `apple-touch-icon.png`, `vici-favicon.svg`).
- `src/app.html` already links the manifest, carries the iOS
  `apple-mobile-web-app-*` metas, and runs a pre-paint IIFE that detects
  iOS (UA + `MacIntel`/`maxTouchPoints` iPadOS-13 fix) and standalone
  (`navigator.standalone` + `display-mode: standalone`), stamping
  `data-ios`, `data-ios-bottom-bar`, and reading PWA-standalone state
  (`src/app.html:97-128`).

What is **missing** and this spec adds (Svelte 5 runes: behaviour +
copy):

- **Install engine.** Captures `beforeinstallprompt` / `appinstalled`,
  platform + standalone detection, session counting, `canInstall`,
  `shouldAutoPrompt(calls)`, `nativePrompt()`, and
  localStorage/sessionStorage persistence, as a typed Svelte module +
  store, not a `window` global.
- **Install sheet.** Android one-tap CTA vs iOS two-step Share/Add
  instructions; dismiss = cool-off.
- **Settings row.** A Preferences row gated on `canInstall`.
- **FlowEnd nudge.** An install row on the summary, shown only when
  `canInstall`.
- **i18n.** New `a2hs.*` + `settings.add_home*` keys.

App-side files this spec touches or reuses:

- **Engine (new):** `src/lib/stores/a2hs.store.ts`, a Svelte module +
  store, **not** a `window` global (decision below). Initialised early
  in `src/routes/(app)/+layout.svelte` so `beforeinstallprompt` is
  captured before any child mounts.
- **Sheet (new):** `src/lib/components/pwa/A2hsSheet.svelte`, built on
  the shared **`BottomSheet`** primitive
  (`src/lib/components/ui/BottomSheet.svelte`; supports `labelledBy`,
  `footer`, `desktopCentered`, focus trap). Mirrors the existing
  `LocaleSheet` / `DeleteAccountFlow` host pattern (`isOpen` / `onClose`).
  `pwa/` is a **new component sub-folder** under the existing
  `src/lib/components/` concern, flagged as a pending decision (folder
  taxonomy is closed; AGENTS.md §4).
- **Settings row:** `src/lib/components/pages/SettingsPage.svelte`: add
  a `SetRow` (`src/lib/components/settings/SetRow.svelte`) in the
  Preferences `SettingsSection`, gated on the store's `canInstall`,
  using the lucide `Download` (or `Smartphone`) icon. Opens the sheet via
  page-local `$state` exactly like `langSheetOpen` / `deleteSheetOpen`.
- **FlowEnd nudge:** `src/lib/components/market/FlowEnd.svelte`: add an
  install row above the existing `.flow-end-links` (Share · Invite),
  shown only when `canInstall`. It opens the same sheet; wiring is
  threaded from the FlowEnd host (`FlowMode.svelte`, which renders
  `<FlowEnd … />` at `src/lib/components/market/FlowMode.svelte:1237`).
- **Lifetime call count** (the trigger input) is the profile's
  `totalTrades`, already read in Flow as
  `$userStore.profile?.totalTrades`
  (`src/lib/components/market/FlowMode.svelte:876`). The day's milestone
  state is already modelled by `FlowEnd`'s `canExtend` (10th-call) and
  `overtime` (15th-call) props: these are the exact "10th / 15th" beats
  the trigger rules target.

Reusability (catalog = `docs/ai/frontend/reusability.md`):

- **`BottomSheet`**: the shared docked-sheet primitive (scrim, grip,
  focus trap, `Escape`/backdrop close, `footer`/`labelledBy`/
  `desktopCentered`). Do not build a new sheet.
- **`SetRow`**: the Settings list-row (`icon`, `label`, `sub`, `right`
  snippet, chevron). Use as-is for the Settings entry.
- **`SheetFooter`**: pinned-footer wrapper for the sheet's primary CTA.
- **`Button`**: primary/ghost CTA inside the sheet
  (`src/lib/components/ui/Button.svelte`) with its `status` (`pending`)
  state for the "Opening…" working state.
- **`notificationsStore`**: success/failure toast after install
  (already imported in both `SettingsPage` and `FlowEnd`).
- **`track`**: analytics (`src/lib/services/analytics.services.ts`).
- **i18n**: `t({ locale: $localeStore, key })` via
  `#lib/utils/i18n.utils`; catalogs under `src/lib/constants/messages/*`.

## Scope

- **Install engine** `src/lib/stores/a2hs.store.ts` (Svelte runes
  module + readable store):
  - On module init (browser only): add `beforeinstallprompt` (preventing
    the mini-infobar and stashing the event) and `appinstalled`
    listeners; bump the session counter once per tab-session.
  - State exposed as a store (reactive) **and** as plain functions:
    `platform()` (`'ios' | 'android' | 'desktop' | 'other'`),
    `isStandalone()`, `isMobileLike()`, `canInstall` (derived:
    not-standalone ∧ not-installed ∧ (iOS ∨ a captured prompt exists)),
    `sessionCount`, `shouldAutoPrompt(calls)`, `markDismissed()`,
    `markInstalled()`, `nativePrompt()` (fires the captured event,
    resolves `'accepted' | 'dismissed' | 'unavailable'`).
  - Platform/standalone detection reuses the **same** UA + iPadOS
    `maxTouchPoints` + `display-mode`/`navigator.standalone` logic the
    `app.html` bootstrap already uses (overlap flagged as an open
    question: do not duplicate the detection in two diverging places).
  - An `init()` called from the `(app)` layout so capture happens before
    mount (module-load side effects alone may run too late under
    SvelteKit code-splitting, pending decision below).
- **Install sheet** `src/lib/components/pwa/A2hsSheet.svelte` on
  `BottomSheet`:
  - Props `interface Props { isOpen; onClose; onInstalled? }` (named
    interface + destructure; no `window` global).
  - Header: app icon (`static/branding/` 512 asset), title, platform sub.
  - Android: a single primary `Button` → `nativePrompt()`; while
    awaiting, `status="pending"` ("Opening…"). On `'accepted'` →
    `onInstalled` + toast; close either way.
  - iOS: a two-step instruction list (Share glyph + "Tap **Share**…",
    plus glyph + "Choose **Add to Home Screen**") rendered with lucide
    icons (`Share` / `SquarePlus` or `Plus`), **no emoji**.
  - "Not now" dismiss → `markDismissed()` (starts cool-off) + `onClose`.
- **Settings row** in `SettingsPage.svelte` Preferences section, gated on
  `canInstall`; opens the sheet; success toast via the page's existing
  `flashToast` / `notificationsStore`.
- **FlowEnd nudge** in `FlowEnd.svelte`: an install row (icon + "Add VICI
  to Home Screen" + chevron) above the Share · Invite links, shown only
  when `canInstall`; opens the same sheet. New `onInstallPrompt?`/
  `canInstall` prop threaded from `FlowMode.svelte`, OR FlowEnd reads the
  store directly (pending decision). Gating naturally coincides with the
  10th/15th-call milestones because FlowEnd only renders at those beats.
- **i18n**: author every new `a2hs.*` and `settings.add_home*` key in
  **all** catalogs under `src/lib/constants/messages/` (en authored;
  every other catalog mirrored: the i18n lint fails on any missing key).

### Out of scope

- Manifest, icons, favicons, `apple-touch-icon`, iOS meta, and the
  pre-paint standalone/iOS bootstrap in `src/app.html`: **already done**.
- An **auto-popup** bottom sheet over the next Flow card (a mid-flow
  slide-over): explicitly out: the calm FlowEnd row replaces it, so there
  is no mid-flow interruption.
- A **preview iOS/Android** developer panel (a forced-platform debug
  affordance): no app equivalent. Deferred (note under Open questions if a
  debug hook is wanted).
- A custom **service worker** / offline caching. `display: standalone`
  install does not require one; offline support is a separate effort.
- Desktop install (the engine treats desktop as never-prompt).

## Linked issues

No related issue is currently known. Candidate search terms for the
implementation PR: `PWA`, `install`, `add to home screen`, `A2HS`,
`standalone`, `manifest`, `home screen`.

## Analytics

Instrument the install funnel: a brand-new surface with no events is
invisible. All names are **new** and must land in **both** halves of the
dual-source pair: the TS union `src/lib/types/analytics-event.ts` **and**
the Zod mirror `src/lib/schema/analytics-event.schema.ts`. Because the
satellite imports `AnalyticsEventName` from the FE type
(`src/satellite/services/analytics.services.ts:29`), adding a name also
requires `npm run juno:functions:build` and committing the regenerated
satellite bindings (`satellite_extension.did`, `api-schemas.ts`): same
cost the maker-disclosure spec flagged. Capture via `track(...)`.

Proposed events (behavioural only; bounded props):

- `pwa_install_prompted`: the sheet opened. `source`:
  `'settings' | 'flow_end'`. `label`: `platform`
  (`'ios' | 'android' | 'desktop' | 'other'`).
- `pwa_install_accepted`: native prompt accepted **or** `appinstalled`
  fired. `label`: `platform`.
- `pwa_install_dismissed`: "Not now" / native dismiss. `source`,
  `label`: `platform`.

Reuse the existing `source` (origin) and `label` (small categorical)
dimensions: no new prop fields. No PII, no free-text.

Pending decision: whether three events are worth the regen cost or a
single `pwa_install` event with a `label` outcome
(`prompted | accepted | dismissed`) suffices: fewer names, coarser
funnel.

## Implementation outline

1. **Engine.** Add `src/lib/stores/a2hs.store.ts`: a runes module that on
   first browser load wires `beforeinstallprompt` / `appinstalled`, bumps
   the per-tab-session counter, and exposes the API (above): a readable
   store for `canInstall` / `sessionCount` plus the imperative
   `nativePrompt` / `markDismissed` / `markInstalled` / `shouldAutoPrompt`.
   No `0n` (`ZERO`), no `return undefined;`, no relative imports, use
   `isNullish` / `nonNullish`. Persistence keys (below) are literals in
   this module.
2. **Init early.** Call the engine `init()` from
   `src/routes/(app)/+layout.svelte` (`onMount`, alongside the existing
   `document.documentElement.dataset.app` setup) so capture beats child
   mount.
3. **Sheet.** Add `src/lib/components/pwa/A2hsSheet.svelte` on
   `BottomSheet` (`labelledBy` the title id, `SheetFooter` for the CTA),
   Android one-tap vs iOS two-step, lucide icons, i18n copy, dismiss →
   `markDismissed`.
4. **Settings row.** In `SettingsPage.svelte`, add a `canInstall`-gated
   `SetRow` to the Preferences `SettingsSection`, a page-local
   `a2hsSheetOpen = $state(false)`, mount `<A2hsSheet>` beside
   `<LocaleSheet>` / `<DeleteAccountFlow>`, toast on success.
5. **FlowEnd nudge.** In `FlowEnd.svelte`, add a `canInstall`-gated
   install row above `.flow-end-links`; thread the open handler +
   `canInstall` from `FlowMode.svelte` (or read the store directly,
   pending decision); mount/open the same `<A2hsSheet>`.
6. **i18n.** Add `a2hs.*` + `settings.add_home*` keys to
   `src/lib/constants/messages/en.ts`, then mirror into every other
   catalog in that directory (`de`, `es`, `es-419`, `es-AR`, `es-MX`,
   `fr`, `it`, `ja`, `pt`, `pt-BR`, `zh-Hans`). Terminology: "prediction",
   never "bet"; no emoji.
7. **Analytics.** Add the event name(s) to the TS union + Zod mirror,
   `track(...)` at prompt-open / accept / dismiss, run
   `npm run juno:functions:build`, commit the regenerated bindings.
8. **Gates.** `npm run quality` (format + lint + i18n completeness) and
   `npm run check` (svelte-check). Update `docs/ai/PRODUCT.md` (install
   surfaces + trigger rules) and the reusability catalog (new `pwa/`
   component) in the same PR.

### Trigger thresholds (concrete)

Surfaced as named constants in `a2hs.store.ts`:

- `A2HS_PRIMARY_CALLS = 15`: primary window: lifetime calls ≥ 15.
- `A2HS_FALLBACK_CALLS = 10`: fallback window: `sessionCount ≥ 2` **and**
  lifetime calls ≥ 10 (a 2nd+ return visit).
- `A2HS_COOLOFF_MS = 14 * 24 * 60 * 60 * 1000`: re-ask no sooner than 14
  days after a dismissal. (`_ms` suffix per the time-variable rule.)
- Always-false guards: not mobile-like (desktop never prompts), already
  installed/standalone, in cool-off, already shown this session.

Note: because the surfaces are the **Settings row** and the **FlowEnd
row** (both pure `canInstall()` gates, not auto-popups), and FlowEnd only
renders at the day's 10th (`canExtend`) and 15th (`overtime`) calls, the
`shouldAutoPrompt(calls)` thresholds are what decide whether the FlowEnd
row appears at each milestone. `canInstall()` alone gates the
always-available Settings row.

### Persistence keys (concrete)

localStorage:

- `vici.a2hs.sessions`: distinct-visit counter (int).
- `vici.a2hs.dismissed`: last-dismissal timestamp (ms; drives cool-off).
- `vici.a2hs.installed`: `'1'` once installed/handled (suppresses all).
- `vici.a2hs.lastShown`: last auto-prompt timestamp (ms).

sessionStorage (per tab-session):

- `vici.a2hs.session-counted`: this visit already counted.
- `vici.a2hs.shown`: the prompt was already shown this session
  (once-per-session guard).

Reuse `#lib/utils/storage.utils` (`set`/`get`/`has`) where it fits; wrap
raw `sessionStorage` access in try/catch (private-mode / blocked-storage
safe).

## Acceptance criteria

- [ ] On Android/Chrome, opening the install sheet and tapping the CTA
      fires the captured `beforeinstallprompt`; accepting installs the
      app and marks it installed (no re-prompt thereafter).
- [ ] On iOS Safari, the sheet shows the two-step Share → Add to Home
      Screen instructions with lucide icons (no native CTA, no emoji).
- [ ] The Settings → Preferences install row appears only when
      `canInstall()` (mobile, not installed, not standalone) and opens the
      sheet; it is hidden on desktop and inside an installed PWA.
- [ ] The FlowEnd install row appears only when `canInstall()`, sits above
      the Share · Invite links, and opens the same sheet, with **no**
      auto-popup over the Flow deck.
- [ ] The trigger rules hold: primary at lifetime calls ≥ 15, fallback at
      ≥ 10 on a 2nd+ session, never when installed/standalone, at most
      once per session, and not within the 14-day cool-off after dismiss.
- [ ] The engine is a Svelte module + store (no `window` global) and is
      initialised in the `(app)` layout so `beforeinstallprompt` is
      captured before child mount.
- [ ] New `a2hs.*` / `settings.add_home*` keys exist in **every** catalog
      under `src/lib/constants/messages/`; `npm run quality` passes the
      i18n check.
- [ ] Install funnel analytics fire (prompted / accepted / dismissed) with
      bounded `source` + `label` props; the new name(s) exist in the TS
      union **and** the Zod mirror, and the regenerated satellite bindings
      are committed.
- [ ] `npm run check` passes; `PRODUCT.md` and the reusability catalog are
      updated in the same PR.

## Open questions

- **iOS-detection overlap with `app.html`.** The pre-paint bootstrap in
  `src/app.html:97-128` already computes iOS (UA + `MacIntel`/
  `maxTouchPoints`) and standalone (`navigator.standalone` +
  `display-mode: standalone`) and stamps `data-ios` /
  `data-ios-bottom-bar`. The engine needs the same facts. Does it read the
  already-stamped `data-ios` / a standalone flag from the DOM (single
  source), or re-derive independently (two detectors that can diverge)?
  Prefer a single source: confirm whether `app.html` should also expose
  the standalone result (it currently only branches `data-ios-bottom-bar`
  on it, doesn't persist "standalone" itself).
- **`beforeinstallprompt` timing under SvelteKit.** Confirm that wiring
  the listener from the `(app)` layout `onMount` (or a module side-effect
  imported there) is early enough to catch Chrome's event on a cold load,
  versus needing it in `src/hooks.client.ts` or a top-level `+layout`.
  The public `/markets` and `/info` routes also live under `(app)`; an
  install offer there is harmless but verify capture isn't missed for a
  user who never enters the authenticated shell.
- **Lifetime-call source for the trigger.** Confirm `profile.totalTrades`
  is the right lifetime-call field for `shouldAutoPrompt` (it is what
  Flow's motion engine already treats as the lifetime call count,
  `FlowMode.svelte:876`), and that it is populated for the user at the
  FlowEnd beat.
- **`appinstalled` reliability.** Confirm marking installed on
  `appinstalled` (plus on `'accepted'`) is sufficient; iOS never fires
  `appinstalled`, so an iOS user who completes the manual steps is only
  detected as standalone on the _next_ launch: acceptable?

## Pending decisions

- **New component folder `src/lib/components/pwa/`.** The taxonomy is
  closed (AGENTS.md §4): adding a sub-folder needs an explicit call.
  Alternative: place the sheet under an existing concern (e.g.
  `components/ui/` or `components/settings/`). Owner: FE lead.
- **FlowEnd wiring shape.** Thread `canInstall` + an `onInstallPrompt`
  handler as `FlowEnd` props from `FlowMode.svelte` (keeps `FlowEnd`
  store-agnostic, matches its current all-props contract), **or** let
  `FlowEnd` import the `a2hs.store` directly (less plumbing). Lean: props,
  for testability and consistency with FlowEnd's existing shape.
- **Three analytics events vs. one.** Three (`pwa_install_prompted` /
  `_accepted` / `_dismissed`) give a clean funnel; a single `pwa_install`
  with a `label` outcome is cheaper on names/regen. Lean: three, matching
  the existing per-action taxonomy granularity.
- **Engine init location.** `(app)` layout `onMount` vs.
  `src/hooks.client.ts`: depends on the timing open question above.

## Decisions

- **Svelte module + store, not a `window` global.** The engine lives in
  `src/lib/stores/a2hs.store.ts` so consumers import typed state and the
  gating is reactive, aligning with the codebase's store/derived
  conventions and avoiding an untyped global.
- **Initialise the engine early in the `(app)` layout.** So
  `beforeinstallprompt` is captured before any child component mounts
  (the browser fires it once, early); a lazily-imported engine would miss
  it.
- **Surfaces are a Settings row + a FlowEnd row, gated on `canInstall`,
  never an auto-popup.** The FlowEnd row inherits the 10th/15th-call
  milestone timing for free because FlowEnd only renders at those beats.
- **Reuse `BottomSheet` (+ `SheetFooter`, `SetRow`, `Button`,
  `notificationsStore`).** No new sheet/row primitive; the install sheet
  is one more `BottomSheet` host like `LocaleSheet` / `DeleteAccountFlow`.
- **Behaviour + UI + copy in Svelte 5 runes.** English copy lands as real
  keys in every catalog; all glyphs are lucide icons (no emoji, no inline
  SVG).
- **Manifest/icons are done: scope is engine + sheet + Settings row +
  FlowEnd nudge + i18n only.**
