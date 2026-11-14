# Spec: Markets show a loading skeleton instead of a 50% placeholder

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#875)

## Goal

A market whose order book hasn't loaded yet shows a **loading skeleton**
for its odds, not a misleading **50%**. Today every market the list
hasn't order-book-enriched renders a hardcoded 50/50 placeholder, so a
catalogue of markets that are actually priced (e.g. 3% / 36% / 95%)
reads as a wall of coin-flips until each book trickles in. The fix makes
"probability not known yet" a real state in the `Market` model, renders
skeletons for it, seeds last-known odds from the price cache for instant
navigation, and upgrades the market detail page to a query-then-certified
read so its first paint is fast and then verified.

## Context

The displayed probability is `yesProb = midPrice ?? 0.5`, and the 0.5
sentinel is seeded in several places: `Market.yesProbability` is a
**required** `number`, so "unknown" cannot be expressed and defaults to
0.5:

- `src/lib/types/market.ts:66-71`: `yesProbability: number` /
  `noProbability: number` required; `bestBid?`/`bestAsk?` already optional.
- `src/lib/utils/market.utils.ts`: `mapMarketData` defaults
  `yesProbability = 0` / `noProbability = 0`; `calculateMarketStats`
  returns `midPrice: calculateProbability({ bids, asks })`, and
  `calculateProbability` returns **`0.5` for an empty book** (the sentinel
  source).
- `src/lib/services/market.services.ts`: seeds `yesProbability: 0.5` in
  the lite paths (`fetchMarkets` lite ~281, `fetchOpenBinaryMarketsLite`
  ~446) and `midPrice ?? 0.5` in the enrich/fetch paths (~320, ~494, ~734).
  `loadMarketsProgressive` already seeds from resolved outcome → in-memory
  prior → persisted cache (`readCachedYesProbabilities`) → else lite 0.5.
- `src/lib/utils/market-price-cache.utils.ts`: public, 1-day TTL,
  keyed by market id, only liquidity-backed prices are written
  (`cacheMarketPrices`). This is the fast-navigation seed.

Certified read pattern already exists:
`src/lib/services/query-update.services.ts` → `loadWithCertification`
wraps `@dfinity/utils` `queryAndUpdate` (query first, certified update
second, stale query dropped). `loadMarket` in `market.services.ts`
already uses it, but the detail route
`src/routes/(app)/markets/[id]/+page.svelte` currently calls the
one-shot `getMarket` instead, so its first paint waits for the
certified call.

Skeletons already exist:
`src/lib/components/market/MarketCardSkeleton.svelte` and
`MarketDetailSkeleton.svelte`. The markets list (`MarketsPage.svelte`)
uses ad-hoc placeholder `<div>`s only while the whole list is loading,
not per-card while a card's odds are pending.

Probability consumers that must tolerate "unknown" (from the audit):

- Display/format: `BinaryProbabilities.svelte`, `ConsensusCompass.svelte`,
  `MarketsFeaturedCard.svelte`, `MarketsListRow.svelte`,
  `OnboardingBeat1Card.svelte`, `SharePopover.svelte`,
  `flow-card-display.utils.ts` (`consensusPercent`, used for sorting).
- Math: `FlowCard.svelte` (payout preview), `portfolio.utils.ts` /
  `PortfolioPage.svelte` (position value/P&L), `DashPage.svelte` (i18n
  context string), `market.utils.ts` `getExecutionPrice`
  (`bestAsk ?? yesProbability`).
- `FlowMode.svelte` consensus-side detection (`yesProbability ?? 0.5`).
- Resolved markets pin `yesProbability` to 1/0: unchanged.

## Scope

1. **Model: make "unknown" representable** (`src/lib/types/market.ts`):
   `yesProbability?: number`, `noProbability?: number` (optional;
   `undefined` ⇒ not known). Add `priceLoaded?: boolean`: `true` once an
   order-book read has completed for this market (regardless of
   liquidity), to distinguish _loading_ (skeleton) from _loaded but no
   liquidity_ (dash).

2. **Kill the 0.5 sentinel**:
   - `calculateProbability` returns `number | undefined`: `undefined`
     when both `bids` and `asks` are empty (keep the one-sided and
     two-sided branches). `calculateMarketStats.midPrice` becomes
     `number | undefined`.
   - `mapMarketData` defaults `yesProbability`/`noProbability` to
     `undefined`, not `0`.
   - `market.services.ts`: replace every `yesProbability: 0.5` /
     `midPrice ?? 0.5` with the real value or `undefined`; set
     `priceLoaded: true` on order-book-enriched/fetched markets and on
     resolved markets; lite/seed markets keep `priceLoaded` falsy unless a
     cached price is applied.

3. **Fast navigation via the existing cache**: the
   `loadMarketsProgressive` seed already prefers
   `readCachedYesProbabilities`; when a cached price is applied, the card
   shows it immediately (no skeleton) and enrichment upgrades it in place.
   Only liquidity-backed prices remain cached (unchanged).

4. **queryAndUpdate on the detail page**: switch
   `src/routes/(app)/markets/[id]/+page.svelte` from `getMarket` (one-shot
   certified) to `loadMarket` (`loadWithCertification` → query then
   certified update) so first paint is the fast query, then replaced by
   the certified result. Render `MarketDetailSkeleton` until the first
   response.

5. **Render skeletons, never NaN** (the consumers above):
   - When `yesProbability == null` (use `isNullish`): render a compact
     odds **skeleton** if `!priceLoaded`, else a neutral **dash / "no
     liquidity"** indicator. New shared inline component
     `MarketOddsSkeleton.svelte` (or a variant flag on the existing
     skeleton: pick per `reusability.md`).
   - Guard all math consumers so `undefined` short-circuits to the
     skeleton/placeholder or a cached value instead of producing `NaN`/`0`
     (payout preview, portfolio value, execution price, sorting key).

6. **i18n + a11y**: skeleton carries `aria-busy` + a labelled
   "Loading odds" string; the no-liquidity indicator carries a
   "No liquidity yet" label. Add both keys to the **live** locale
   catalogs under `src/lib/constants/messages/` via `t({ locale, key })`
   (the `soon`-tier landing-only catalogs fall back to English;
   `check:i18n` validates the live set).

7. **Docs (meta-update)**: document the optional-probability +
   `priceLoaded` + skeleton pattern in
   `docs/ai/frontend/stack-and-patterns.md` (and the skeleton component in
   `reusability.md` if a new one is added). Add a "Market odds display"
   behaviour entry to `docs/ai/PRODUCT.md`.

### Out of scope

- A full certified (`queryAndUpdate`) pass over the **entire markets
  list**: see Decisions (perf). The list stays uncertified-fast;
  certification is for the detail/trade surface.
- Changing the maker, the order-book schema, or `calculateCategoricalMidPrice`.
- Reworking the list's whole-page loading placeholders beyond per-card odds.

## Linked issues

Searched open issues on `ViciApp/vici-app`: no existing issue
tracks the 50% placeholder. No `Closes`/`Part of`.

## Analytics

No new analytics. This is a display-correctness and loading-state fix:
it introduces no new user action or surface to measure, and the existing
prediction/trade events already cover behaviour on these screens.
Instrumenting skeleton render would be noise, not signal.

## Implementation outline

1. `market.ts`: make probabilities optional; add `priceLoaded?: boolean`.
2. `market.utils.ts`: `calculateProbability` → `number | undefined`;
   `calculateMarketStats.midPrice` type; `mapMarketData` defaults to
   `undefined`; `getExecutionPrice` guards `yesProbability` nullish.
3. `market.services.ts`: remove 0.5 seeds/fallbacks; set `priceLoaded`;
   keep the cache-seed priority; resolved markets set `priceLoaded: true`.
4. `+page.svelte` (market detail): `getMarket` → `loadMarket`
   (query+update) with `MarketDetailSkeleton` until first `onLoad`.
5. Add `MarketOddsSkeleton.svelte` (or skeleton variant); wire it into
   `BinaryProbabilities`, `MarketCard`/`MarketsListRow`,
   `MarketsFeaturedCard`, `ConsensusCompass`, `OnboardingBeat1Card`.
6. Guard math consumers: `FlowCard`, `portfolio.utils.ts` /
   `PortfolioPage`, `DashPage`, `SharePopover`, `FlowMode`,
   `consensusPercent`.
7. i18n keys in all 12 catalogs; a11y attributes on skeleton/dash.
8. `stack-and-patterns.md`, `reusability.md` (if new component),
   `PRODUCT.md` updates.
9. `npm run quality && npm run check`.

## Acceptance criteria

- [ ] `grep` for `0.5` in `market.services.ts` market-loading paths
      returns no probability sentinels; `calculateProbability` returns
      `undefined` for an empty book.
- [ ] A market list rendered before enrichment shows odds **skeletons**,
      not "50%".
- [ ] A market with a real book shows its true odds (e.g. 3% / 95%),
      seeded instantly from cache on repeat navigation.
- [ ] A genuinely empty book shows a neutral dash / "no liquidity", never
      50% and never a permanent skeleton.
- [ ] Market detail page first-paints from the query then updates to the
      certified result (`loadMarket`), with a skeleton until first load.
- [ ] No consumer renders `NaN%`; payout/portfolio/execution math
      short-circuits on unknown probability.
- [ ] New strings exist in all live locale catalogs (`check:i18n`
      passes); skeleton/dash are `aria`-labelled.
- [ ] `npm run quality` and `npm run check` pass.
- [ ] `docs/ai/frontend/stack-and-patterns.md` and `PRODUCT.md` updated in
      this PR.

## Decisions

- **No `null` 0.5 sentinel; use optional + `priceLoaded`.** A single
  optional `yesProbability` can't tell _loading_ from _no liquidity_; a
  small `priceLoaded` boolean does, and avoids a heavier `priceState`
  enum the rest of the codebase would have to learn.
- **List stays uncertified-fast; only the detail page uses
  `queryAndUpdate`.** A certified update pass over the whole catalogue
  doubles hundreds of book reads for a non-authoritative preview. The
  list's fast path is cache-seed → uncertified enrich (already batched);
  the authoritative certified read belongs on the detail/trade surface,
  where `loadMarket` already provides query-then-update.
