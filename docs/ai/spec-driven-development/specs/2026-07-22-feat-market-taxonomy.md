# Spec: Market taxonomy (3 layers), model, nav, and backfill

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#1168)

## Goal

Replace the flat 7-value market tag system with a Polymarket-style three-layer taxonomy, **macro → micro → tag**, end to end: the model in code, the macro-bar + micro-chip browse nav (rendering only populated categories), card/detail/admin surfaces, and a full backfill of every existing market and deck onto the correct micro. Shipped as one PR (#1168): the model is inert on its own, so nav + backfill land together.

## Context

Today: a closed set of 7 tags (`wc, macro, crypto, politics, tech, sports, culture`) in `src/lib/constants/market-tags.constants.ts`, stored as `MarketMetadata.tags: string[]`, reverse-indexed by the satellite `market_tag_index`, coloured in `src/lib/utils/tag-color.utils.ts`, labelled via `market.tag.<id>`, rendered through `categoryLabel` / `primaryMarketTag`, and consumed by the cockpit via `app_get_market_tags`. Decks under `scripts/data/*.json` carry a `categories` field mapped onto `tags` by `scripts/tag-markets.sh`. Two of the seven aren't peer categories (`macro`=Economy, `wc`=a Sports/Soccer event), and the set is too coarse to browse.

## Scope

### Model (`src/lib/constants/market-taxonomy.constants.ts`)

Closed **7 macros / 127 micros** (each micro → one macro), `MacroId`/`MicroId`, `MICRO_TO_MACRO`, guards, `macroColor`/`microColor` (6 hexes reused from `TAG_COLORS`; `world` inherits `wc`'s gold), `macroLabelKey`/`microLabelKey`, classification helpers over the stored flat array (`splitClassification`, `classificationMicros/Tags/Macros`, `primaryMicro`/`primaryMacro`: **first micro = primary**), `normalizeStoredTags`. Wasm-safe (type-only `MessageKey` import). (Backfill re-classifies decks by title to the correct micro, so no old→catch-all legacy map is needed.)

### Storage (no wire change)

Stays `MarketMetadata.tags: string[]` = `[<micro>…, <free-tag>…]`, primary = first micro, macro derived. Micro vs free tag distinguished by `isMicroId`. No satellite schema / `.did` / bindings change.

### Index (satellite, derived macro buckets)

`market_tag_index` now maintains **micro buckets + derived macro buckets** (`indexKeysForTags = classificationMicros ∪ classificationMacros`). A `sports` macro bucket stays populated, so the cockpit's `app_get_market_tags` sport/non-sport classification keeps working unchanged, and the macro-bar filter gets a direct bucket. `updateMarketTagIndex` and `rebuildMarketTagIndexFn` updated; `market-metadata.services` upsert uses `normalizeStoredTags` (the old `normalizeMarketTags` would drop micro ids).

### Frontend

Repoint color/label/art/card/detail/portfolio surfaces at the taxonomy helpers. New `MarketsCategoryChips` (macro bar + micro sub-chips) wired into `MarketsPage`, replacing the hardcoded `wc` focus; a chip renders only when populated (`populatedMacros`/`populatedMicros` derived from `marketTagsStore`). Admin `MarketMetadataForm` / `MetadataShowcaseTab` become a macro→micro cascading picker + free-tag input. `CreateBoutModal` scopes by macro. `market_category_filter` analytics event (props `macro`, `micro`).

### i18n

`market.macro.*` (7) + `market.micro.*` (127) in all 7 live catalogs (done); plus any new `market.category.*` UI strings.

### Backfill (all markets, old and current)

Re-classify **every** deck row's `categories` to the correct micro: WC rows → `["soccer","world-cup"]` (~1,117 rows); the ~30 non-WC rows classified by title (CPI→`inflation`, S&P→`stocks`, BTC→`bitcoin`, Fed→`fed-rates`, GPT-6→`ai`, 49ers→`nfl`, …). Because markets match by title, re-running `tag:markets` from the corrected decks rewrites every prod market's metadata onto micro ids; then `app_rebuild_market_tag_index` rebuilds the (now micro+macro) buckets. Per-user `CategoryStatsBucket` re-keyed to `MacroId` (`primaryMacro`). Retire `market-tags.constants.ts` once no importers remain.

### Out of scope

- **Surfacing Layer-3 tags in the UI** (tag pills on cards/detail, a browsable/searchable tag filter, Polymarket-style long-tail like `gta-6`). Decided to defer: the browse nav stays macro + micro only this PR; free tags remain per-market metadata (used by the admin editor and the WC skill gate, not rendered to users). Revisit in a follow-up.
- Structured `classifications` object field on the wire (stays flat `string[]`). Revisit only if per-path tag scoping is needed.
- NLP auto-classification; deck authors assign micros.
- Any change inside the separate `vici-cockpit` repo: the derived `sports` macro bucket keeps it working without edits.

## Linked issues

No existing open issue: new product direction.

## Analytics

Add `market_category_filter` (macro/micro chip select). Props `macro: MacroId`, `micro?: MicroId`; bounded closed-enum vocab, no PII. Lands in both `src/lib/types/analytics-event.ts` and `src/lib/schema/analytics-event.schema.ts`; captured via `track` in `analytics.services.ts`.

## Design artifacts

`./2026-07-22-feat-market-taxonomy/taxonomy.json`: full macro/micro taxonomy (mirror of the TS source).

## Technical requirements (satellite / backend)

- **Performance:** no new hooks/endpoints. `updateMarketTagIndex` still diffs per write; index keys per market grow from ≤2 to ≤ (micros + their macros). `rebuild` is one admin scan (unchanged profile).
- **Memory & storage:** `market_tag_index` grows from ≤7 to ≤134 buckets (≤127 micro + ≤7 macro), one small doc each, negligible. Doc shape `{ tag, seriesIds[], updatedAtMs }` unchanged. No new collection.
- **Scalability:** bucket count bounded by the closed set. Macro-scoped reads hit a single macro bucket (no fan-out over markets).
- **Upgrade & compatibility:** **non-breaking**; no `.did` / bindings change (flat `string[]`, same collections/endpoints). Only data migrates (deck re-tag + `tag:markets` re-seed + index rebuild).
- **Security:** unchanged; `market_metadata` writes stay creator/admin-gated; `market_tag_index` stays controller/endpoint-written.
- **Parameters:** taxonomy in `src/lib/constants/market-taxonomy.constants.ts`, not restated here.

## Implementation outline

1. Model + `normalizeStoredTags` in `market-taxonomy.constants.ts`; 134 live-locale labels (7 macro + 127 micro).
2. Satellite: index micro+macro buckets; upsert `normalizeStoredTags`; battle-resolution accepts micro|macro; `CategoryStatsBucket` → `MacroId`.
3. FE: repoint utils/cards/detail; `populatedMacros/Micros`; `MarketsCategoryChips` → `MarketsPage`; admin cascading picker; `market_category_filter`.
4. Backfill: re-classify all `scripts/data/*.json`; (ops) `npm run tag:markets` per deck → prod; (ops) `app_rebuild_market_tag_index`.
5. Delete `market-tags.constants.ts`; update `PRODUCT.md`.
6. `npm run check` + `npm run quality` + `npm run juno:functions:build` green.

## Acceptance criteria

- [ ] Taxonomy module exports the 7/127 model with guards, colors, label-key + classification helpers, `normalizeStoredTags`; wasm-safe.
- [ ] `market.macro.*` + `market.micro.*` in all 7 live catalogs; `check:i18n` passes.
- [ ] Satellite index writes micro + macro buckets; upsert keeps micro ids; `sports` bucket stays populated (cockpit intact).
- [ ] Markets browse shows a macro bar + populated micro chips; filtering works; cards/detail show the primary micro label + macro color.
- [ ] Every deck row carries a valid micro (categories[0] ∈ micro set); no bare legacy tag remains; no market orphaned.
- [ ] `market-tags.constants.ts` deleted; no references remain.
- [ ] `market_category_filter` fires on chip select (both union + Zod mirror).
- [ ] `npm run check` + `npm run quality` + `npm run juno:functions:build` green.

## Decisions

- **Multiple classifications, first micro primary**: matches the existing multi-tag reality; avoids double-counting.
- **Flat storage, macro derived; index carries derived macro buckets**: no `.did`/bindings/cockpit change; cockpit's `sports` bucket preserved via the index layer rather than storing a redundant macro token per doc.
- **Full taxonomy shipped, UI shows only populated**: empty micros cost nothing.
- **Backfill via deck re-tag + `tag:markets` re-seed** (not a bespoke migration endpoint): reuses the existing pipeline; correct micro per title, not a mechanical old→catch-all map.
- **`world` new macro; `economy` replaces `macro`; `wc` → `soccer` + `world-cup` tag; `weather`/`novelty` micros** absorb the oddity markets that abused `culture`.

## Pending decisions

- Closed/settled markets: the deck re-seed re-tags them too (all markets are deck-sourced), so historical category leaderboard stats shift to macro keys. Confirm that's desired vs. freezing settled history.
- WC launch framing: how much of the "Beyond the Cup" skill-gate / `MarketsPage` WC focus survives once `wc` becomes `soccer` + `world-cup`, handled as `primaryMacro==='sports'` + `world-cup` tag for now; confirm the product intent.

## Decisions log (build)

- **Subsystem migration folded in:** the battle-scope / Flow-tag-prefs / per-user category-stats subsystem (`battle.ts`, `battle.utils.ts`, `league-stats.ts`, `preferences.store.ts`, `user-stats.services.ts`, `CreateBoutModal`) also moved off the legacy 7-tag vocabulary to `MacroId`, so `market-tags.constants.ts` could be deleted cleanly. Battle scope now offers macro narrowings (`wc`→`sports`, `macro`→`economy`); `flowTags` default became `MACRO_IDS`; `computeUserStatsSnapshot` keys by `primaryMacro`. Leaving it half-migrated would have silently stopped category-stat recording (a micro-only market yields `''` under the old `primaryMarketTag`).
- **`market_category_filter` analytics, fully wired:** event name in the TS union + Zod mirror, `track()` fires (macro/micro in the free `label` dim), and the generated satellite binding (`src/declarations/satellite/*`) is regenerated to match. Gotcha resolved: `juno functions build` must be followed by `prettier --write` on the declarations (the raw didc output is unformatted); running it against the CI-pinned `@junobuild/cli@0.15.6` + `@icp-sdk/bindgen@0.4.0` yields a clean 3-line-per-file diff (just the new enum member), not the template churn a mismatched toolchain produces. No `.did`/endpoint contract changed.
- **Ops backfill is a separate run:** deck data is re-classified in-repo, but pushing it to prod (`tag:markets` re-seed) and rebuilding the index (`app_rebuild_market_tag_index`) are admin-gated actions not runnable from CI; see the PR body for the exact commands.
