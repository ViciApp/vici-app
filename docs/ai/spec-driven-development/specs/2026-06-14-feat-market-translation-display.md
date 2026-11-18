# Spec: Display market metadata translations with an original-language toggle

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#883)

## Goal

A reader whose locale has a stored market translation sees the market in
their own language by default on the market detail page: title and
resolution clause. A small, secondary "View original" control lets them
flip the metadata back to the language it was authored in, and back again.
Today these translations are writable by creators/admins (PR #876) but
never shown to anyone.

## Context

Translations already exist end-to-end on the write side:

- Storage: `Collection.MARKET_TRANSLATIONS`
  (`src/lib/constants/collections.constants.ts`), key `${seriesId}__${locale}`,
  one doc per `live` locale per market.
- Shape: `MarketTranslationSchema`
  (`src/lib/schema/market-translation.schema.ts`): `title`, `description`,
  `resolution`, `outcomes: { id, title }[]`, plus `updatedAt` / `updatedBy`.
- Read services (already wired): `getMarketTranslation` and
  `listMarketTranslations` in
  `src/lib/services/market-translation.services.ts`.
- Write-only UI today: `MetadataTranslationsTab.svelte`
  (`src/lib/components/market/metadata/`): admin/creator side-by-side editor.

Display surfaces and helpers to reuse:

- Detail page: `src/routes/(app)/markets/[id]/+page.svelte`:
  `<h1 class="market-detail-title">{market.title}</h1>` (line 563),
  `MarketDetailResolutionCard` (line 637). `contextLine` (line 338) is the
  metadata **subtitle**, not the translatable `description`.
- Resolution clause: `MarketDetailResolutionCard.svelte` renders
  `market.resolution` (`resolutionClause`, line 15).
- Categorical outcomes: `CategoricalProbabilities.svelte` renders
  `outcome.title`.
- Active locale: `localeStore` (`src/lib/stores/locale.store.ts`).
- Fallback resolution: `localeFallbackChain(locale)`
  (`src/lib/constants/locale.constants.ts:427`): itself → registered
  fallbacks → `en`. `SUPPORTED_LOCALES` is the allowlist of `live` locales
  that can carry a stored translation. `DEFAULT_LOCALE` is `en`.
- The admin tab's `onMount` already demonstrates the bulk read +
  per-locale `SvelteMap` cache pattern this spec reuses for read.

## Scope

Market **detail page** only.

1. New pure util `src/lib/utils/market-translation.utils.ts`:
   `resolveMarketTranslation({ translations, locale })` →
   `{ translation, locale } | undefined`. Walks `localeFallbackChain(locale)`,
   returns the first entry that (a) is in `SUPPORTED_LOCALES` and (b) has a
   stored translation. Returns `undefined` when the chain resolves only to
   `en` / no stored match, i.e. nothing to show beyond the original.
2. New component
   `src/lib/components/market/MarketTranslationToggle.svelte`: a small,
   muted inline control. Shown only when a translation is available. States:
   - viewing translated → label `Translated` + secondary button `View original`
   - viewing original → label `Original` + secondary button `View in {language}`
     The original-language affordance is visually smaller/secondary, per the ask.
3. Detail page wiring (`+page.svelte`):
   - On market load, `listMarketTranslations(market.id)` into a `SvelteMap`
     keyed by locale (mirrors the admin tab).
   - `activeTranslation = resolveMarketTranslation(...)` derived from the map
     and `$localeStore`.
   - `showOriginal` local boolean, **reset to `false` when the market id
     changes** (default view is translated).
   - Derive `displayTitle` / `displayResolution` =
     `showOriginal ? original : (activeTranslation?.field ?? original)`.
   - Render `MarketTranslationToggle` beneath the title when
     `activeTranslation` is defined.
4. `MarketDetailResolutionCard.svelte`: add an optional
   `resolution?: string` override prop (falls back to `market.resolution`
   when absent: backward compatible). Detail page passes the displayed clause.

The two translatable fields the detail page actually renders are the
**title** (`<h1>`) and the **resolution clause**. The `description` field
renders only on cards (out of scope), and the detail page does not render a
categorical **outcome** list at all, so outcome-title translation, though
stored, has no display site here and lands with the cards fast-follow.

### Out of scope

- **Market cards / FlowCard** (list + deck). A per-card fetch is an N+1
  across a list; doing it right needs a bulk translation read keyed by the
  visible market ids and a global (not per-card) language preference rather
  than an inline toggle. Deferred to a fast-follow spec. This is why
  `description` translation, which only renders on cards, not on the detail
  page, is also deferred.
- The metadata `subtitle` / `whyNow` editorial fields: not part of
  `MarketTranslationSchema`, not translated here.
- Categorical **outcome** labels: stored in the translation but not rendered
  on the detail page (no outcome list there), so deferred with the cards work.
- Any change to the write path or schema.

## Linked issues

No open issue matches market-translation display (searched open issues for
translation / translate / locale / language). New feature, no closing
keyword.

## Analytics

Instrument one new event.

- `market_translation_toggled`: fired when the reader flips the toggle.
  Props: `marketId`; `label` ∈ `{ 'original', 'translated' }` (bounded;
  `label` already exists in `AnalyticsEventProps`). No locale string sent
  (avoids unbounded-ish vocab and it's derivable from session locale if ever
  needed).
- Add the event name to **both** `src/lib/types/analytics-event.ts` (TS
  union) and `src/lib/schema/analytics-event.schema.ts` (Zod mirror); capture
  via `track` in `src/lib/services/analytics.services.ts`.
- No new event for "viewed a translated market": the existing
  `market_viewed` covers the view; a default-translated render is the norm,
  not a discrete action.

## Design artifacts (frontend)

- [mockup.html](./2026-06-14-feat-market-translation-display/mockup.html):
  detail hero + resolution card, translated and original states, with a
  theme switcher (dark / light / peach) and a "copy instructions" button.

## Implementation outline

1. Add the pure `resolveMarketTranslation` util
   (`src/lib/utils/market-translation.utils.ts`). The repo has no unit-test
   harness today (only Playwright e2e), so correctness is carried by
   svelte-check + the small, pure surface rather than a new unit-test file.
2. Add `market_translation_toggled` to the analytics union + Zod mirror.
3. Build `MarketTranslationToggle.svelte` (props: `translatedLanguageLabel`,
   `showOriginal`, `onToggle`).
4. Wire the detail page: bulk read, derived active translation, `showOriginal`
   reset-per-market, derived display strings (title + resolution), render the
   toggle, `track` on toggle.
5. Thread the optional `resolution` override into
   `MarketDetailResolutionCard.svelte`.
6. Add i18n keys under `market.translation.*` to **all** `live` catalogs
   (`en` authoritative; `check:i18n` enforces parity):
   `viewing_translated`, `view_original`, `viewing_original`, `view_in` (with
   `{language}` param).
7. Update `docs/ai/PRODUCT.md` (market detail behaviour) in the same PR.

## Acceptance criteria

- [ ] On a market with a translation for the reader's resolved locale, the
      detail page shows the translated title and resolution clause by default.
- [ ] A small secondary "View original" control appears only when a
      translation is available; toggling shows the on-chain original and a
      "View in {language}" control to return.
- [ ] A market with no translation for the resolved locale shows the original
      and renders **no** toggle.
- [ ] Navigating to another market resets the view to translated/default;
      changing the app locale re-resolves the active translation.
- [ ] `market_translation_toggled` fires with `marketId` + `label` on each flip.
- [ ] `npm run quality` and `npm run check` pass; `check:i18n` is green (all
      live catalogs carry the new keys).

## Decisions

- **One toggle flips all translatable metadata together** (title +
  resolution), not per-field, confirmed by the reviewer against the mockup.
  Simpler mental model than per-field controls.
- Read via one `listMarketTranslations(marketId)` bulk call rather than a
  per-locale `getMarketTranslation` round-trip walking the fallback chain:
  one query, and it mirrors the existing admin-tab pattern.
- Default to the translated view (the user's stated preference: "we should
  show it"); the original is the smaller, secondary affordance.
- The event name is a Candid `variant` on the analytics endpoint, so the new
  `market_translation_toggled` value was added to the generated declarations
  (`satellite.api.ts`, `satellite.did.d.ts`, `satellite.factory.did.js`,
  `satellite_extension.did`) by hand rather than via a full
  `juno functions build`: the locally-installed CLI regenerates those files
  with thousands of lines of unrelated reordering churn, so a surgical
  one-value addition keeps the diff reviewable. Position in a Candid variant
  is cosmetic (wire identity is the field-name hash).
