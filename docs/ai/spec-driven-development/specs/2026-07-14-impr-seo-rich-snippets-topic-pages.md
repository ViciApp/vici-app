# Spec: SEO rich snippets, structured data & a guest Flow funnel

> **Direction changed mid-implementation** (see Decisions): the original
> plan added dedicated `/predictions/[tag]` category topic pages. Per
> product call, those were **dropped**: no new pages. Search intent lands
> on existing surfaces (market detail pages; the in-app `/app` board), and
> a guest "Try Flow free" funnel was added instead. The filename keeps its
> original slug.

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1136)

> **Erratum (2026-07-27): one technical premise below is false.** This
> spec twice defers `$` trading volume on the grounds that
> `list_series_traded_volumes` is "anonymous-guarded" and would need the
> deploy to run under a controller identity. It is not an authorisation
> check: the endpoint rejects only the anonymous principal and accepts
> **any** authenticated one, verified with an unprivileged identity. Since
> #1156 the generator already signs with an ephemeral
> `Ed25519KeyIdentity`, so the access cost is zero, which also makes the
> "all reads are public/anonymous; no controller identity introduced"
> line under Technical requirements stale. The decision to leave volume
> out still stands, but for reasons this spec never considered (the figure
> is `ViciXp` notional, not dollars, and the amounts are negligible);
> see the volume bullet in [`seo.md`](../../frontend/seo.md). The frozen
> text is left as written; this note is the correction.

## Goal

Make Vici reachable and attractive in external search results and link
unfurls for category-intent queries like "prediction market world cup".
Today the crawler-facing layer never emits the phrase "prediction
market", carries no structured data, and shows no live figures. This
change adds JSON-LD structured data, data-rich meta descriptions (active
market counts + current odds), and per-category **topic pages** (e.g.
`/predictions/world-cup`) that own category queries the way a Polymarket
"Sports › World Cup" page does, while the rendered product UI keeps
saying "Social Markets", never "prediction market".

Purely the external SEO / SERP / unfurl surface. No change to the in-app
search box.

## Context

The app is a static SPA (`adapter-static`, `ssr = false`); the
crawler-facing surface is generated **at deploy time**. Canonical
overview: `docs/ai/frontend/seo.md`.

- `scripts/build/generate-seo-assets.ts`: the deploy-time generator
  (second `predeploy` step in `juno.config.ts`). Reads the registry
  canister (`registry.list_series`, anonymous `HttpAgent`), filters to
  `engine_id === 'eng_0'`, applies the WC reveal gate from the committed
  decks, and emits `build/sitemap.xml` + one `build/m/{slug~id8}/index.html`
  per visible market by pattern-rewriting the head tags of `build/index.html`.
- `src/app.html`: the brand-generic head every page falls back to; its
  head tags are a **contract** the generator rewrites by regex (it
  hard-fails if a pattern stops matching exactly once).
- `src/lib/utils/market-slug.utils.ts`: `marketShareParam` (`slug~id8`),
  the single source of the `/m/{param}` shape shared by generator + share
  sheet.
- `src/lib/constants/market-tags.constants.ts`: the closed tag taxonomy
  (`MARKET_TAGS = ['wc','macro','crypto','politics','tech','sports','culture']`),
  `MARKET_TAG_LABEL_KEYS`, `primaryMarketTag`.
- `src/declarations/clearing/clearing.idl.js` + `clearing.did`: the
  engine canister. `list_orders` (order-book mid = live YES odds, the FE's
  own odds source) and `stats()` (global totals) are anonymous-readable.
- `MARKET_TAG_INDEX` Juno collection (public read) / satellite query
  `app_get_market_tags`: reverse tag→seriesIds index; `seriesIds.length`
  per tag = per-category counts. Provisioned on prod since 2026-07-07 (see
  the tag-index provisioning note in memory).
- `src/lib/services/market.services.ts` (`enrichMarketsWithOrderBook`,
  `calculateMarketStats`): how the live UI derives `yesProbability` from
  the order book; the generator will mirror this mid-price computation.
- Existing per-market head shape: `{title} | Vici Social Markets`
  (`market.detail.head_suffix`); home i18n SEO keys `seo.home.*` in
  `src/lib/constants/messages/en.ts`.

## Scope

Four workstreams, one PR.

1. **JSON-LD structured data** (new; none exists today).
   - Home / `app.html`: a `WebSite` + `Organization` `@graph`, static.
     **No `SearchAction`**: a sitelinks search box needs a working in-app
     search endpoint, which is dead code today (deferred with the in-app
     search work).
   - Per-market pages: the generator injects a `WebPage` +
     `BreadcrumbList` graph carrying `name` (title), `description`, `url`
     (canonical), and a `keywords` field including "prediction market" +
     the title. (Chose the conservative `WebPage`/`BreadcrumbList` over a
     `Question`/`QAPage` to avoid Rich-Results warnings for a non-standard
     prediction entity.)
   - Topic pages: `CollectionPage` + `BreadcrumbList` + `ItemList` of
     member markets + `keywords` ("world cup prediction market", "world cup
     odds", …).

2. **Data-rich meta descriptions** (counts + odds; decided, no `$`
   volume in v1).
   - Per-market: append current YES odds to the snippet when the order
     book yields a mid ("Community odds: Yes 41%."). Odds read at deploy
     time from clearing `list_orders`; a market with an empty book falls
     back to the current description tail unchanged.
   - Topic pages: description leads with the active-market count
     ("Trade 23 live World Cup prediction markets on Vici. Community
     odds, updated continuously.").

3. **Guest Flow funnel from a market page** (replaced the topic pages).
   - On the market detail page (`src/routes/(app)/markets/[id]/+page.svelte`),
     a **live** market's read-only footer becomes a CTA: signed-out → "Try
     Flow free", signed-in → "Predict in Flow". `onTryFlow` calls
     `startGuestSession(null)` (for signed-out) then `goto(AppPath.Flow)`;
     the `(app)` gate already exempts a guest on `/flow`
     (`isGuestAllowedRoute`). Direct trading on the detail page stays
     build-flag-off (`MARKET_DETAIL_DIRECT_TRADE_ENABLED`); predictions are
     placed in Flow.
   - i18n keys `market.detail.flow_cta.{guest,member}` across all 7 live
     locales. No new route, no new page.

4. **Sitemap & shell polish**.
   - Add the topic-page URLs to `sitemap.xml` and a `<lastmod>` (deploy
     date) per URL. (Skipped `<changefreq>`/`<priority>`: Google ignores
     them.)
   - Enrich the static `app.html` description to include "prediction
     market" (meta only) and add the JSON-LD from workstream 1.

### Out of scope

- **In-app search box**: the unused `src/lib/utils/search.utils.ts`,
  tag indexing, and synonym mapping. Decided: separate spec/PR. The
  JSON-LD `SearchAction` waits on this too.
- **`seo_topic_page_viewed` analytics**: deferred (see Analytics).
- **`$` trading-volume in snippets**: clean cumulative volume
  (`list_series_traded_volumes`) is anonymous-guarded and would need the
  deploy to run under a controller identity. Deferred; revisit as a
  fast-follow if odds+counts underperform.
- **Per-team / per-entity records** ("England 5-0, 83% win rate"): Vici
  markets are per-question, not modeled around team entities, and no
  per-market win-rate is computed anywhere. Not buildable without new
  aggregation; out of scope.
- **Live freshness / SSR**: all baked figures are a snapshot as of the
  last deploy. No move to SSR/edge rendering.
- **Non-English meta**: per-market head stays English (registry title),
  as today.

## Linked issues

Searched open issues for "SEO": none found. No linked issue.

## Analytics

**Deferred to a fast-follow, deliberately, with reason.** The topic page
is a new landing surface and a `seo_topic_page_viewed` event would be the
natural instrument (reusing the bounded `label`/`count` props, no new
prop keys). But the analytics event **name** is a Candid variant in the
satellite's generated API (`AnalyticsEventNameSchema` →
`satellite.did`/declarations), so adding one couples this frontend +
build-script change to a **satellite wasm rebuild + regenerated
bindings**. Keeping this PR off the satellite schema keeps it small and
low-risk, and avoids a `satellite-schema` CI dependency on a wasm regen.
Interim signal: the auto-attached `path` on existing events and server
request logs show `/predictions/*` traffic. Add the event in a follow-up
that owns the regen.

The deploy-time generator emits no analytics (build step, no user).

## Technical requirements (deploy-time canister/collection reads)

Not a satellite-schema change: no new collections, no doc-shape change,
no `.did`/bindings regen, no writes. It **adds read-only, anonymous
deploy-time reads** to the generator:

- **Performance / call frequency**: once per deploy. Adds, per deploy:
  registry `list_series_with({only_unexpired})` (or reuse the existing
  `list_series` pass), one `list_orders` per visible market (batchable /
  bounded by catalog size, ~hundreds), one `stats()`, one
  `MARKET_TAG_INDEX` read (or `app_get_market_tags`). All query calls; no
  update calls; no instruction-budget concern on the satellite side (the
  40B-instruction risk in `seo.md` is about **asset certification on bulk
  file ops**, not query reads; the +~7 topic files keep us inside the
  proven-safe file-count zone).
- **Failure mode**: generator stays fail-fatal (a degraded run wipes the
  deployed SEO surface under `--prune`). New reads must hard-fail the
  deploy on error, matching the existing registry-read contract. Odds are
  the one soft-fail: a market with no order book simply omits the odds
  clause rather than failing.
- **Security**: all reads are public/anonymous; no controller identity
  introduced (that was the volume path we deferred).
- **Parameters**: tag taxonomy from
  `src/lib/constants/market-tags.constants.ts`; canister ids from
  `src/lib/constants/canisters.constants.ts`. Do not restate values.

## Implementation outline

1. **Shared odds helper for the generator**: add a clearing actor
   (mirror the registry actor setup) and a `midYesProbability(orders)`
   that reuses the same mid-price logic as `calculateMarketStats`
   (`market.services.ts`); factor the pure computation so FE + generator
   share it rather than duplicating.
2. **Per-market meta enrichment**: in `renderMarketShell`, extend
   `composeDescription` to append the odds clause when a mid exists; add
   a JSON-LD injector (new `replaceOnce` on a `<script type="application/ld+json">`
   placeholder added to `app.html`, or inject before `</head>`).
3. **Topic-page generation**: collect the deck-derived WC subset of the
   emitted market set; render a topic shell (title/description +
   `CollectionPage`/`BreadcrumbList`/`ItemList` JSON-LD); write to
   `build/predictions/world-cup/index.html`; push to sitemap.
4. **Topic route**: `src/routes/(app)/predictions/[tag]/+page.svelte`
   resolves the slug via `tagFromTopicSlug` and renders the markets board
   filtered by tag (reuse `markets` / `marketTags` derived + `MarketsListRow`)
   with an `<h1>` and intro copy; exempt `/predictions/` from the `(app)`
   sign-in gate.
5. **Static head + sitemap polish**: add `WebSite`/`Organization`
   JSON-LD + "prediction market" keyword to `app.html`; add
   `lastmod`/`changefreq`/`priority` to `renderSitemap`; add topic URLs.
6. **Docs**: update `docs/ai/frontend/seo.md` (new page types, the
   clearing/tag-index reads, JSON-LD contract) and `docs/ai/PRODUCT.md`
   (the SEO/topic-page behaviour) in this PR.

## Acceptance criteria

- [ ] `WebSite` + `Organization` JSON-LD is present on the home shell
      (`app.html`) and validates on the Rich Results Test.
- [ ] Each emitted `build/m/{slug~id8}/index.html` contains valid
      per-market JSON-LD (`WebPage` + `BreadcrumbList`) and, when the order
      book has a mid, an odds clause in the meta description.
- [ ] One `build/predictions/{slug}/index.html` per non-empty category
      (World Cup deck-derived; others from the anonymous `MARKET_METADATA`
      tag read), each with a title/description containing "prediction
      market" and valid `CollectionPage` + `BreadcrumbList` + `ItemList`
      JSON-LD. A tag-read failure degrades to the WC hub only.
- [ ] `sitemap.xml` lists home, static routes, every visible market, and
      the WC topic page, each with `lastmod`.
- [ ] `/predictions/world-cup` renders a tag-scoped markets board with an
      `<h1>` for signed-out visitors; unrevealed WC markets never appear
      in the emitted topic page or its sitemap entry; an unknown slug
      redirects to `/app`.
- [ ] The rendered product UI still never displays "prediction market";
      the phrase appears only in `<head>` / JSON-LD.
- [ ] Generator stays fail-fatal on registry read errors; a clearing
      (odds) read failure or an empty order book degrades to no-odds, not
      a failed deploy.
- [ ] `npm run quality` + `npm run check` pass; `docs/ai/frontend/seo.md`
      and `PRODUCT.md` updated in the same PR.

## Open questions

- Verify the emitted JSON-LD against Google's Rich Results Test on prod
  after deploy (the `WebPage`/`CollectionPage`/`BreadcrumbList`/`ItemList`
  graphs are conservative and should validate, but confirm no warnings).

## Decisions

- **Baked snippet data = counts + odds** (no `$` volume in v1): volume's
  clean source (`list_series_traded_volumes`) is anonymous-guarded and
  staleness risk on money figures is higher; counts+odds are anonymous,
  cheap, and read as representative.
- **External SEO only**: in-app search (and the `SearchAction`) are a
  separate surface/spec.
- **"prediction market" in meta only**: emitted in
  `<title>`/description/JSON-LD to rank for the category query; never in
  the rendered UI, which keeps "Social Markets". Does not touch the
  "prediction not bet" terminology rule.
- **Topic-page URL = `/predictions/{slug}`** (`world-cup`, per
  `TOPIC_SLUG_BY_TAG` next to the taxonomy): keyword-carrying and
  namespaced; the `wc` tag id expands to the human `world-cup`.
- **No new pages: topic pages dropped; funnel to Flow instead.** The
  original plan built `/predictions/[tag]` category pages (briefly shipped
  for every tag via an anonymous `MARKET_METADATA` read). Product call
  reversed it: don't add a new surface. Search intent lands on **existing**
  pages, a specific market → its detail page, category browsing → the
  in-app `/app` board, and a signed-out visitor gets a "Try Flow free"
  guest funnel from the market page. Trade-off accepted: without a category
  page the phrase "prediction market world cup" ranks weaker; individual WC
  market pages (carrying "World Cup" + "prediction market" in their meta)
  are the category presence. The route, generator topic emission, tag read,
  and `TOPIC_SLUG_BY_TAG` were all removed.
- **Guest Flow funnel**: a signed-out visitor's predict intent on a live
  market page routes to a free guest Flow session
  (`startGuestSession` + `goto(Flow)`) rather than a `/signin` wall, since
  direct trading on the detail page is build-flag-off and predictions are
  placed in Flow.
- **Odds are a soft dependency**: a clearing read failure degrades to "no
  odds clause", never a failed deploy; the registry read stays fatal.
- **Analytics deferred**: avoids coupling this PR to a satellite schema
  regen (see Analytics).
