# Spec: Enforce the leaderboard & Worlds sharing opt-outs

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1069)

## Goal

The two Settings → Privacy share toggles, **Show on global
leaderboard** and **Show in Worlds Universities**, currently persist
the user's intent but have **no effect**: a user who turns either off
is still shown. Make them real. Turning _Show on global leaderboard_
off removes the user from the leaderboard everyone else browses (while
they keep their own rank and achievements); turning _Show in Worlds
Universities_ off stops their predictions from counting toward their
school's / country's contribution.

## Context

The flags already round-trip everywhere: type
[`SharingPrefs`](../../../src/lib/types/preferences.ts) (`leaderboardOptIn`,
`worldsOptIn`, both default `true`), the preferences store, the profile
schema, the satellite wire format, and the Settings UI
([`SettingsPage.svelte:477`](../../../src/lib/components/pages/SettingsPage.svelte)).
The gap is purely enforcement; the type comment in
[`preferences.ts:30`](../../../src/lib/types/preferences.ts) already
names it a follow-up.

The two surfaces have **different data sources** (verified by tracing
UI → service → source):

- **Global leaderboard** (Arena → Leaderboard,
  [`LeaderboardPage.svelte`](../../../src/lib/components/pages/LeaderboardPage.svelte))
  renders from the **icdc-core clearing canister** (`list_leaderboard`
  via [`standings.services.ts`](../../../src/lib/services/standings.services.ts)),
  re-ranked **FE-side** by Bayesian shrinkage in
  [`globalStandingsRows`](../../../src/lib/derived/standings.derived.ts).
  The satellite `listLeaderboard` (points-sorted,
  [`leaderboard.services.ts:58`](../../../src/satellite/services/leaderboard.services.ts))
  is **not** what the board displays; it only fills a preload cache.
  So the real enforcement point for the visible board is the FE join in
  `globalStandingsRows`, which already joins each principal with the
  profile cache (`$profiles.get(entry.owner)`), giving access to that
  principal's `preferences.sharing.leaderboardOptIn`.
- **Worlds Universities** (Arena → Worlds → Schools,
  [`WorldsBattleDetailPage.svelte`](../../../src/lib/components/pages/WorldsBattleDetailPage.svelte))
  renders a **per-school aggregate** (never per-user) from the
  `AFFILIATION_STATS` collection, populated by the hook
  [`onProfileSetForAffiliationStats`](../../../src/satellite/services/affiliation-stats.services.ts)
  which fans a user's resolved-trade delta out to their school/country
  stats. The enforcement point is that hook: skip the fan-out for an
  opted-out user.

## Scope

1. **Worlds opt-out (satellite hook gate).** In
   `onProfileSetForAffiliationStats`, after decoding `afterProfile`,
   early-return when `afterProfile.preferences?.sharing?.worldsOptIn`
   is `false` (nullish → `true`, preserving today's default-on
   behaviour for legacy rows). The full profile is already decoded for
   the existing hibernation guard, so this adds no read.

2. **Leaderboard opt-out (FE filter, fail-closed).** In
   `globalStandingsRows`, a non-self entry is shown only when its joined
   profile is loaded **and** `leaderboardOptIn !== false`, applied before
   the qualify-gate split and `displayRank` assignment, so opted-out
   users vanish from both `ranked` and `provisional` and ranks compress
   with no gaps. Failing closed (hide until the profile is known, rather
   than show-then-hide) means an opted-out predictor never flashes onto
   the board during the hydration gap. Because that hides not-yet-loaded
   rows, the leaderboard page must hydrate from the **raw** standings
   slice (`globalStandingsStore`), not the filtered partition; else a
   hidden row's profile would never be fetched and the filter could never
   resolve it into view (a deadlock). Keeping `self` satisfies the
   decided "hide from others, keep own rank" semantics: the viewer still
   sees their own row, and
   [`ownGlobalStanding`](../../../src/lib/derived/standings.derived.ts)
   (the Arena "Global ranking" card / top-decile source) still resolves
   their own number.

3. **Analytics.** Emit `privacy_sharing_toggled` on each toggle change
   (see Analytics).

### Out of scope

- **Robust (canister-level) leaderboard hiding.** The clearing canister
  still publishes P&L + principals publicly, and the FE filter is
  bypassable by querying icdc-core directly. True hiding-from-raw-data
  needs an icdc-core change (separate repo, separate PR per
  [`backend.md`](../../../.claude/rules/backend.md)). The existing
  qualify-gate / shrinkage ranking is _already_ FE-only, so an FE filter
  is architecturally consistent for v1; canister hardening is a
  fast-follow.
- **Retroactive Worlds subtraction + the append-only exploit.**
  `AFFILIATION_STATS` is a forward-only aggregate with no per-member
  breakdown, so a user's _past_ contribution cannot be subtracted on
  opt-out; gating stops _future_ contribution only. The same root
  cause is a pre-existing exploit independent of this feature: a member
  can contribute, wait out the 90-day lock, leave, and keep their credit
  baked into the school total (and repeat across schools). Fixing it
  needs either per-member contribution tracking or a live recompute
  over current members (which can't cover the monthly podium, since
  profiles store no per-month deltas). Tracked as a separate
  follow-up, not part of this spec.
- The other two `SharingPrefs` controls (`profileVisibility`, already
  enforced via the top-level `profile.visibility` wire field, and
  `callsPublic`) are untouched.

## Linked issues

No open issue tracks this. (Searched open issues for
privacy / leaderboard / worlds / opt-in / sharing: none.)

## Analytics

Instrument. New event `privacy_sharing_toggled` capturing intent on
each change of the two controls.

- Props: `source: 'leaderboard' | 'worlds'`, `label: 'on' | 'off'`.
  Bounded vocabularies, no PII.
- Must land in **both** halves of the dual-source pair:
  [`analytics-event.ts`](../../../src/lib/types/analytics-event.ts) (TS
  union) and
  [`analytics-event.schema.ts`](../../../src/lib/schema/analytics-event.schema.ts)
  (Zod mirror); capture via `track` in
  [`analytics.services.ts`](../../../src/lib/services/analytics.services.ts)
  from the toggle handlers in `SettingsPage.svelte`. Matches the
  existing `*_toggled` family (`sound_toggled`,
  `market_translation_toggled`).

## Technical requirements (satellite / backend, mandatory)

- **Performance.** Worlds gate is one extra boolean read on an
  already-decoded profile inside `onProfileSetForAffiliationStats`,
  which only does work when `totalTrades` advances. Negligible
  instruction-budget impact; for opted-out users it _reduces_ work
  (skips the affiliation scan + stats writes).
- **Memory & storage.** No new collection, doc shape, or growth. The
  leaderboard half is FE-only; no satellite data change.
- **Scalability.** Unchanged fan-out bounds. The FE leaderboard filter
  is an O(N) pass over the already-fetched slice, inside the existing
  `globalStandingsRows` derivation.
- **Upgrade & compatibility.** No new `defineQuery` / `defineUpdate`,
  no collection change, no breaking change. But the new
  `privacy_sharing_toggled` analytics name **is** a Candid variant on
  the existing `trackEvents` endpoint, so the `.did` + FE declarations
  **do** regenerate: `npm install` → `npm run juno:functions:build`
  (updates `satellite_extension.did`) → `npm run did` (regenerates
  `src/declarations/satellite/**`), committed together. The Worlds
  hook edit takes effect after a **local satellite Wasm upgrade**, per
  [`satellite/README.md`](../satellite/README.md). Default-on nullish
  handling keeps legacy profile rows decoding unchanged.
- **Security.** No collection-rule or caller-permission change. The
  hook already runs as the satellite principal; it now reads one more
  field of the profile it already decodes.
- **Parameters.** None introduced.

## Implementation outline

1. `src/satellite/services/affiliation-stats.services.ts`
   (`onProfileSetForAffiliationStats`): after the `isHibernated`
   guard, add `if (afterProfile.preferences?.sharing?.worldsOptIn ===
false) return;`.
2. `src/lib/derived/standings.derived.ts` (`globalStandingsRows`):
   filter `entries` fail-closed (show a non-self row only once its
   profile is loaded and not opted out) before the qualified/provisional
   split; `src/lib/components/pages/LeaderboardPage.svelte` hydrates
   profiles from the raw `globalStandingsStore` slice so hidden rows
   still load.
3. Add `privacy_sharing_toggled` to the analytics union + Zod mirror;
   call `track` from the two toggle handlers in
   `SettingsPage.svelte:479` / `:492`.
4. Update [`PRODUCT.md`](../PRODUCT.md) in the same PR: note the
   leaderboard opt-out under the global-leaderboard section and the
   Worlds opt-out under the Worlds section.
5. `npm run quality` + `npm run check`; `npm run juno:functions:build`
   and commit regenerated satellite files.

## Acceptance criteria

- [x] A profile with `sharing.worldsOptIn === false` does not move
      `AFFILIATION_STATS` counters when its `totalTrades` advances.
- [x] A legacy profile with no `worldsOptIn` (nullish) still
      contributes (default-on preserved).
- [x] On the global leaderboard, a non-self principal with
      `leaderboardOptIn === false` appears in neither the ranked nor the
      provisional list, and ranks compress with no numbering gap.
- [x] An opted-out viewer still sees their own `You` row and their
      `ownGlobalStanding` number is unchanged in kind.
- [x] `privacy_sharing_toggled` fires with the correct
      `source` / `label` on each toggle and passes the Zod mirror.
- [x] `npm run check`, prettier, and eslint pass on the changed files;
      regenerated `.did` + declarations committed.

## Decisions

- **Leaderboard opt-out = hide from others, keep own rank** (not full
  unranking). The viewer keeps their own row, rank, and top-decile
  eligibility; they only disappear from _other_ people's view. Chosen
  to match the toggle sub-label "Your rank visible to everyone."
- **Leaderboard enforcement = FE-only filter for v1.** Enforced in
  `globalStandingsRows`, consistent with the already-FE-side qualify
  gate / shrinkage ranking. The clearing canister still publishes raw
  P&L + principals, so canister-level hiding is a tracked fast-follow
  (Out of scope), not part of this spec.
- **Worlds opt-out = gate future contribution; residue accepted.**
  Verified during the build that `AFFILIATION_STATS` is an append-only,
  forward-only aggregate ([`affiliation-stats.services.ts`](../../../src/satellite/services/affiliation-stats.services.ts))
  with no per-member breakdown, and the leave path
  ([`assertDeleteAffiliation`](../../../src/satellite/services/affiliation.services.ts))
  deletes only the membership row; it never subtracts. So neither
  opt-out nor leaving can retract a past contribution; the gate stops
  future contribution only. The deeper append-only exploit
  (contribute → wait out the 90-day lock → leave keeps the credit;
  sequentially pumping multiple schools) is a pre-existing design
  issue, **out of scope** here and tracked as a separate follow-up.
- **Open question resolved.** Cached profiles carry
  `preferences.sharing.leaderboardOptIn`: `UserProfileSchema`
  ([`profile.schema.ts`](../../../src/lib/schema/profile.schema.ts))
  includes the defaulted `sharing` group, and the satellite `getProfile`
  wire format returns `preferences` as a required record, so the FE join
  in `globalStandingsRows` always sees the flag (nullish guarded anyway).
- **Leaderboard filter fails closed (review feedback).** Initial
  implementation failed open (a row with no cached profile was shown),
  which let an opted-out predictor flash onto the board during profile
  hydration. Changed to fail closed: hide a non-self row until its
  profile is loaded and confirmed not opted out. This forced a second
  change: `LeaderboardPage` now hydrates profiles from the raw standings
  slice rather than the filtered partition, otherwise hidden rows would
  never fetch their profile and the board would deadlock to self-only.
  Tradeoff accepted: opted-in rows fill in as profiles hydrate (a brief
  progressive paint) instead of rendering immediately, which is the
  correct bias for a privacy control.
- Built via the spec-first workflow at the requester's direction.
