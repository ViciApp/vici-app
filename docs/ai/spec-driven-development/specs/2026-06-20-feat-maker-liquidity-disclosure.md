# Spec: Market-maker liquidity disclosure

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#947)

## Goal

Tell the user, in plain language on a market surface, that the price they
see comes from a live order book seeded with resting liquidity by VICI's
market maker, so an early or thin market still shows a moving line
without implying phantom human predictors. Today the app shows the line
and a `Predictors` count with no statement of where the liquidity comes
from; a fresh market reads as if a crowd is already there, which is not
the contract we want to ship around real money.

## Context

Production prices a market off the icdc-core CLOB, not a client-side
maker. The honest mechanism to disclose is therefore the real one:

- Price = best-bid/ask midpoint from the clearing order book:
  `calculateProbability()` in `src/lib/utils/market.utils.ts`, fed by
  `fetchOrderBook()` in `src/lib/services/order.services.ts` and
  `listOrders()` in `src/lib/api/clearing.api.ts`.
- The resting liquidity that keeps a thin market quoting is posted by the
  off-chain maker (registered as engine `eng_0`), not by the app. The
  disclosure must describe _that_ book-seeding mechanism, not a
  client-side maker.
- Existing honest cold-start copy: `market.detail.coldstart.lead` /
  `.body` ("New market." / "No one has called this market yet; your
  prediction sets the first read."), rendered at
  `src/routes/(app)/markets/[id]/+page.svelte:748`. This covers the
  _empty_ state but says nothing about maker liquidity once a line exists.
- Stats surface: `src/lib/components/market/MarketDetailStatsGrid.svelte`
  (VOLUME / LIQUIDITY / CLOSES / MY CALL). Note `liquidity` here is a real
  proxy: `min(yesVolume, noVolume)`, not fabricated depth.
- Resolution card: `src/lib/components/market/MarketDetailResolutionCard.svelte`
  (the existing "how / where / when" disclosure block, directly below the
  stats grid: the natural neighbour for a "how is this priced" line).
- i18n catalogs: `src/lib/constants/messages/*` (8 locales). New keys must
  land in every catalog or the i18n lint fails (`docs/ai/frontend/i18n.md`).

Reusability: this is a copy + small-component change. Reuse the existing
eyebrow/body card styling pattern from `MarketDetailResolutionCard.svelte`
rather than introducing a new card primitive.

## Scope

- Add an always-visible one-line disclosure on the market detail surface,
  styled as a muted caption near the stats grid / resolution card, e.g.:
  "Prices come from a live order book. VICI's market maker seeds resting
  liquidity so the line moves from your first call." Final wording is a
  pending decision below.
- Add the new i18n key(s) to all 8 locale catalogs under a
  `market.detail.maker.*` namespace (English authored; other locales
  follow the repo's existing translation approach for new keys).
- Keep the existing cold-start copy; the disclosure complements it (empty
  → "your call sets the line"; non-empty → "the maker seeds the book").

### Out of scope

- The "Depth / ≈X VXP moves the line 1%" teaching readout and the
  prototype's "drop the Liquidity tile" display-contract change: both are
  a separate product decision (see the display-contract decision note;
  prod's Liquidity tile is a real proxy, not theatre, so removal is not
  obviously correct).
- Any maker behaviour, depth tuning, or baseline-odds seeding: that lives
  in the `vici-maker` repo, not here.
- Surfacing the disclosure in the Flow swipe deck and on market cards:
  detail page first; fast-follow if it reads well.

## Linked issues

No related open issue found (searched open issues for maker / liquidity /
disclosure / transparency / price / odds). New product-transparency
improvement.

## Analytics

No new analytics. The disclosure is static, always-visible informational
copy with no interaction to instrument; `market_viewed` already covers the
surface. If the pending decision lands on an interactive info popover
instead of a static line, that tap is worth a new
`market_maker_info_viewed` event, which would require the dual-source
addition (TS union + Zod mirror) and a declarations regen
(`reference_analytics_event_is_candid_variant`); that cost is part of why
the static line is the recommended default.

## Implementation outline

1. Add `market.detail.maker.disclosure` (and any companion key) to
   `src/lib/constants/messages/en.ts`, then mirror into the other 7
   catalogs (`de`, `es`, `fr`, `it`, `pt`, `pt-BR`, `zh-Hans`).
2. Render the disclosure on `src/routes/(app)/markets/[id]/+page.svelte`,
   adjacent to `MarketDetailStatsGrid` / `MarketDetailResolutionCard`,
   reusing the muted-caption styling already in the resolution card.
3. If it grows beyond one line, extract a small
   `MarketDetailMakerNote.svelte` rather than inlining markup in the route.
4. `npm run quality` (covers the i18n completeness lint) and `npm run check`.

## Acceptance criteria

- [ ] Market detail shows a one-line maker-liquidity disclosure that
      describes the real order-book mechanism (no client-side-maker or
      synthetic-crowd implication).
- [ ] The disclosure renders correctly in light and dark themes and reads
      as a muted caption, not a primary stat.
- [ ] New i18n key(s) present in all 8 locale catalogs; `npm run quality`
      passes the i18n check.
- [ ] Existing cold-start copy still renders on an empty market; the two
      messages read coherently together.
- [ ] `npm run check` passes.

## Decisions

- **Final wording (English):** "Prices come from a live order book.
  VICI's market maker seeds it with resting liquidity, so the line moves
  from the first call." Accurate to the CLOB + maker model; no
  phantom-human implication. Translated into all 7 live locales.
- **Static line over interactive popover.** Shipped as an always-visible
  muted caption: zero analytics/regen cost, and the message is short
  enough that a popover added friction without value.
- **Placement & gating.** Rendered under the stats grid, gated to live
  markets (`{:else if isLive}` after `isColdStart`, which itself implies
  `isLive`): a live empty market keeps "your prediction sets the first
  read"; a live market with a line shows the maker disclosure; resolved /
  expired markets show neither, since the book is no longer the price
  source.
