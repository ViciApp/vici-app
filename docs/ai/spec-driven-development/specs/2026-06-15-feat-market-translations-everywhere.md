# Spec: Translate market metadata everywhere, with a global language preference and a per-item quick toggle

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`. It is the **fast-follow**
explicitly deferred by `2026-06-14-feat-market-translation-display.md`
(#883), which shipped translated metadata + a toggle on the market
**detail page only**.

Status: Implemented (#1079)

Shipped in two waves: discovery surfaces (#905) and the personal
post-prediction surfaces: portfolio / dash / inbox / wallet /
calibration (#1079). The Arena feed and FlowArt title are out of scope
(see below).

## Goal

A reader whose locale has a stored market translation sees markets in
their own language **everywhere**: list rows, market cards, the Flow
deck (front + back), the trade modal, and share text, not just the
detail page. The default is governed by **one global preference**
("show markets translated" vs "always show the original language"),
surfaced as a setting. On top of that default, every card and the
detail page carry a small **quick switch** to flip that one item
between translated and original without changing the global default.

This closes the user-visible gap: today only `markets/[id]` is
translated and the toggle is per-market with no global setting, so
every other surface renders raw English.

## Context

The data already exists end-to-end: **no new translation content and
no schema/write-path change is needed.** Translations were seeded for
the deck-2026 markets across all live locales (#873, bulk tooling
#707) and are writable by creators/admins (#876).

What exists today:

- Storage: `Collection.MARKET_TRANSLATIONS`
  (`src/lib/constants/collections.constants.ts`), key
  `${seriesId}__${locale}`, one doc per `live` locale per market.
- Shape: `MarketTranslationSchema`
  (`src/lib/schema/market-translation.schema.ts`): `title`,
  `description`, `resolution`, `outcomes: { id, title }[]`.
- Read services (per-series only):
  `src/lib/services/market-translation.services.ts`: `getMarketTranslation`,
  `listMarketTranslations(seriesId)`.
- Satellite queries: `getMarketTranslation`, `listMarketTranslations`
  in `src/satellite/index.ts` (332–348), backed by
  `src/satellite/services/market-translation.services.ts`.
- Pure resolver (reuse as-is): `resolveMarketTranslation({ translations, locale })`
  in `src/lib/utils/market-translation.utils.ts`: walks
  `localeFallbackChain(locale)`, gated on `SUPPORTED_LOCALES`, returns
  `undefined` when the chain resolves only to `en`.
- Detail toggle (reuse / generalise):
  `src/lib/components/market/MarketTranslationToggle.svelte`.
- Active locale: `localeStore` (`src/lib/stores/locale.store.ts`).
- Analytics event already defined: `market_translation_toggled`
  (`label ∈ { original, translated }`): TS union + Zod mirror +
  generated declarations all carry it.

Untranslated display surfaces (the gap to close), all rendering raw
`market.title` / `market.description` / `market.resolution`:

- `src/lib/components/market/MarketCard.svelte` (title, description)
- `src/lib/components/market/MarketsListRow.svelte` (title)
- `src/lib/components/market/MarketsFeaturedCard.svelte` (title)
- `src/lib/components/market/FlowCard.svelte` (title; description drives
  the subtitle logic)
- `src/lib/components/market/FlowBackMeta.svelte` (title)
- `src/lib/components/market/FlowResolutionBlock.svelte` (resolution)
- `src/lib/components/market/TradeModal.svelte` (title)
- `src/lib/components/market/SharePopover.svelte` (title in share text)
- Categorical **outcomes** (`outcome.title`) on the detail page
  (`CategoricalProbabilities.svelte`): stored but never rendered
  translated; in scope now that we touch the display layer.

The N+1 problem the original spec called out: rendering a list/deck
must not fire one `listMarketTranslations(seriesId)` per card. This
spec adds a single bulk read keyed by the visible series ids.

Client-preference pattern to mirror: `src/lib/stores/theme.store.ts`
(localStorage-backed writable, `storage`-event multi-tab sync). The
`BattlesInboxPage` comment and #883 both note that adding a field to
the satellite `preferences` schema requires a Candid + Rust binding
regen; consistent with those deferrals, the global market-language
preference is **client-persisted** (localStorage, identity-agnostic
like theme), with cross-device sync deferred.

## Scope

### 1. Bulk translation read (satellite + service)

New satellite query + FE service to fetch translations for many
markets in one call, for a set of candidate locales (the reader's
fallback chain):

- Satellite: `listMarketTranslationsForLocales({ seriesIds: string[], locales: string[] })`
  in `src/satellite/services/market-translation.services.ts` +
  `src/satellite/index.ts`. Returns the matching `MarketTranslation`
  docs (any `(seriesId, locale)` in the cartesian set that exists).
  Bound the input (e.g. ≤ 200 series ids per call) and `log()`-document
  any cap so a large deck can't issue an unbounded read.
- FE service `listMarketTranslationsForLocales` in
  `src/lib/services/market-translation.services.ts`.
- The FE resolves best-per-series with the existing
  `resolveMarketTranslation` against the returned docs: server stays a
  dumb filter, the fallback policy lives in one place.

### 2. Global market-language preference (store + setting)

- New `src/lib/stores/market-language.store.ts` modelled on
  `theme.store.ts`: `type MarketLanguagePreference = 'translated' | 'original'`,
  default `'translated'`, localStorage key `vici.market-language.v1`,
  `storage`-event multi-tab sync.
- Settings UI: a row in `SettingsPage.svelte` (under the existing
  language/appearance grouping, see `LocalePicker` placement) labeled
  e.g. "Show markets in your language" with the `Switch` component
  (`src/lib/components/ui/Switch.svelte`); off = always original.
- Copy lands in **all** live catalogs (`en` authoritative;
  `check:i18n` enforces parity) under `settings.market_language.*`.

### 3. Bulk-hydrated translations store

- New `src/lib/stores/market-translations.store.ts`: a `SvelteMap`
  keyed by `seriesId` → resolved `MarketTranslation | undefined` for
  the **active** locale, plus a `hydrate(seriesIds)` that fans the
  visible ids into the bulk read and a clear-on-locale-change effect
  (re-resolve when `$localeStore` changes).
- List/deck owners call `hydrate(visibleSeriesIds)` when their data
  loads (markets list page, Flow deck prepare, featured row).

### 4. Shared display helper

- New pure `marketDisplayText({ market, translation, showOriginal })`
  in `src/lib/utils/market-translation.utils.ts` returning
  `{ title, description, resolution, outcomeTitle(id) }`, where each
  field is `showOriginal ? original : (translation?.field ?? original)`.
  Every surface routes its rendered strings through this: no ad-hoc
  `?.title ?? market.title` scattered per component.

### 5. Per-item quick toggle

- Generalise `MarketTranslationToggle.svelte` into a compact variant
  usable on cards (icon/short-label form) and keep the existing inline
  form for the detail page. Shown **only** when a translation exists
  for the item.
- Each card/the detail page holds a local `showOriginal` that
  **defaults from the global preference** (`'original'` → `true`) and
  can be flipped per item (ephemeral, not persisted). The detail page's
  existing `showOriginal` (reset-per-market) now seeds from the global
  preference instead of always `false`.

### 6. Apply across surfaces

Wire `marketDisplayText` (and the quick toggle where a card has room)
into every surface listed in **Context**, including translated
`outcome.title` in `CategoricalProbabilities.svelte` and translated
share text in `SharePopover.svelte`.

### Out of scope

- Any change to the translation **write path**, schema, or the
  admin/creator editor (`MetadataTranslationsTab`).
- Cross-device sync of the global preference (client-persisted only,
  matching theme, deferred until the satellite `preferences` schema
  can absorb a binding regen).
- The editorial `subtitle` / `whyNow` metadata fields (not part of
  `MarketTranslationSchema`).
- Translating market **search** matching against translated text
  (search still matches the original): call out as a follow-up.

## Linked issues

No open issue matches; this is the fast-follow named in
`2026-06-14-feat-market-translation-display.md`. New feature, no
closing keyword.

## Analytics

- Reuse the existing `market_translation_toggled` for per-item quick
  toggles (`label ∈ { original, translated }`, `marketId`). Add the
  surface via the existing `source` prop (e.g. `card`, `deck`,
  `detail`): no new event name, no declarations regen.
- One new event for the global setting flip is optional; if added, it
  is a Candid `variant` value → follow
  `reference_analytics_event_is_candid_variant` (regen, don't
  hand-edit; `npm install` first). Recommend **deferring** it to avoid
  a declarations regen in this PR unless product wants the metric.

## Implementation outline

1. Satellite: add `listMarketTranslationsForLocales` service + query;
   regenerate bindings per `docs/ai/satellite/` and
   `feedback_juno_bindings_regen` (`npm install` first, then
   `npm run juno:functions:build`, then `prettier --write` the
   generated files; revert incidental `package-lock.json` drift).
   Commit the regenerated `.did` / declarations in this PR.
2. FE service `listMarketTranslationsForLocales`.
3. `market-language.store.ts` (global preference) + Settings row +
   `settings.market_language.*` i18n in all live catalogs.
4. `market-translations.store.ts` (bulk hydrate + locale re-resolve).
5. `marketDisplayText` util.
6. Generalise `MarketTranslationToggle` (compact + inline variants);
   seed `showOriginal` from the global preference.
7. Wire every surface in **Context** through `marketDisplayText`;
   hydrate the store from the list/deck/featured owners; render the
   compact toggle where space allows; translate outcomes + share text.
8. Update `docs/ai/PRODUCT.md` (market display behaviour) in the same PR.

## Acceptance criteria

- [ ] With the global preference = translated (default) and a stored
      translation for the resolved locale, **list rows, market cards,
      the Flow deck (front + back), the trade modal, and share text**
      all render translated title/description/resolution.
- [ ] Categorical outcome labels render translated on the detail page.
- [ ] The Settings toggle flips the global default to original; with it
      off, every surface shows the on-chain original by default.
- [ ] Each card and the detail page show a compact quick switch **only**
      when a translation exists; flipping it changes that one item and
      does not change the global preference or other items.
- [ ] Rendering a list/deck of N markets issues **one** bulk translation
      read, not N per-card reads.
- [ ] Changing the app locale re-resolves all visible translations.
- [ ] `market_translation_toggled` fires with `marketId` + `label`
      (+ `source`) on each quick-switch flip.
- [ ] `npm run quality`, `npm run check`, and (satellite touched)
      `npm run juno:functions:build` all pass; `check:i18n` green;
      regenerated bindings committed.

## Decisions

- **Global preference is client-persisted** (localStorage, like theme),
  not a satellite `preferences` field, avoids a Candid + Rust binding
  regen and matches the existing deferral noted in #883 and the Battles
  inbox. Cross-device sync is a later, separate change.
- **Server stays a dumb filter; fallback policy stays in
  `resolveMarketTranslation`.** The bulk endpoint returns raw matching
  docs for the candidate locales; the FE resolves best-per-series, so
  the fallback chain lives in exactly one place (shared with the detail
  page).
- **One shared `marketDisplayText` helper** rather than per-component
  `?? original` fallbacks: one place defines "translated unless
  toggled to original," keeping the eight surfaces consistent.
- **Reuse `market_translation_toggled` with `source`** for per-item
  toggles; defer a new setting-change event to avoid a declarations
  regen unless product asks for the metric.
- **If this exceeds one reviewable PR**, split the _spec_ (per the
  workflow's one-spec-one-PR rule) along surfaces, e.g. (A) bulk read
  - global preference + list/cards/featured/detail-default; (B) Flow
    deck + outcomes + trade modal + share, each with its own status and
    PR. Authored as one spec because the bulk-read + preference + helper
    are the shared foundation every surface depends on.

## Follow-up wave: personal / post-prediction surfaces

#905 closed the **discovery** surfaces (cards, list rows, featured deck,
Flow front + back, trade modal, share, detail). The surfaces that name a
market the reader has **already predicted on** were still rendering the
on-chain original. This wave routes them through the same overlay so the
reader sees their own language everywhere except the admin resolution
surface (operators read canonical text by design).

### What this wave adds

- **Global translated-markets store.** `displayMarkets`: a `derived` in
  `market-translations.store.ts` over `(markets, resolved overlay, global
preference)` keyed by `id`, mirroring `marketById`, where each market's
  `title` / `description` / `resolution` / `outcome.title` are swapped to
  the active-locale translation (every other field is the untouched
  canonical value, so it's safe for the math / inference helpers too).
  When the preference is `original`, or a market has no translation, the
  canonical object is returned by reference. **The canonical `markets`
  store stays the source of truth**: consumers that MUST show the
  original (admin, the WC-art template key, search) keep reading it.
- **Surfaces just repoint their market lookup** to `displayMarkets` and
  keep their plain `market.title` / `outcome.title` rendering: no
  per-component merge:
  - Portfolio (`PortfolioPage` `getMarketById`, `OpenOrdersTable` via a
    translated `markets` prop), Dashboard (`DashPage` `marketById` + the
    Day-0/1 starter list), the away-digest + settled notifications
    (`inbox.store` `settledInboxStore` / `maturedResolutions`), wallet
    (`WalletHistory`, `WalletPage` recent activity), `DashTransactionsPage`.
  - `CalibrationScreen` keeps the per-item `marketDisplay` resolver
    because its deck comes from `getCalibrationDeck()`, not the `markets`
    catalog (so it isn't in `displayMarkets` / auto-hydrated).
- **Central hydration.** A single subscription in the store hydrates the
  whole `markets` catalog (chunked bulk read, gated on genuinely-new
  `(locale, id)` pairs, skipped for English), so no surface triggers its
  own fetch and no surface can feed its translated output back into a
  hydrate trigger.
- `marketDisplay` (the per-item resolver) stays for the toggle surfaces
  (cards / detail, #905) and `CalibrationScreen`; `MarketDisplayOriginal`
  is exported from the util for its param type.
- These list-style surfaces honour the **global preference** only: no
  per-item quick toggle (no room in a row / notification / digest line).

### Deliberately excluded

- **Admin resolution surfaces** (`AdminResolution*`,
  `MarketResolutionInterface`, `AdminMarketForm`): operators must read
  the canonical on-chain text.
- **`FlowArtFrame` `title`**: passed to the WC art renderer as a
  template-matching key against the English catalogue, **not** display
  text; translating it would mis-select artwork. Left as the original.
- **Arena friend-activity feed** (`ActivityFeed` / `ActivityItem`).
  Its rows are denormalised, **composed, hard-coded-English** strings
  (`"Market created: {title}"`, `"Market Resolved: {outcome}"`) written
  at log time: not bare market titles, and not localised at all.
  Translating only the embedded name would read inconsistently; doing it
  properly needs a precursor refactor (log `marketId` + compose localised
  strings at render). Tracked as a separate follow-up.
