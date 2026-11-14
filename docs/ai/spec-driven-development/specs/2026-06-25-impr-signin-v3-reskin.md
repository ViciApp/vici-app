# Spec: Sign-in V3 re-skin + passkey-first email path

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#982)

## Goal

Make the returning-user sign-in screen one visual family with the V3
onboarding (sign-up) surface, and make the email path read as
passkey-first. Today `/signin` renders a different composition from the
V3 sign-up: a "Sign in to {brand}" title, a social-proof
predictors/calls line, an Apple provider returning users can't actually
have created an account with, and a **cream** Google pill that flashes
mid-transition when the theme switches in light/peach. After this change
the screen reads `Welcome **back.**` (sans + serif-italic accent,
mirroring the V3 italic-accent headline), brand pinned top, hero + auth
clustered top-down with the secondary "create account" + legal anchored
below; the only providers are a **dark** Google pill and a **light**
email pill, where email goes straight to a device passkey (WebAuthn):
no magic link, no Apple.

## Context

The app is Svelte 5 runes. The relevant divergences are concrete and
already mapped to real files.

**Intended design**, the target look and behaviour:

- Re-skin to share the V3 visual system: brand pinned top, hero
  optically composed at the top, "create account" + legal anchored to
  the bottom of the frame, hairline divider between task and footer.
- `Welcome **back.**` hero: sans phrase + one serif-italic accent
  word, mirroring the V3 italic-accent headline.
- Social-proof predictors/calls line removed.
- Email path → device passkey (WebAuthn), `autocomplete="email
webauthn"`, **no** magic-link "sent" state.
- Providers: **Google + email only**; Apple dropped (no one signs up
  with Apple in V3, so offering it to returning users was misleading).
- **Dark** Google pill + **light** email pill.
- Light/peach contrast: a concrete dark ink pill for Google, and
  **drop `background` from the pill's CSS transition** so a runtime
  theme switch doesn't animate the pill through a cream mid-state
  (the theme-switch flash).

**App (current) state**, what actually renders today:

- `src/routes/signin/+page.svelte`: the `/signin` route; renders
  `SignInScreen mode="signin"`, bounces an already-authenticated user
  to `AppPath.Flow`.
- `src/lib/components/authn/SignInScreen.svelte`, the screen shell:
  wordmark, eyebrow, title (`titleParts.before` + a hardcoded
  serif-italic accent span + `after`), subcopy, **the social-proof
  block** (`.signin-proof`, reading `signin.proof.predictors_*` /
  `signin.proof.calls_*`), the provider stack, and the footer + legal.
  It is **already** the shared shell for both `signin` and `signup`
  modes via the `mode` prop.
- `src/lib/components/authn/SignInProviderStack.svelte`: the auth
  authority. It **already** implements the passkey-first email path
  (`onEmailSubmit` → `signUp`/`signIn({ webauthn })`, **no magic
  link**, progressive disclosure, `signin.email.fineprint` =
  "Secured with a passkey…"). It also **already renders Apple**
  (`APPLE_LOGIN_ENABLED = true`, `ob-dark` pill) and renders **Google
  as a cream pill** (`ob-cream`). II/passkey/dev rows are
  production-/dev-gated. The shared `startSignIn` wrapper drives
  per-provider loading + the `is-faded` dim-others state.
- CSS in `src/app.css`:
  - `.signin-wrap` / `.signin-card` / `.signin-head`, the current
    layout: head is a top block with `margin-bottom: 28px`, not a
    centered-hero + bottom-anchored-footer composition.
  - `.signin-provider-btn` base, its `transition` shorthand
    **includes `background 200ms`**: this is the theme-switch-flash
    vector.
  - `.signin-provider-btn.is-onboarding.ob-dark`: solid ink pill
    (Apple today; the target Google pill).
  - `.signin-provider-btn.is-onboarding.ob-cream`: cream pill (Google
    today; to be retired from the sign-in path).
  - `.signin-proof`: the social-proof line styling.
  - `.signin-foot` / `.signin-legal`: footer + legal.
- i18n catalogs: `src/lib/constants/messages/*.ts` (12 locales,
  English authored in `en.ts`). The real sign-in keys live under
  `signin.*` (e.g. `signin.title.signin` = "Sign in to {brand}",
  `signin.eyebrow.signin` = "WELCOME BACK", `signin.sub.signin`,
  `signin.provider.google` / `.email`, `signin.email.cta` /
  `.fineprint` / `.placeholder`, `signin.proof.*`, `signin.footer.*`,
  `signin.legal.*`, `signin.provider.apple` / `signin.loading.apple`).
  Note: this app has **no** `signin.send_link` / `signin.sent_*` /
  `signin.sending` keys; the email path is already magic-link-free, so
  no "sent" state copy exists or is needed.

**Reuse first** (per `docs/ai/frontend/reusability.md`): keep
`SignInProviderStack` as the single auth authority; both `/signin` and
the "sign in to continue" modals (`SignInModal`) depend on it, and the
sign-up onboarding renders it in `signup` mode. Do **not** fork a
sign-in-only stack. Keep `SignInScreen` as the shared shell driven by
`mode`. Reuse the existing `.serif-italic` + `.acc` accent pattern in
`src/app.css` (already used by `.signin-title`) for the "back." accent.
The `ob-dark` / `ob-faint` pill classes already exist;
the Google pill moves from `ob-cream` to `ob-dark`.

## Scope

A re-skin of the **shared** sign-in shell + a provider-stack trim and a
CSS contrast/flash fix. No new auth mechanics: the passkey-first email
path already ships; this aligns the visual system and removes the
provider/copy/social-proof drift.

1. **Drop Apple from the provider stack.** Set
   `APPLE_LOGIN_ENABLED = false` in `SignInProviderStack.svelte` so the
   stack offers exactly Google + email (II/passkey/dev stay
   production-/dev-gated as today). The Apple `onApple` handler and
   `apple-signin.services` import may remain dormant behind the flag
   (cheap to re-enable); see Pending decisions.
2. **Dark Google pill.** Change the Google button's pill class from
   `ob-cream` to `ob-dark` so it reads as the primary dark pill and the
   email pill (`ob-faint`) reads as the lighter secondary.
3. **Drop the social-proof line.** Remove the `.signin-proof` block
   from `SignInScreen.svelte` (predictors/calls).
4. **"Welcome back." hero.** Change `signin.title.signin` to the
   `Welcome {brand}` shape with the brand placeholder carrying the
   accent word "back." so the existing `titleParts` split renders
   `Welcome ` + `<span class="serif-italic acc">back.</span>`. The
   hardcoded accent span in `SignInScreen.svelte` is replaced by the
   placeholder-driven accent so signin/signup/onboarded
   titles each control their own accent via copy. The redundant
   `signin.eyebrow.signin` ("WELCOME BACK") is dropped from the signin
   path so the eyebrow doesn't echo the hero (signup/onboarded eyebrows
   unchanged). Final hero/eyebrow copy is a Pending decision.
5. **Layout re-skin.** Adjust `.signin-wrap` / `.signin-card` /
   `.signin-head` (and add a footer-anchor rule) so the composition is:
   brand → hero → auth clustered top-down as one unit, secondary
   "create account" + legal anchored to the bottom of the frame, with
   the existing hairline divider reading as the task/footer separator.
   The composition is a `flex-start` cluster + bottom footer; full
   vertical centering is deliberately avoided because it strands the
   brand. Pure CSS + minor markup grouping in `SignInScreen.svelte`;
   the provider stack markup is untouched.
6. **Theme-switch flash fix.** Drop `background` from the
   `.signin-provider-btn` `transition` shorthand (keeping `opacity`,
   `border-color`, `transform`). With Google now `ob-dark` (a stable
   ink pill in every theme) and no animated `background`, a runtime
   light↔dark/peach switch no longer animates any sign-in pill through a
   cream mid-state.
7. **Dead i18n keys.** The keys that become unused on the sign-in path:
   `signin.proof.predictors_count` / `signin.proof.predictors_label` /
   `signin.proof.calls_count` / `signin.proof.calls_label` (social
   proof, removed) and, once Apple is flag-off, `signin.provider.apple`
   / `signin.loading.apple`. The i18n lint flags **missing** keys, not
   unused ones, so leaving them is lint-safe; this spec **removes** the
   four `signin.proof.*` keys from all 12 catalogs (they have no other
   caller; confirm in Open questions) and **keeps** the Apple keys
   (the handler stays behind the flag). See Pending decisions.

### Out of scope

- **Sign-up / V3 onboarding visuals.** The sign-up surface is already
  the V3 design; this spec only pulls sign-in into the same family. Any
  `signup` / `onboarded` copy or layout change beyond what the shared
  shell forces is out of scope.
- **OAuth-brand-compliant buttons.** The dark Google pill is **not**
  Google-brand-compliant; a pre-launch OAuth-compliance pass for both
  screens is deferred. This spec ships the cohesive dark pill now;
  brand-compliant provider buttons are a separate pre-launch task.
- **Removing the Apple code path.** Deleting `onApple` /
  `apple-signin.services` / the Apple icon + keys is deferred: the
  flag-off is reversible and low-risk; a hard removal is a separate
  cleanup if product confirms Apple is permanently gone.
- **Internet Identity / passkey / dev rows.** Their existing
  production-/dev-gating is unchanged; they are not part of the V3
  "Google + email" primary pair and render only where gated as today.
- **The `SignInModal` ("sign in to continue") surface.** It reuses the
  same provider stack, so the Apple-drop + dark-Google changes flow to
  it for free; no modal-specific layout work is in scope.

## Linked issues

Searched the repository's open issues
(`repo:ViciApp/vici-app`) for sign-in / signin / auth / passkey
/ Google: **0 open issues**. No related issue; this is a sign-in
re-skin improvement with no tracking issue to close.

## Analytics

Instrument the sign-in funnel: this surface emits **no** analytics
today, so provider choice and sign-in success are invisible to product.
The taxonomy already reserves the names; they are simply not fired yet:

- **`signed_in`**: fire from the provider stack's `startSignIn`
  success path (and `onApple`'s success path, though Apple is now
  flag-off) for `mode === 'signin'`. Props: `source = 'signin_screen'`
  (bounded; vs the modal which would pass `'signin_modal'`); `label` =
  the provider id (bounded vocabulary: `google | email | passkey | ii |
dev`; note `email` resolves to a passkey ceremony but is a distinct
  user-facing choice worth distinguishing).
- **`provider_linked`**: already named in the taxonomy "(Google /
  Apple / Passkey / II)". Optional companion for the same success
  point; `label` = provider id. Recommend deferring unless product
  wants link-vs-authenticate split: `signed_in` with a `label` already
  carries provider choice. See Pending decisions.
- **`signed_up`** is the sign-up-mode counterpart; this spec touches
  the shared stack, so wiring `signed_in` for `signin` mode naturally
  sits beside a `signed_up` for `signup` mode. Whether to also fire
  `signed_up` here is a Pending decision (it belongs to the sign-up
  funnel, which is out of scope, but the firing point is the same
  `startSignIn` success).

No new event **names** are needed: `signed_in` / `provider_linked` /
`signed_up` are already in **both** halves of the dual-source pair
(`src/lib/types/analytics-event.ts` union and
`src/lib/schema/analytics-event.schema.ts` Zod mirror, both verified
present). Only `props` are added, drawn from the existing bounded
`label` / `source` dimensions (`AnalyticsEventProps` in
`analytics-event.ts`): no schema regen, no new Candid variant.
Capture via `track` in `src/lib/services/analytics.services.ts`.
Behavioural only: `label`/`source` are bounded vocabularies, the email
address is **never** a prop (no PII).

## Design artifacts (frontend, optional)

Not authored in this draft. If the layout re-skin needs reviewer
sign-off before the build, attach an HTML mock under
`./2026-06-25-impr-signin-v3-reskin/` with a `data-theme` switcher
rendering dark + light + peach (the contrast fix is theme-specific) and
a "copy instructions" button, required by the workflow for any
theme-varying mock. The dark-Google-pill + flash-fix is the variant
most worth showing across themes.

## Implementation outline

1. **Provider stack** (`SignInProviderStack.svelte`): set
   `APPLE_LOGIN_ENABLED = false`; change the Google button's pill class
   from `ob-cream` to `ob-dark`. Email/passkey logic untouched (already
   passkey-first, magic-link-free). In `startSignIn`'s success path,
   `track({ name: 'signed_in', source: 'signin_screen', label: id })`
   when `mode === 'signin'` (and the agreed sign-up counterpart per the
   Pending decision).
2. **Shell** (`SignInScreen.svelte`): remove the `.signin-proof` block;
   replace the hardcoded `VICI.` accent span with the
   placeholder-driven `titleParts` accent (so the accent word comes
   from copy); drop the eyebrow on the signin path (keep for
   signup/onboarded); group brand + hero + stack as the top cluster and
   the footer prompt + legal as the bottom-anchored unit for the new
   layout.
3. **CSS** (`src/app.css`): drop `background` from the
   `.signin-provider-btn` `transition` shorthand; adjust
   `.signin-wrap` / `.signin-card` / `.signin-head` and add the
   footer-anchor rule for the brand-top / hero-cluster /
   footer-bottom composition; remove the now-unused `.signin-proof`
   rules. Verify the dark Google pill and the email pill contrast in
   dark, light, and peach.
4. **i18n** (`src/lib/constants/messages/*.ts`, 12 locales): set the
   `signin.title.signin` "Welcome {brand}" copy with "back." as the
   accent word per locale (one-word locales may put the whole phrase in
   the accent with an empty prefix as the per-locale split requires);
   remove the four `signin.proof.*` keys from
   every catalog. Run the i18n completeness lint.
5. **Quality**: `npm run quality` (prettier + eslint + i18n) and
   `npm run check` (svelte-check). Update `docs/ai/PRODUCT.md`'s
   sign-in description (Google + email only, passkey-backed email, V3
   visual family) in the same PR.

## Acceptance criteria

- [ ] `/signin` shows only **Google** (dark pill) and **email** (light
      pill) as primary providers; **no Apple** button renders.
- [ ] The hero reads `Welcome **back.**` with "back." in the
      serif-italic accent, and the eyebrow no longer repeats "WELCOME
      BACK".
- [ ] The social-proof predictors/calls line no longer renders, and the
      `signin.proof.*` keys are removed from all 12 catalogs.
- [ ] The email path opens to an inline email input
      (`autocomplete="email webauthn"`) and submitting runs a WebAuthn
      passkey ceremony; there is **no** magic-link "sent" state at any
      point.
- [ ] Composition is brand-top → hero+auth cluster → "create account" +
      legal anchored at the bottom, with the hairline divider reading as
      the task/footer separator.
- [ ] Switching theme at runtime (dark ↔ light ↔ peach) shows **no**
      cream/background flash on any sign-in pill; the Google pill is a
      stable dark ink pill in every theme.
- [ ] `SignInModal` (sign-in to continue) inherits the Apple-drop +
      dark-Google changes without regressions.
- [ ] `signed_in` fires once per successful sign-in with
      `source = 'signin_screen'` and `label` = provider id, validates
      against the Zod mirror, and carries no email/PII prop.
- [ ] `npm run quality` + `npm run check` pass.

## Open questions

- Are the four `signin.proof.*` keys referenced **anywhere** other than
  `SignInScreen.svelte`? (Grep before deleting; they appear sign-in
  only, but confirm no onboarding/landing reuse exists in any catalog
  consumer.)
- Does `titleParts` correctly render a **trailing** accent when the
  placeholder sits at the end of the template (`Welcome {brand}` →
  `before = "Welcome "`, `after = ""`)? The current `signin` title has
  the brand mid-string; verify the end-placeholder case renders the
  accent + period cleanly (it should, given the slice logic, but
  confirm with the period inside vs outside the span).
- Confirm `track` is safe to call from `SignInProviderStack` before the
  principal is established for a fresh sign-in (the taxonomy notes
  identity is "absent before sign-in; stitched from `sessionId` on
  auth"), i.e. firing `signed_in` at the `onSuccess` boundary attaches
  the correct (now-authenticated) principal, not an anonymous one.

## Pending decisions

- **Analytics breadth.** Ship `signed_in` (recommended). Decide whether
  to also fire `provider_linked` (link-vs-authenticate split, likely
  redundant with `signed_in`'s `label`) and whether to wire the
  `signed_up` counterpart here (its firing point is the same shared
  `startSignIn` success, but it belongs to the out-of-scope sign-up
  funnel).
- **Final hero / eyebrow copy per locale.** "Welcome **back.**" is the
  English target; each of the 12 locales needs its own accent-word
  split (some languages may carry the whole phrase in the accent with
  an empty prefix). Owner/loc to approve the per-locale strings.

## Decisions

Recorded from the planning handoff (the calls already made):

- **Re-skin the live `/signin` outright: no flag gate** (owner
  decision, 2026-06-25). `SignInScreen` is already the only sign-in
  shell for both the page and the modal, so the V3 look applies
  everywhere; there is no second path to gate and forking one would
  violate the single-shell reuse rule.
- **Drop Apple by flag-off, keep the code dormant** (owner decision,
  2026-06-25). Set the Apple provider flag off; leave `onApple` /
  `apple-signin.services` / the Apple icon + keys in place (reversible).
  Hard removal is a separate later cleanup only if Apple is confirmed
  permanently gone.
- **Keep the app's `signin.*` i18n namespace**: new/changed copy
  lands under the existing `signin.*` keys; no alternate key scheme is
  introduced.
- **No emoji**: the app uses lucide icons (`Mail`, `ChevronRight`);
  no inline SVGs or glyphs are added beyond the existing `IconGoogle`
  component.
- **Independent of the other sign-in/onboarding specs**: this
  re-skin can ship first; it touches only the shared sign-in shell, the
  provider stack flags/classes, the sign-in CSS block, and `signin.*`
  copy, with no dependency on a sign-up/onboarding spec.
- **`SignInProviderStack` stays the single auth authority**: the
  re-skin changes flags, one pill class, and adds analytics; it does
  **not** fork a sign-in-only stack. The passkey-first, magic-link-free
  email path it already implements is the target behaviour, not a new
  build.
