# Spec: Onboarding picks persist across every sign-in provider

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#926)

## Goal

A user's onboarding picks, backed team/country
(`preferences.favoriteParticipantId`), first call
(`preferences.favoriteSide`), handle, and the
`onboardingCompleted` flag, land on the new profile **no matter which
sign-in provider finishes the flow**, including Google. Today they
reliably survive only the in-page providers; a Google sign-up (the
primary, cream-filled provider) silently drops them, which is the
recurring "the country I picked during onboarding isn't saved" report
that prior fixes never closed because they all hardened the write path,
never the path that runs for Google.

## Context

The 3-beat onboarding flow
(`src/lib/components/onboarding/OnboardingFlow.svelte`) holds the picks
as local component `$state`: `participantId` (team/country), `side`,
`handle`. Beat 1a picks the team, 1b the first call, 2 the handle, 3 is
the auth gate (`OnboardingBeat3.svelte` → `SignInProviderStack` with
`mode="signup"`, `onSuccess={onComplete}`).

How picks reach the profile today:

- Beat 3's `SignInProviderStack`
  (`src/lib/components/authn/SignInProviderStack.svelte`) runs the chosen
  provider inside `startSignIn({ run })`, then calls `onSuccess?.()`
  **after `run()` resolves** (line ~93).
- `onSuccess` bubbles to `OnboardingFlow.handleAuthComplete` →
  `onComplete({ participantId, side, handle })` →
  `src/routes/signup/+page.svelte` `handleComplete`. Signed-out at the
  gate, so it routes to `handleCompletePreAuth`, which is the **only**
  writer of `participantId`/`side` into the
  `PENDING_ONBOARDING_STORAGE_KEY` (`vici:pending-onboarding`) stash.
- After sign-in, `(app)/+layout.svelte`'s drain effect (~222) runs
  `drainPendingOnboarding`
  (`src/lib/services/onboarding-handoff.services.ts`), which applies the
  stash to the profile via `applyOnboardingPicks`
  (`src/lib/services/profile.services.ts`) on the **new-user** branch
  (`!profileExisted`).

The write path itself is sound: `applyOnboardingPicks` writes handle +
team + side in one serialized `patchProfile` patch, the satellite
`UserProfileSchema` round-trips `favoriteParticipantId`
(`src/satellite/api-schemas.ts`, `withProfileDefaults` in
`src/satellite/services/profile.services.ts`), and
`calculateAndSyncStats` only patches stat fields: it never touches
`preferences`. So the picks are **not clobbered after being written**.

### Root cause 1: redirect providers never reach the stash (primary)

Google is configured as a **full-page OAuth redirect**, not a popup
(`SignInProviderStack.onGoogle`, ~137):

```ts
await signIn({
	google: {
		options: {
			redirect: {
				redirectUrl: `${window.location.origin}/auth/callback/google`
			}
		}
	}
});
```

`signIn()` navigates the document to Google, so the `await` never
resolves in this page and `onSuccess?.()` (line ~93) **never fires**.
The picks live in `OnboardingFlow` state, which the redirect destroys.
On return, `src/routes/auth/callback/google/+page.svelte` only finishes
auth (`handleRedirectCallback`) and routes to Flow: it cannot recover
picks that were never stashed. The drain then finds **no pending
payload** (or only a referral/email stashed elsewhere), so team/side
are gone. Handle still _looks_ right because `ensureProfile` seeds a
nickname from the OAuth display name at bootstrap, which is exactly
why the report is always "the country didn't save," not "my handle
didn't save."

Apple proves the pattern: `onApple` calls `onSuccess?.()` **before**
`window.location.assign(Flow)` (~132), so its picks are stashed before
it leaves the page. Google has no equivalent pre-redirect stash.

### Root cause 2: the drain reads `profileExisted` reactively (hardening)

The drain effect captures `$userStore.profileExisted` at effect-run
time. Svelte effects run async, and `onAuthStateChange`
(`src/lib/components/authn/Authn.svelte`) can fire a second pass; the
2nd `ensureProfile` finds the doc the 1st pass just bootstrapped →
`existed: true` → `userStore.set({ profileExisted: true })`. If that
lands before the drain effect runs, the drain takes the
`account_exists` branch and applies **nothing**. This is a real,
timing-dependent way for even an in-page provider to drop picks, and it
hides behind root cause 1 for Google.

### Reusability

`handleCompletePreAuth` in `signup/+page.svelte` is already the correct,
merge-safe stash writer (it preserves a referral code / email stashed by
`/i/[code]`, `/league/[code]`, or the email provider). The fix reuses
it rather than adding a second stash path.

## Scope

### 1. Stash picks before any sign-in is initiated (primary fix)

Make the onboarding picks durable in `PENDING_ONBOARDING_STORAGE_KEY`
**when the user reaches Beat 3**, before they tap any provider, so a
full-page redirect (Google, and any future redirect provider) can't
carry them off in volatile component state.

- `OnboardingFlow.svelte`: when advancing into Beat 3 (`handleHandle`,
  and on mount if the flow opens straight on a later beat), emit the
  current `{ participantId, side, handle }` through a new
  `onPicksReady` callback. Re-emit whenever the picks change and the
  user returns to Beat 3 (e.g. `handleAuthBack` → edit → forward).
- `signup/+page.svelte`: wire `onPicksReady={handleCompletePreAuth}`.
  This writes the same merge-safe pre-auth stash that `onComplete`
  writes today, but **before** the provider runs. Keep the existing
  `onComplete` wiring unchanged: in-page providers still take the
  authenticated direct-write path (`handleCompleteAuthenticated`), and
  the redirect providers now have a stash waiting for the drain.
- Idempotency: the early stash + a later `onComplete`/drain applying the
  same picks is a no-op re-write of identical values. The authenticated
  direct-write path already stamps `onboardingCompleted: true`; a
  leftover identical stash drained afterward changes nothing.

### 2. Make the drain's new-user decision deterministic (hardening)

Capture "this sign-in bootstrapped the profile" at the moment
`ensureProfile` creates it, sticky for the session, so a second
`onAuthStateChange` pass cannot flip the drain into the
`account_exists` branch.

- `profile.services.ts`: record the principal in a session-scoped
  "bootstrapped this session" set when `ensureProfile` creates a new doc
  (`existed: false`), exposed via a small getter. Cleared on sign-out
  (`Authn.svelte`'s null-user branch, via `forgetBootstrappedThisSession`)
  so a sign-out → sign-in in the same tab is judged fresh and a returning
  user isn't re-run through the new-user branch: the double-pass race
  this guards is within one sign-in (both passes carry a non-null user),
  so clearing on sign-out never reopens it.
- The drain treats a principal bootstrapped this session as new
  regardless of a later racy `getDoc` read. A genuinely returning user
  (doc predates this session) is unaffected: their saved profile is
  still protected. This also subsumes the `signup` page's racy
  `profileExisted` bounce: even if a second pass bounces a new user to
  Flow early, the stash persists and the drain (under the (app) layout)
  still applies the picks, so the `signup` derived needs no change.

### 3. Provider consistency pass

Verify every enabled provider in `SignInProviderStack`
(`apple`, `google`, `email`, `ii`, `passkey`, `dev`) persists the full
pick set end-to-end after the change. Document the per-provider path in
`PRODUCT.md`.

### Out of scope

- The satellite write path, schema, or `assertSetDoc`, confirmed
  correct; no satellite change.
- The pre-`v5` auth migration / AuthClient v7 work
  (`[[project_juno_authclient_v7]]`).
- Anti-farming gating of the onboarding VXP grant (issue #543): the
  grant path is unaffected by where picks are stashed.
- Eventual-consistency between `ensureProfile`'s bootstrap write and the
  immediate `functions.getProfile` query read in `patchProfile`: noted
  as a known robustness edge (a lagging-replica query could return the
  default shell), but not the cause here and not changed in this PR
  unless a quick guard falls out of the work.

## Linked issues

No open issue tracks this; user-reported 2026-06-17/18 ("the country
chosen during onboarding is not persisted"). New fix, no closing
keyword.

## Analytics

`onboarding_completed` exists in the taxonomy
(`src/lib/types/analytics-event.ts`) but is **not emitted anywhere**
today: the activation milestone is currently uninstrumented, which is
why the Google-vs-other persistence gap was invisible. This spec emits
it, carrying the dimension that would have surfaced the bug:

- the finishing **provider** (`apple | google | email | ii | passkey |
dev`), and
- whether a **team was persisted** (`favoriteParticipantId` non-empty).

Reuse the existing `AnalyticsEventProps` dimensions rather than adding
new prop keys: a new key would churn the satellite analytics wire
schema / declarations (the analytics-variant regen landmine,
`[[reference_analytics_event_is_candid_variant]]`). Map provider →
`label` (the props bag's documented "small categorical label", bounded
vocab) and team-picked → `ok`, with `source: 'onboarding'`. No new
event name, no prop-key addition, so no dual-source TS-union / Zod-mirror
edit and no binding regen.

Emit once, in the drain's `applied` outcome
(`onboarding-handoff.services.ts`). Because the picks are now stashed at
Beat 3 for **every** path (including the authenticated in-page finish,
whose leftover stash the drain still processes idempotently on Flow),
the drain is the single point every completed flow passes through, so
one emit there covers all providers without double-counting. The
provider id rides in the stash (see the provider-capture step). Capture
via `track()` (`src/lib/services/analytics.services.ts`). Behavioural
only: no PII, no free-form text.

## Implementation outline

1. `OnboardingFlow.svelte`: add `onPicksReady?: (picks: {
participantId: string | null; side: 'YES' | 'NO' | null; handle:
string | null }) => void`; call it when entering Beat 3 and whenever
   the picks change while at/returning to Beat 3.
2. `signup/+page.svelte`: pass `onPicksReady={handleCompletePreAuth}`.
   Confirm `handleCompletePreAuth` stays merge-safe (referral/email
   preserved) and is a no-op when there's nothing to stash.
3. `profile.services.ts`: add the session-scoped bootstrapped-principal
   capture in `ensureProfile`; expose a getter.
4. `onboarding-handoff.services.ts` + `(app)/+layout.svelte`: gate the
   `account_exists` branch on the deterministic capture, not solely the
   reactive `profileExisted` flag.
5. Provider capture: in `SignInProviderStack.startSignIn` (and
   `onApple`), merge the chosen provider id into the pending stash
   _before_ `run()` (same single-field merge as `stashPendingEmail`), so
   the drain knows which provider finished even across a redirect.
6. Analytics: emit `onboarding_completed` in the drain's `applied`
   outcome (the single path every completed flow passes through),
   mapping provider → `label`, team-picked → `ok`, `source:
'onboarding'` (no new prop keys).
7. Verify each provider locally (dev + at least one redirect path) that
   a freshly-created profile carries `favoriteParticipantId`,
   `favoriteSide`, and `onboardingCompleted: true`.
8. Update `docs/ai/PRODUCT.md` onboarding section: picks are stashed
   before sign-in so they survive a redirect provider, and the
   new-user decision is session-deterministic.

## Acceptance criteria

- [ ] A new user who picks a team, makes a first call, and completes
      sign-up **with Google** lands with
      `preferences.favoriteParticipantId` and `favoriteSide` set and
      `onboardingCompleted: true`.
- [ ] The same holds for every other enabled provider (apple, email, ii,
      passkey, dev): verified path-by-path.
- [ ] A returning user (profile predates this session) is **not**
      re-prompted and their saved profile is **not** overwritten by a
      stale pending payload.
- [ ] A second `onAuthStateChange` pass during a fresh sign-in cannot
      route the drain into `account_exists` and drop picks.
- [ ] A user who edits their handle (Beat 3 → back → Beat 2 → forward)
      re-stashes the updated picks before signing in.
- [ ] `onboarding_completed` carries `provider` and `teamPicked`.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- Does Juno's Google `signIn` ever resolve in-page (popup fallback on
  some platforms) such that `onSuccess` _also_ fires? If it can, confirm
  the early stash + a later `onComplete` is still purely idempotent (it
  should be, identical values). Verify against `@junobuild/core`
  behaviour, not assumption.

## Decisions

- **Fix the stash gap, not the write path.** Every prior attempt
  hardened `applyOnboardingPicks` / the drain; the picks for Google
  never reached storage in the first place. Persisting them before the
  redirect is the actual missing link, and it generalizes to any future
  redirect provider.
- **Reuse `handleCompletePreAuth`, fire it earlier.** It is already the
  correct merge-safe stash writer; the bug was _when_ it ran (after a
  redirect that never returns control), not _what_ it wrote.
- **Session-deterministic new-user capture over a reactive flag.** The
  `account_exists` guard must protect genuine returning users without
  being flippable by a benign second auth pass mid-onboarding.
