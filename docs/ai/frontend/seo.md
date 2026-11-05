# SEO / crawler surface

> Higher up the chain: [`README.md`](./README.md) → [`docs/ai/`](../README.md).

The app is a static SPA (`adapter-static`, `ssr = false`, `index.html`
fallback), so at runtime every URL serves the same shell. The crawler-facing
layer is generated **at deploy time** instead:

- [`src/app.html`](../../../src/app.html) carries the brand-generic head
  (title, description, canonical, OG/Twitter tags) every page falls back to.
- [`scripts/build/generate-seo-assets.ts`](../../../scripts/build/generate-seo-assets.ts)
  runs as the second `predeploy` step in
  [`juno.config.ts`](../../../juno.config.ts) and emits into `build/`:
  - `sitemap.xml` — public statics + one URL per visible market
    (referenced from [`static/robots.txt`](../../../static/robots.txt));
  - ONE per-market copy of the built shell at `m/{slug~id8}/index.html`
    (the keyword-carrying **canonical**, the same param the share sheet
    hands out) with that market's title/description swapped into the head
    tags and `window.__viciSeriesId` embedded for the `/m/[id]` route.
    The plain-id routes (`/markets/{id}`, `/m/{id}`) deliberately get no
    copies — see the file-count constraint below.

## Slugged share links

`#lib/utils/market-slug.utils` is the single source of the `/m/{param}`
shape: `slugifyMarketTitle` (EN registry title → `will-brazil-beat-norway`)
and `marketShareParam` (`slug~id8`). The 8-hex id suffix makes the param
unique by construction — registry titles are immutable but not
collision-proof after normalization, and the share sheet (one market in
hand) and the SEO generator (whole catalog) must produce identical params
with no coordination. `SharePopover` builds links from the **on-chain EN
title, never `displayTitle`** — a translated slug would miss the emitted
page. The `/m/[id]` route resolves incoming params: embedded
`__viciSeriesId` (guarded for staleness against the param) → bare-id param
→ catalog match on the `~id8` suffix (covers markets newer than the last
deploy); unresolvable params land on the markets board.

## Non-obvious constraints

- **The script must run on every hosting deploy.** `hosting deploy --prune`
  deletes assets missing from `build/` — a deploy without the SEO step wipes
  every previously deployed market page and the sitemap. This is why the
  script _hard-fails_ (failing the deploy) on registry errors, zero visible
  markets, or an `app.html` head tag its patterns no longer match.
- **`app.html` head tags are a contract.** The script rewrites them by
  pattern; rename/restructure them only together with the patterns in the
  script (it fails loudly when they drift, see the comment in `app.html`).
- **The reveal gate is shared, not replicated.** Visibility calls the same
  `isMarketRevealed` from `#lib/utils/wc-schedule.utils.ts` that gates the FE
  feed: a series with a future on-chain `start_ns` stays hidden from the
  emitted pages and sitemap, whatever its tags. No Juno access and no
  committed deck files needed — decks are operational/ephemeral inputs to
  the deploy scripts, never read by the SEO generator. An unrevealed
  market's question must never appear in the emitted pages or sitemap —
  that would leak it before its release.
- **Client rendering is unchanged.** The injected pages are byte-identical
  to the shell apart from head tags; the SPA hydrates them like any other
  entry URL. Per-market head content is English (registry `title` /
  `description.plain`), matching the detail page's `<svelte:head>` title
  shape (`{title} | Vici Social Markets`).
- **File count is the binding budget — keep it to ONE page per market.**
  Every emitted file is staged, committed and deleted again per deploy, and
  the satellite recomputes the asset certification tree across all assets
  on bulk operations (junobuild/juno#2263). Deleting ~6k staged assets blew
  the IC's 40B-instruction message limit on the v1.8.14 deploy (change
  applied, cleanup failed → red CI + ~94 MB of orphaned staged assets on
  the prod satellite). The pre-SEO ~3k-file baseline is the proven-safe
  zone; do not add per-market page variants without checking this budget.
- **The deploy signs with a throwaway keypair, and must keep doing so.**
  Clearing's settlement queries (`list_settled_series`,
  `get_settlement_status`) reject the anonymous principal with IC0406
  `Anonymous caller not authorised`, while accepting **any** authenticated
  one — the guard is a spam gate, not an authorisation check, and both
  endpoints return public information. The script therefore builds its
  `HttpAgent` with an ephemeral `Ed25519KeyIdentity.generate()`: no key to
  store, rotate, or grant. Dropping back to an anonymous agent does not fail
  the deploy — it silently degrades every market to "unresolved" (see the
  soft-dependency contract below), which is the failure mode to watch for if
  resolved pages ever stop carrying outcomes.
- The script skips itself under `JUNO_EMULATOR=true` (E2E deploys have no
  mainnet registry to read).

## Structured data & live odds

The generator emits two extra signals on top of the per-market head
rewrite. **No dedicated category/topic pages** — search intent lands on
existing surfaces (a specific market → its detail page; category browsing
→ the in-app `/app` board), not a new page.

- **JSON-LD.** [`src/app.html`](../../../src/app.html) carries a static
  `Organization` + `WebSite` `@graph` on every page. The generator injects
  an additional per-market block before `</head>`: `WebPage` +
  `BreadcrumbList`. `jsonLdScript` escapes `</` so a value can never close
  the `<script>` early. (No `SearchAction` — a sitelinks search box needs a
  working in-app search endpoint, which is dead code today.)
- **Live odds in the snippet.** Per-market descriptions gain a
  `Community odds: Yes N%` sentence, read at deploy time from the clearing
  canister's order book (`list_orders`) and folded through a
  `midYesProbability` helper that mirrors `calculateProbability` in
  `#lib/utils/market.utils.ts`. Reads run with bounded concurrency
  (`ODDS_CONCURRENCY`). All figures are a **snapshot as of deploy** — there
  is no SSR, so they age until the next deploy.
- **Resolved markets are answer pages, not stale trading pages.** The vast
  majority of the SEO surface is settled (1062 of 1094 pages at the time of
  writing) — an event's search demand peaks _after_ it resolves, so this is
  the traffic that matters. A settled market's book is empty, so the
  open-market treatment would advertise "Live community odds" over nothing
  and read identically to an untraded market. Instead the outcome goes into
  the `<title>` (`{question} — Resolved: YES`, falling back to
  `{question} — Resolved` when the winner can't be named), the **head** of
  the meta description (search engines truncate around 160 chars and the
  registry
  blurb alone can fill that, so the answer takes the one slot guaranteed to
  survive), and the JSON-LD keywords (result/resolved intent instead of
  odds/forecast). Resolution comes from clearing — `list_settled_series` for
  the id set, `get_settlement_status` + `settlementInputOutcome` for the
  winner — so a market is "resolved" here on exactly the same rule the
  detail page uses. Settled markets are read for their outcome _instead of_
  their odds, not in addition.
- **No `$` traded-volume in the snippet — rejected on the figure, not on
  access.** `list_series_traded_volumes` is readable at deploy time: it
  carries the same spam gate as the settlement queries (anonymous rejected,
  the ephemeral keypair accepted), so the earlier "anonymous-guarded, needs
  a controller identity" reasoning is wrong — do not re-derive the feature
  from it. Two things the access question doesn't touch keep it out. The
  figure is **`ViciXp` notional, not dollars** (every series is
  `balance_domain = ViciXp`; `formatVolume` renders it as `N VXP` and the
  UI never prints a `$` on it), so baking "$X traded" into meta would state
  something false on a public page. And the amounts are too thin to earn
  the space: across the 1167 emitted pages on 2026-07-27, 40% had zero
  volume, the median was ~46 VXP and the median `trade_count` was **1**
  (open markets: 74% zero). Revisit only if a real-money balance domain
  ships or per-market depth grows — not on access grounds.
- **Clearing is a soft dependency throughout** (unlike the registry read,
  which is fatal). An odds error degrades to "no odds clause"; a
  settled-series error degrades to "everything unresolved" (today's
  pre-resolution behaviour); a per-market settlement error degrades to
  "resolved, winner unnamed". A non-canonical settlement price also yields
  an unnamed winner by design — `binaryPayoffLabel` refuses to call a
  mid-market settlement for a side, so the page says the market resolved
  without inventing an outcome. The deploy log reports both counts.

The phrase **"prediction market"** lives only in this crawler-facing layer
(`<title>` / meta description / JSON-LD keywords) — never in the rendered
UI, which keeps saying "Social Markets".

## Guest Flow funnel from a market page

A signed-out visitor landing on a market detail page (`/markets/[id]`,
where `/m/{slug}` resolves) can't predict there — direct trading is
build-flag-off (`MARKET_DETAIL_DIRECT_TRADE_ENABLED`) and predictions are
placed in Flow. So a **live** market closes with a "Try Flow free" CTA
(`onTryFlow`) that starts a free guest session (`startGuestSession`, the
same no-account preview the onboarding Skip path uses) and routes to
`/flow` — the `(app)` gate already exempts a guest there. Signed-in
members see "Predict in Flow" and skip the guest step. This turns search
traffic into a try-it funnel without a new page.
