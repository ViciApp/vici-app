# Spec: Surface live battles in the Arena Battles tab and show who's winning

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#967)

## Goal

After a user accepts a battle, they can **find it** and **see who's
winning**. Today an accepted battle vanishes from the Arena → Battles
tab (which only lists incoming proposals), survives only as a
non-clickable card buried in one league's detail page, and shows no
score until the window closes. This spec adds a "Live battles" section
to the Battles inbox that deep-links each active battle to its detail
page, makes the live battle cards on the league page reachable too, and
shows **live, provisional standings** (each side's running window
accuracy) on the battle detail page while a battle is `in_flight`.

## Context

The battle lifecycle and trustless scoring shipped in
[`2026-06-15-feat-battle-auto-resolution.md`](./2026-06-15-feat-battle-auto-resolution.md)
(#912) and the proposal/decline/expiry/accept-clock half in
[`2026-06-16-feat-league-battle-inbox-decline-expiry.md`](./2026-06-16-feat-league-battle-inbox-decline-expiry.md)
(#917). Neither closed the **discovery + live-score** gap this spec
targets:

1. **The Arena Battles tab never lists active battles.**
   [`BattlesInboxPage.svelte`](../../../../src/lib/components/pages/BattlesInboxPage.svelte)
   derives `incomingChallenges` as `proposed` battles where a league the
   caller **owns** is `sideB` (lines 99–107). It renders that, the Worlds
   cards, and the tournament card, but **nothing** for `in_flight` /
   `accepted` battles. The moment a proposal is accepted it leaves
   `incomingChallenges` and has no home here. This tab is embedded as the
   "Battles" tab of `ArenaPage.svelte` (line 131), so "go in arena → I
   don't see my battle" is exactly this.
2. **The battle detail page exists but shows no live score.**
   [`BattleDetailPage.svelte`](../../../../src/lib/components/pages/BattleDetailPage.svelte)
   (route `/arena/battles/[id]`) renders a face-off, but each side's
   score is `battle.state === 'resolved' && nonNullish(battle.scoreX)
? … : '–'` (lines 419–425, 441–448). For an `in_flight` battle both
   read `–`. The data to do better already exists: kickoff stamps
   `baselineA` / `baselineB` (`BattleDoc`, `battle.ts:166–168`), and
   `resolveBattle` (`leagues.services.ts:1090`) already computes scores
   as `battleAccuracyPct(currentStats − baseline)`. The same arithmetic,
   run **without writing**, yields live standings.
3. **League-page live battle cards are dead ends.** The `battleCard`
   snippet in
   [`LeagueDetailPage.svelte`](../../../../src/lib/components/pages/LeagueDetailPage.svelte)
   (1395–1474) renders a plain `<div>` with no path to the detail page;
   `liveBattles` (1551–1555) are listed but unclickable.

Files in scope (all frontend):

- `src/lib/services/leagues.services.ts`: add a **read-only**
  `readBattleLiveScore({ battle })` that reuses the existing private
  `readLeagueStatsBucket` (867), `battleAccuracyPct` and
  `deriveBattleWinner` (`battle.ts:187`, `197`) to project current
  standings for an `in_flight` league battle. No write, no new endpoint.
- `src/lib/components/pages/BattlesInboxPage.svelte`: load
  `listMyBattles()` (759) once in `load()`; derive an active-battle list
  (`in_flight` / `accepted`, deduped by id); render a "Live battles"
  section above the Worlds cards, each row a `button` deep-linking to
  `/arena/battles/{id}` (mirroring the existing `incomingChallenges`
  button rows, 388–416).
- `src/lib/components/pages/BattleDetailPage.svelte`: when the battle is
  `in_flight` (league kind, baselines present), fetch the live score in
  `load()` and render running accuracy + a "leading" highlight + a
  `LIVE · provisional` qualifier in place of `–`.
- `src/lib/components/pages/LeagueDetailPage.svelte`: add a "View →"
  affordance on non-actionable battle cards (`in_flight` / `accepted` /
  `resolved`) linking to `/arena/battles/{id}`.
- i18n catalogs (`src/lib/i18n/locales/*.json` per
  [`docs/ai/frontend/i18n.md`](../../frontend/i18n.md)): new keys for
  the inbox section header, the live-score qualifier, and the view link.

Reuse first (per
[`reusability.md`](../../frontend/reusability.md)):
`listMyBattles` is the single authoritative cross-league read the detail
page already uses: the inbox reuses it rather than fanning out over
`leagueBattlesStore`. `battleAccuracyPct` / `deriveBattleWinner` are the
shared scorers used by both the resolve service and the satellite assert;
the live projection calls the **same** functions so the provisional
standing and the eventual resolved result agree by construction.

## Scope

**`readBattleLiveScore` (new, read-only).** Given an `in_flight` league
battle with baselines, read both sides' current `league_stats` bucket for
the battle scope, delta against the baselines (clamped at 0, exactly as
`resolveBattle`), and return `{ scoreA, scoreB, callsA, callsB, leader }`
where `leader` is `deriveBattleWinner(...)`. Returns `null` for any
battle that isn't an `in_flight` league battle with both baselines (duels,
proposed, resolved, legacy rows missing baselines): callers fall back to
the existing `–` / resolved-score render. **No `setDoc`**: this never
mutates the battle; resolution stays the lazy auto-resolve path from #912.

**Battles inbox "Live battles" section.** A new surface-grouped section
(grouped by surface, per the page's own doc comment, lines 44–47) listing
the caller's `in_flight` and `accepted` battles. Source: `listMyBattles()`
(authoritative, one call, returns every battle across leagues the caller
belongs to). Each row shows both side names (reusing the
membership → directory → short-id resolution already in the page,
112–115), a `LIVE` tag, and the "Day X of Y" window; the whole row is a
button routing to `/arena/battles/{id}`. The section renders only when the
list is non-empty and sits above the Worlds cards (active battles are the
most relevant thing a user came to Battles to find).

**Live standings on the battle detail page.** While `in_flight`, replace
each `–` with the side's running accuracy from `readBattleLiveScore`,
highlight the current leader (reusing the existing `is-leading` class,
applied on `live.leader` instead of only `battle.winner`), and add a
`LIVE · provisional` qualifier near the score so it's never mistaken for a
final result. Resolved battles are unchanged (doc scores win). If the live
read fails or returns `null`, fall back to `–` silently: a transient
`league_stats` read failure must not break the page.

### Out of scope

- **Live scores on every inbox / league-page card.** Per-card live
  standings would be 2 `league_stats` reads × N cards (an N+1 fan-out).
  Live scoring is shown only on the **single-battle** detail page (2
  reads). Inbox / league cards deep-link to it. Revisit with a bulk read
  if product wants leader-on-card later.
- **Polling / auto-refresh of live scores.** Standings are computed once
  per detail-page load (reusing the page's existing `onMount` load). No
  websocket / interval refresh, consistent with the rest of the app's
  read-on-navigate model.
- **Duels.** No FE path creates `kind='duel'` battles; they have no
  `league_stats` to delta, so `readBattleLiveScore` returns `null` and
  they render as today. Unchanged.
- **Wager escrow** and **resolution mechanics**, owned by #912 / future
  specs; untouched here.
- **The `accepted` state for league battles** doesn't occur (league
  accept fuses straight to `in_flight`); the inbox filter includes it for
  completeness (duels) but no league battle dwells there.

## Linked issues

Closes #966, "I don't see my battles": the user accepted a battle and
found no detail or live standing anywhere in Arena. This spec surfaces
active battles in the Battles tab and shows who's winning. The fix is
complete (discovery + live score), so the implementation PR closes the
issue with a plain `Closes #966.` (no em-dash after the number).

## Analytics

Instrument battle-detail views so the funnel from "accepted" to "watched
the live battle" is visible; otherwise this whole surface is invisible to
product. The existing taxonomy already follows a `*_viewed` convention
(`market_viewed`, `orderbook_viewed`, `transactions_viewed`,
`analytics-event.ts:57,68,114`) and carries a `battleId` prop (203).

- Add **`battle_viewed`**: fired once per battle-detail load after the
  battle resolves to `ready`. Props: `battleId`; `label` = the battle
  `state` (bounded: `proposed` / `accepted` / `in_flight` / `resolved` /
  `declined` / `expired`); `source` = where the user arrived from
  (`inbox` / `league` / `deep_link`). The new name goes in **both** the TS
  union (`src/lib/types/analytics-event.ts`) **and** the Zod mirror
  (`src/lib/schema/analytics-event.schema.ts`): svelte-check only catches
  the union; an enum mismatch fails at runtime (per the dual-source rule).
  Capture via `track` in `analytics.services.ts`.
- No new props or free-form text; `battleId` is bounded id data, `label` /
  `source` are bounded vocabularies. No PII.

## Technical requirements (satellite / backend)

Almost entirely frontend: no new collection, no new endpoint, no hook
logic change. The **one** backend-touching part is the analytics event:

- **Candid surface (analytics).** `battle_viewed` is a new
  `AnalyticsEventName`, which is a **Candid variant** on the `trackEvents`
  / `getAnalyticsSummary` endpoints. Adding it touches the TS union
  (`analytics-event.ts`), the Zod mirror
  (`analytics-event.schema.ts`, the codegen source), **and** the
  regenerated bindings: `src/satellite/satellite_extension.did` and
  `src/declarations/**`. Regenerate via `npm run juno:functions:build`
  (run `npm install` first so `@icp-sdk/bindgen` is present, then
  `prettier --write` the generated files to the repo style; otherwise the
  raw codegen formatting shows ~3000 lines of noise) and commit the
  result. The variant order is **hash-sorted** by the codegen: never
  hand-place it. This is **additive** (a new enum member on a read/write
  surface): existing consumers keep decoding, so it's non-breaking.
- **Reads.** `readBattleLiveScore` issues **2** `getDoc` reads against the
  public `LEAGUE_STATS` collection (one per side) per battle-detail load,
  via the existing `readLeagueStatsBucket`. Same collection and read shape
  `resolveBattle` already uses; `read: public`, no caller permission
  change. Bounded to the detail page (one battle), not a fan-out.
- **No write path changes.** Resolution remains the lazy auto-resolve from
  #912; the live projection is strictly read-only and cannot alter a
  battle or post a score. No satellite hook / assert logic changes.

## Implementation outline

1. **Service** (`leagues.services.ts`): add `readBattleLiveScore({
battle }): Promise<{ scoreA; scoreB; callsA; callsB; leader } | null>`.
   Guard: return `null` unless `state === 'in_flight'`, `kind ===
'league'`, and both baselines present. Otherwise reuse
   `readLeagueStatsBucket` ×2 + the `Math.max(0, current − baseline)`
   delta + `battleAccuracyPct` + `deriveBattleWinner`, exactly as
   `resolveBattle` (1114–1136) but without the `setDoc`.
2. **Battle detail** (`BattleDetailPage.svelte`): in `load()`, after the
   battle is known and `in_flight`, call `readBattleLiveScore` and store
   the result in a `$state`. Render: live scores in the two
   `battle-detail-score` slots when present; `is-leading` on the
   `live.leader` side; a `LIVE · provisional` qualifier. Keep the resolved
   path untouched. Fire `battle_viewed` once on `ready`.
3. **Battles inbox** (`BattlesInboxPage.svelte`): add `myBattles`
   `$state`; populate from `listMyBattles()` in `load()`; derive
   `activeBattles = myBattles.filter(b => b.state === 'in_flight' ||
b.state === 'accepted')` deduped by `id`. Render the "Live battles"
   section (button rows → `/arena/battles/{id}`) above the Worlds cards.
   Hydrate the directory for both sides so names resolve.
4. **League detail** (`LeagueDetailPage.svelte`): add a "View →" link to
   `/arena/battles/{id}` on `in_flight` / `accepted` / `resolved` cards
   (cards without inline owner actions), keeping accept/decline rows as
   they are.
5. **Analytics**: add `battle_viewed` to the TS union and Zod mirror, fire
   it via `track` in `BattleDetailPage`, then **regenerate the bindings**
   (`npm install` → `npm run juno:functions:build` → `prettier --write`
   the generated declarations) and commit `satellite_extension.did` +
   `src/declarations/**`.
6. **i18n**: add the new keys to every live catalog; run the i18n lint.
7. **Quality**: `npm run quality` + `npm run check`. Update `PRODUCT.md`
   (the Battles section) to note that live battles are discoverable in the
   Battles tab and the detail page shows provisional standings while
   in flight.

## Acceptance criteria

- [ ] After accepting a battle, it appears in a "Live battles" section in
      the Arena → Battles tab, and tapping it opens the battle detail page.
- [ ] While a battle is `in_flight`, the detail page shows each side's
      running accuracy (not `–`) and highlights the current leader, with a
      qualifier marking the standing as provisional.
- [ ] The live standing is computed from `league_stats − baseline` using
      the same `battleAccuracyPct` / `deriveBattleWinner` as resolution, so
      it agrees with the eventual resolved result given unchanged stats.
- [ ] `readBattleLiveScore` performs no write; resolution still happens via
      the existing lazy auto-resolve, not as a side effect of viewing.
- [ ] A duel, a proposed/resolved battle, or a legacy row missing
      baselines falls back to the existing render (`–` / resolved scores)
      without error; a failed live read degrades silently to `–`.
- [ ] Live battle / accepted / resolved cards on the league detail page
      link to the battle detail page.
- [ ] `battle_viewed` fires once per detail view and validates against the
      Zod mirror; the new name is present in the union, the schema, and the
      regenerated `satellite_extension.did` / `src/declarations/**`.
- [ ] The regenerated bindings diff is **only** the additive
      `battle_viewed` variant (no unrelated codegen-format churn after
      `prettier --write`).
- [ ] `npm run quality` + `npm run check` pass.

## Decisions

Resolved with the product owner during spec authoring (2026-06-23):

- **Scope:** both halves, surface active battles in the Battles tab
  **and** show live in-flight standings (chosen over navigation-only).
- **Live-score placement:** detail page only (2 reads), inbox/league cards
  deep-link, avoids an N+1 `league_stats` fan-out across many cards.
- **No polling:** standings computed once per navigation, matching the
  app's read-on-navigate model.
- **Provisional framing:** the in-flight standing is explicitly labelled
  provisional so it's never read as a final score; the authoritative
  resolved result remains the doc's write-once `scoreA`/`scoreB`.
