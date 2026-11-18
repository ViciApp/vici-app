# Spec: Leaderboard integrity, qualify gate + Bayesian-shrinkage ranking

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#976)

## Goal

Stop one-and-done predictors from topping the global leaderboard. A
single 100%-on-1-call record currently outranks a seasoned 90%-on-50
record because the board sorts on raw accuracy with only a 3-settled
floor. Two changes fix it: a **qualify gate** (a predictor needs a
minimum number of resolved calls to be ranked at all) and
**Bayesian-shrinkage ranking** (thin records decay toward the
population mean instead of riding a lucky streak to #1). Predictors
below the gate are not dropped; they appear in a separate
**Provisional** section with "{done}/{min} to qualify" progress so
newcomers see a path, not a phantom #1. Every row gains its **call
count** as the trust signal, and the gate threshold is exposed as a
dev **Tweak** so product can tune it live.

## Context

The global leaderboard re-ranks a clearing-canister P&L slice by
accuracy on the front end:

- `src/lib/derived/standings.derived.ts`: `byAccuracy` sorts the
  cached slice; `LEADERBOARD_MIN_SETTLED = 3` is a floor (qualified
  rows sit above below-floor rows) but **not** a gate (below-floor
  rows are still ranked and shown). `globalStandingsRows` stamps each
  row's 1-based `displayRank`. No shrinkage, no Provisional partition.
- `src/lib/components/pages/LeaderboardPage.svelte`: podium (top-3) +
  flat `rest` list. Rows show `{vxp} VXP · {n}d streak` and accuracy;
  **no call count** on the row (it lives only in the mini-profile
  sheet as `leaderboard.sheet.settled`). The page already `track`s
  `friend_request_sent` with `source: 'leaderboard'`.
- `src/lib/services/standings.services.ts`: `toEntry` maps the wire
  aggregate to `StandingEntry`, including **`settledCount` and
  `winCount` for every entry** (not just the tapped profile). This is
  the per-row count data the gate + shrinkage need (see Open
  questions, confirmed during authoring).
- `src/lib/types/standings.ts`: `StandingEntry` carries
  `settledCount`, `winCount`, and a rounded integer `accuracy`
  (0–100).
- `src/lib/components/dev/TweaksPanel.svelte`: the existing
  `isDev()`-gated dev panel. `worldCupMode` is its precedent for a
  live toggle (persisted via `preferencesStore`).
- i18n catalogs `src/lib/constants/messages/*.ts` (12 locales: `de`,
  `en`, `es`, `es-419`, `es-AR`, `es-MX`, `fr`, `it`, `ja`, `pt`,
  `pt-BR`, `zh-Hans`). Existing keys are under the `leaderboard.*`
  namespace; `check:i18n` enforces key parity across all 12.
- Analytics dual-source pair: `src/lib/types/analytics-event.ts` (TS
  union) + `src/lib/schema/analytics-event.schema.ts` (Zod mirror);
  capture via `track` in `src/lib/services/analytics.services.ts`.

Reuse note (per `docs/ai/frontend/reusability.md`): the shrinkage
blend is the same shape the league screen already uses
(`src/lib/utils/league-rank.utils.ts`: accuracy-first with a prior).
This spec adds the global-board variant rather than inventing a new
ranking idiom; the two stay conceptually aligned.

## Scope

1. **Constants**: new `src/lib/constants/standings.constants.ts`:
   `LEADERBOARD_QUALIFY_MIN` (default 10), `LEADERBOARD_PRIOR_MEAN`
   (0.5), `LEADERBOARD_PRIOR_WEIGHT` (20). Move the ranking discipline
   off the magic `LEADERBOARD_MIN_SETTLED = 3` floor in
   `standings.derived.ts`; the qualify gate (10) supersedes it.

2. **Ranking**: in `standings.derived.ts`:
   - Add a pure `rankScore({ accuracy, settledCount })` =
     `(PRIOR_MEAN * PRIOR_WEIGHT + acc * n) / (PRIOR_WEIGHT + n)`,
     where `acc` is the **precise `winCount / settledCount` ratio**
     (0–1), not the rounded integer `accuracy`, so the shrinkage
     doesn't compress on the rounding.
   - Partition rows into **qualified** (`settledCount >=
LEADERBOARD_QUALIFY_MIN`) and **provisional** (below the gate).
   - Sort qualified by `rankScore` desc (tie-break: `settledCount`
     desc → `realizedPnl` desc → stable). Stamp `displayRank` over the
     qualified set only.
   - Sort provisional by `settledCount` desc (closest to qualifying
     first); provisional rows carry **no** `displayRank`.
   - `globalStandingsRows` returns both partitions (e.g.
     `{ ranked, provisional }`) so the page can render two sections
     from one derived store.

3. **Page**: `LeaderboardPage.svelte`:
   - Podium + ranked list read the `ranked` partition (unchanged
     layout); each podium tile and row gains a **call-count** line
     (`{count} calls`).
   - Row meta line shows `{count} calls · {n}d streak` (the call count
     replaces the `{vxp} VXP` figure as the row's trust signal; see
     Pending decisions).
   - New **Provisional** section below the ranked list, rendered only
     when non-empty: a header (`Provisional` + `Min {n} calls`) and one
     row per provisional predictor showing a `Provisional` badge, the
     handle, `{done}/{min} to qualify` progress, and accuracy. Rows
     reuse the existing row affordances (tap → mini-profile sheet,
     `is-you` highlight).
   - Mini-profile sheet: the `#{rank} global` sub-line already exists;
     for a provisional predictor (no rank) show the `Provisional`
     label instead. The sheet's `Settled` stat is unchanged.

4. **Tweak**: `TweaksPanel.svelte` gains a "Leaderboard qualify
   (calls)" control bound to a new dev-only store
   (`src/lib/stores/tweaks.store.ts`, `leaderboardQualifyMin`,
   default = `LEADERBOARD_QUALIFY_MIN`). `globalStandingsRows` reads
   the effective threshold (tweak value, falling back to the
   constant). Dev-only, ephemeral; see Pending decisions.

5. **i18n**: add the new `leaderboard.*` keys to **all 12** catalogs.

6. **Analytics**: add `leaderboard_viewed` to both halves of the
   taxonomy pair and fire it from the page (see Analytics).

7. **PRODUCT.md**: add a "Leaderboard: qualify gate + shrinkage
   ranking" subsection in the same PR.

### Out of scope

- **Moving accuracy ranking into the clearing canister.** The board
  still re-ranks a fetched P&L slice on the FE; the gate + shrinkage
  run over that slice. The standing scalability caveat
  (`globalStandingsRows`, `standings.services.ts`) is unchanged and
  not addressed here; see Open questions.
- **The Dash "Top X%" rank tile / `findOwnStanding` / `percentileBand`**
  stay on the canister P&L rank (the existing documented
  inconsistency in `standings.services.ts`). This spec does not
  reconcile them.
- **League / battle ranking** (`league-rank.utils.ts`): already
  accuracy-first with a prior; untouched.
- **Demo seed predictors** (`quirinus` 1/1, `horatius` thin) from the
  prototype `data.js`; they exist only to demo the gate and are **not**
  ported.

## Linked issues

No open issue tracks the leaderboard one-and-done ranking bug (searched
open issues, 2026-06-25). #543 ("Anti-farm: gate referral/onboarding
payouts on an authoritative trade") is adjacent integrity work but a
different surface (referral payouts, not ranking); **not** closed by
this spec. No closing keyword.

## Analytics

Instrument: **yes**. A new ranking surface with no events is invisible
to the exact product question this change raises: "how many viewers
land in Provisional vs ranked, and is the gate set right?"

**New event: `leaderboard_viewed`** (snake_case, sits with the other
`*_viewed` events: `market_viewed`, `battle_viewed`,
`transactions_viewed`). Fired once per window load/switch on the
Leaderboard page. Props (all from the existing bounded vocabulary,
no new dimensions):

| Prop    | Meaning                                                             |
| ------- | ------------------------------------------------------------------- |
| `label` | active window: `week` \| `month` \| `all`                           |
| `count` | number of **ranked** (qualified) rows rendered                      |
| `ok`    | viewer is qualified/ranked (`true`) vs provisional/absent (`false`) |
| `value` | viewer's `settledCount` (how far below/above the gate they sit)     |

`ok` + `value` together answer whether the gate is stranding real
viewers in Provisional. Behavioural only, bounded props, no PII.

Dual-source: add `'leaderboard_viewed'` to the **Social & leagues**
block of the `AnalyticsEventName` union
(`src/lib/types/analytics-event.ts`) **and** the matching position in
the `AnalyticsEventNameSchema` enum
(`src/lib/schema/analytics-event.schema.ts`). Capture via `track({ name:
'leaderboard_viewed', label, count, ok, value })`.

## Implementation outline

1. Add `src/lib/constants/standings.constants.ts` with
   `LEADERBOARD_QUALIFY_MIN = 10`, `LEADERBOARD_PRIOR_MEAN = 0.5`,
   `LEADERBOARD_PRIOR_WEIGHT = 20` (documented, with the same
   rationale as the prototype helper). Cite this file from the spec;
   do not restate the numbers elsewhere.
2. Add `src/lib/stores/tweaks.store.ts`, a dev-only `writable`
   (`leaderboardQualifyMin`) seeded from `LEADERBOARD_QUALIFY_MIN`,
   plus a derived/effective getter.
3. `standings.derived.ts`: add `rankScore`, replace `byAccuracy` +
   `LEADERBOARD_MIN_SETTLED` with the gate-partition + shrinkage sort;
   change `globalStandingsRows` to return `{ ranked, provisional }`
   (the `StandingsRow` shape gains an optional `displayRank` for
   provisional rows, or a discriminator; decide at build time). Read
   the effective threshold from the tweaks store.
4. `LeaderboardPage.svelte`: consume the new shape; add call counts to
   podium tiles + rows; add the Provisional section; fire
   `leaderboard_viewed` in the hydrate `$effect` (deduped per window,
   like the profile-hydrate effect). Update the component doc comment.
5. Add `leaderboard.*` keys to all 12 catalogs (en first, then mirror).
6. Add `leaderboard_viewed` to the analytics union + Zod enum.
7. Add the Tweak control to `TweaksPanel.svelte`.
8. Update `docs/ai/PRODUCT.md` (new leaderboard subsection) and flip
   this spec's status.

## Acceptance criteria

- [ ] A predictor with `settledCount < LEADERBOARD_QUALIFY_MIN` never
      appears in the ranked podium/list; they appear in the Provisional
      section with `{settledCount}/{min} to qualify`.
- [ ] Among qualified predictors, ordering is by `rankScore`
      (shrinkage), so a 10/11 (≈91%) record does **not** outrank a
      45/50 (90%) record.
- [ ] Every ranked podium tile and row shows the predictor's call
      count.
- [ ] The Provisional section is hidden when no predictor is below the
      gate.
- [ ] The mini-profile sheet shows `Provisional` (not a fabricated
      rank) for a provisional predictor.
- [ ] Changing "Leaderboard qualify (calls)" in the dev Tweaks panel
      re-ranks the board live (re-partitions ranked vs provisional).
- [ ] New `leaderboard.*` keys exist in all 12 catalogs; the i18n
      parity check (`check:i18n`) passes.
- [ ] `leaderboard_viewed` is in both the TS union and the Zod enum and
      fires once per window load.
- [ ] `npm run quality` and `npm run check` pass.
- [ ] `docs/ai/PRODUCT.md` describes the gate + shrinkage + Provisional
      behaviour.

## Open questions

- **Does the slice contain every below-gate predictor?** _Confirmed,
  with a caveat._ `standings.services.ts` `toEntry` exposes
  `settledCount`/`winCount` for **all** entries, so per-row counts for
  the gate + shrinkage are present; the core question is **answered:
  yes**. Residual: the slice is the canister's P&L-ranked top-N
  (`MAX_STANDINGS_PAGES × STANDINGS_PAGE_LIMIT` = 5,000). At today's
  scale every settled predictor is in the slice, so Provisional is
  complete; at 100× a low-P&L provisional predictor could fall beyond
  the drain cap and be absent from the section. This is the same
  pre-existing FE-re-rank scalability caveat (already documented in
  `globalStandingsRows`), not a regression, flagged so it's a
  conscious carry-forward, not a silent gap.

## Decisions

- **Full prototype model adopted** (gate + shrinkage + Provisional +
  per-row counts + Tweak), per the product call already made. Values
  match the prototype (`VICI_LB_QUALIFY_MIN` 10, prior mean 0.5, weight
  20), relocated to a named constants file.
- **Keep the `leaderboard.*` i18n namespace**: the prototype's `lb.*`
  namespace is **not** introduced; new keys land under `leaderboard.*`.
- **The qualify gate (10) supersedes `LEADERBOARD_MIN_SETTLED` (3).**
  The old floor only reordered within a single ranked list; the gate
  removes sub-threshold predictors from ranking entirely, so the floor
  is removed rather than kept alongside.
- **Shrinkage uses the precise `winCount / settledCount` ratio**, not
  the rounded integer `accuracy`, to avoid tie compression at the
  decision boundary.
- **Row trust signal: replace VXP with calls** (resolved). The
  ranked-row meta shows `{count} calls · {n}d streak`; the `{vxp} VXP`
  figure is dropped from the row (the prototype is the source of truth
  and calls is the named trust signal). `realizedPnl` stays on the
  model for the P&L-ranked Dash surfaces.
- **Tweak persistence: dev-only ephemeral** (resolved). The
  `leaderboardQualifyMin` writable lives in `tweaks.store.ts`, seeded
  from `LEADERBOARD_QUALIFY_MIN` and only ever written by the
  `isDev()`-gated TweaksPanel; it reverts to the constant on reload and
  never touches `preferencesStore`.
- **`StandingsRow` shape: optional `displayRank`** (resolved).
  Provisional rows carry `displayRank: undefined`; the derived store
  returns `{ ranked, provisional }` (`PartitionedStandings`).

## Divergence from spec (as built)

- **Generated satellite bindings touched.** Adding `leaderboard_viewed`
  to the analytics enum propagates through the satellite API surface:
  the new name had to land in the generated `satellite_extension.did`
  and `src/declarations/satellite/{satellite.did.d.ts,
satellite.api.ts, satellite.factory.did.js}` for `functions.trackEvents`
  to type-check. The `juno` CLI is not available in this environment, so
  these were updated to the generator's deterministic output (the name
  inserted in schema order, after `chat_sent`). CI's `satellite-schema`
  job regenerates and verifies parity; the maintainer can re-run
  `npm run juno:functions:build` + `npm run did` to confirm an identical
  diff.
- **`leaderboard.row.vxp` removed.** Rows now show the call count instead
  of the VXP swing, so the now-dead key was dropped from the 8 catalogs
  that carried it (7 live + `pt-BR`). No other consumer referenced it.
