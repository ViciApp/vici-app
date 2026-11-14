# Spec: Index market tags so battle scoping skips the metadata scan

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1060)

**Authored retroactively.** #1060 (a follow-up to #1056) shipped without
the mandatory satellite spec; this is the decision record reconstructed
from the merged implementation.

## Goal

A tag-scoped league battle resolves its set of in-scope series by reading
one small index bucket instead of scanning the entire `market_metadata`
collection in JS. This removes an O(all-markets) cost from every
non-`all` battle resolve and every live-standings read (an `update`),
which would otherwise degrade as the market catalog grows.

## Context

- Flagged by Copilot on #1056 (comment 3486913222): `scopeSeriesIds()`
  resolved a tag-scoped battle's series set by listing all of
  `market_metadata` and filtering in JS.
- Resolution scope path: `src/satellite/services/battle-resolution.services.ts`
  (`scopeSeriesIds`).
- Metadata upsert (index maintenance point):
  `src/satellite/services/market-metadata.services.ts`
  (`upsertMarketMetadata`).
- New service: `src/satellite/services/market-tag-index.services.ts`
  (`rebuildMarketTagIndex`).
- Types: `src/lib/types/market-metadata.ts` (`MarketTagIndex`) + Zod
  mirror `src/lib/schema/market-metadata.schema.ts` (`MarketTagIndexSchema`).
- Collection wiring (the two-place sync rule):
  `juno.collections.json`, `juno.config.ts`, and the `Collection` enum in
  `src/lib/constants/collections.constants.ts`. Closed tag taxonomy:
  `MARKET_TAGS`.
- Existing precedent for an inline-maintained index (hooks don't fire on
  serverless `setDocStore`):
  `activity_reaction_counts`, `event_rollups`.

## Scope

1. **New `market_tag_index` collection.** One doc per tag of the closed
   `MARKET_TAGS` taxonomy, keyed by tag id, holding that tag's
   `seriesIds`. **Public read** so battle resolution reads a single bucket
   as the caller; **controllers write**.
2. **Inline maintenance in `upsertMarketMetadata`.** The upsert diffs a
   market's old vs new tags and moves the series between buckets as an
   admin. Best-effort: a bucket write never traps the primary metadata
   upsert.
3. **`scopeSeriesIds` reads one bucket** for the battle's scope tag,
   O(matching-series), instead of scanning `market_metadata`. An
   empty/absent bucket still scores the battle as a void face-off
   (unchanged semantics).
4. **Admin `rebuildMarketTagIndex`** re-derives every bucket from a single
   `market_metadata` scan (backfill + repair).
5. **New `MarketTagIndex` type + `MarketTagIndexSchema`.**

### Out of scope

- Any change to the `MARKET_TAGS` taxonomy itself.
- Indexing anything other than tag → seriesIds (e.g. no reverse index).
- The `all`-scope battle path (never scanned metadata).

## Linked issues

No open issue; originates from a review comment on #1056.

## Analytics

**No new product analytics.** A pure server-side performance refactor
with no user-visible behaviour change; nothing to instrument.

## Design artifacts (frontend, optional)

None: no frontend surface changes.

## Technical requirements (satellite / backend, mandatory)

- **Performance.** Resolve/live-standings scope lookup drops from
  O(all-markets) (list + JS filter of `market_metadata`) to
  O(matching-series) (one keyed bucket read). Upsert gains a bounded
  diff-and-move of at most (old-tags ∪ new-tags) buckets.
- **Instruction budget.** The heavy former cost (full metadata scan on
  every non-`all` resolve, which is an `update` for live standings) is
  removed. `rebuildMarketTagIndex` does one full scan but is an
  admin-only, occasional op.
- **Memory & storage.** New `market_tag_index` collection: one doc per tag
  (bounded by the closed taxonomy: small, fixed cardinality), each doc
  holding a `seriesIds` list that grows with the catalog. No per-user
  growth.
- **Scalability.** At 10×/100× markets the per-resolve cost is unchanged
  (one bucket read); only bucket-doc size grows with catalog size, not the
  number of reads.
- **Upgrade & compatibility.** New collection → wire in all three places
  (`juno.collections.json`, `juno.config.ts`, `Collection` enum).
  Satellite change → `npm run juno:functions:build`, commit regenerated
  `.did` + FE declarations. Additive, not breaking. **Deploy step:** run
  `rebuildMarketTagIndex` once after deploy to backfill markets that
  predate the index; until then tag-scoped battles score as void.
  New/edited markets self-populate via the upsert path. Requires a manual
  satellite wasm upgrade (auto-upgrade off).
- **Security.** `market_tag_index` is public-read / controllers-write;
  inline maintenance and `rebuildMarketTagIndex` run as an admin via
  `getAdminAccessKeys`. `rebuildMarketTagIndex` is admin-gated.
- **Parameters.** Reuse the `MARKET_TAGS` taxonomy constant; no new tuning
  values.

## Implementation outline

1. Define `MarketTagIndex` + `MarketTagIndexSchema`; add the
   `MARKET_TAG_INDEX` collection in all three wiring locations.
2. `market-tag-index.services.ts`: bucket read/write helpers +
   `rebuildMarketTagIndex` (one `market_metadata` scan → buckets).
3. `upsertMarketMetadata`: diff old vs new tags, move the series between
   buckets (best-effort, never traps the upsert).
4. `scopeSeriesIds`: read the single scope-tag bucket; empty/absent →
   void, as today.
5. Regenerate bindings; commit `.did` + declarations.

## Acceptance criteria

- [x] A tag-scoped battle resolves from a single `market_tag_index`
      bucket read; `market_metadata` is not scanned on the resolve/live
      path.
- [x] Upserting a market with changed tags moves its series id out of the
      old bucket(s) and into the new one(s); unchanged tags are untouched.
- [x] A metadata upsert still succeeds if a bucket write fails
      (best-effort, no trap).
- [x] `rebuildMarketTagIndex` reconstructs every bucket and clears stale
      membership from a single scan.
- [x] An empty/absent bucket scores the battle as a void face-off
      (unchanged semantics).
- [x] `npm run juno:functions:build` + `npm run check` pass; regenerated
      `.did` and FE declarations committed.

## Decisions

- **Inline maintenance, not a hook.** Juno hooks don't fire on serverless
  `setDocStore`, so the upsert endpoint maintains the index inline, the
  same pattern already used by `activity_reaction_counts` and
  `event_rollups`.
- **No new `docs/ai` page.** The collection is documented inline in
  `collections.constants.ts` (the catalog) and reuses the existing
  inline-maintained-index pattern.
