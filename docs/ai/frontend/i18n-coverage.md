# i18n Coverage — Triage

Generated 2026-05-23. Source of truth: components under
`src/lib/components/` and `src/routes/` that do **not** import
`#lib/utils/i18n.utils.ts`.

This file is a triage worksheet, not gospel. Verify each row when you
touch it. When a row is paid down, delete it. When the file is empty,
promote `local-rules/no-bare-svelte-text` from `warn` to `error` in
[`eslint.config.js`](../../../eslint.config.js).

> Higher-level contract: [`i18n.md`](./i18n.md).

## How to use this list

For each entry below:

1. Read the file.
2. If it has **no** user-visible text (pure SVG, layout primitive that
   defers all copy to props, loader with no UI of its own, dev-only
   panel that ships behind a flag): move the row into _§ Exempt_ below
   and add a one-line reason.
3. If it has hardcoded text: translate it.
   - Import `t` from `#lib/utils/i18n.utils` and `localeStore` from
     `#lib/stores/locale.store.ts`.
   - Add the keys to **every** catalog under
     `src/lib/constants/messages/` (see [`i18n.md`](./i18n.md)).
   - Run `npm run check:i18n` and `npm run lint`.
   - Delete the row.

## Untranslated — needs work

Verified examples (sampled): each of these has at least one hardcoded
user-visible string in the template.

- `src/lib/components/social/ActivityFeed.svelte` — `"Friend Activity"`, `"Recent Activity"`, `"Refresh"`, `"No activity found."`.

## Untranslated — needs review

Likely have hardcoded copy, not yet verified. Check the template, then
move to one of the other sections.

- `src/lib/components/authn/Authn.svelte`
- `src/lib/components/authn/LoginRequired.svelte`
- `src/lib/components/authn/SignIn.svelte`
- `src/lib/components/authn/SignInDev.svelte`
- `src/lib/components/authn/SignInModal.svelte`
- `src/lib/components/dev/TweaksPanel.svelte`
- `src/lib/components/landing/LandingSectionHeader.svelte`
- `src/lib/components/market/BinaryProbabilities.svelte`
- `src/lib/components/market/CategoricalProbabilities.svelte`
- `src/lib/components/market/MarketCardSkeleton.svelte`
- `src/lib/components/market/MarketDepthPanel.svelte`
- `src/lib/components/portfolio/PositionArtThumb.svelte`
- `src/lib/components/profile/Avatar.svelte`
- `src/lib/components/social/ActivityItem.svelte`
- `src/lib/components/wallet/PlaygroundVxpAutoDeposit.svelte`

Routes (thin wrappers around `<XxxPage>` components — usually no copy
of their own, but check `<svelte:head>` and meta):

- `src/routes/(app)/friends/+page.svelte`
- `src/routes/(app)/social/+page.svelte`
- `src/routes/(app)/notifications/+page.svelte`
- `src/routes/(app)/portfolio/+page.svelte`
- `src/routes/(app)/profile/+page.svelte`
- `src/routes/(app)/settings/+page.svelte`
- `src/routes/(app)/wallet/+page.svelte`
- `src/routes/signin/+page.svelte`
- `src/routes/signup/+page.svelte`
- `src/routes/welcome/+page.svelte`

## Exempt — no user-visible text

These render only icons, SVG, layout primitives, or delegate every
piece of copy to their consumer via props/snippets. They do not need
to import `i18n.utils`.

**Icons / characters / artwork** — SVG only:

- `src/lib/components/artwork/FlowArtFrame.svelte`
- `src/lib/components/characters/FlameChar.svelte`
- `src/lib/components/characters/OracleChar.svelte`
- `src/lib/components/characters/TricksterChar.svelte`
- `src/lib/components/characters/ViciChar.svelte`
- `src/lib/components/icons/IconGoogle.svelte`
- `src/lib/components/icons/IconIC.svelte`
- `src/lib/components/icons/IconLaurel.svelte`
- `src/lib/components/icons/IconPasskey.svelte`
- `src/lib/components/icons/IconRobot.svelte`
- `src/lib/components/icons/IconSignalHold.svelte`
- `src/lib/components/icons/IconSignalNo.svelte`
- `src/lib/components/icons/IconSignalYes.svelte`
- `src/lib/components/icons/IconStreakFlame.svelte`
- `src/lib/components/icons/IconXpChevron.svelte`
- `src/lib/components/layout/Background.svelte`
- `src/lib/components/layout/Logo.svelte`

**Loaders** — no UI of their own; everything is delegated to children
or stores:

- `src/lib/components/loaders/AtomicLoader.svelte`
- `src/lib/components/loaders/CachedLoader.svelte`
- `src/lib/components/loaders/DomainCachedLoader.svelte`
- `src/lib/components/loaders/IdentityAwareLoader.svelte`
- `src/lib/components/loaders/LoaderBalances.svelte`
- `src/lib/components/loaders/LoaderCollaterals.svelte`
- `src/lib/components/loaders/LoaderFollowing.svelte`
- `src/lib/components/loaders/LoaderGlobalActivities.svelte`
- `src/lib/components/loaders/LoaderLeaderboard.svelte`
- `src/lib/components/loaders/LoaderMarkets.svelte`
- `src/lib/components/loaders/LoaderMarketTags.svelte`
- `src/lib/components/loaders/LoaderOrders.svelte`
- `src/lib/components/loaders/LoaderPositions.svelte`
- `src/lib/components/loaders/LoaderTradeHistory.svelte`
- `src/lib/components/loaders/Loaders.svelte`

**UI primitives** — generic shells; consumers supply copy via props /
snippets:

- `src/lib/components/ui/Backdrop.svelte`
- `src/lib/components/ui/Badge.svelte`
- `src/lib/components/ui/BaseButton.svelte`
- `src/lib/components/ui/Button.svelte`
- `src/lib/components/ui/Card.svelte`
- `src/lib/components/ui/Companion.svelte`
- `src/lib/components/ui/CompanionOverlay.svelte`
- `src/lib/components/ui/CopyableAddress.svelte`
- `src/lib/components/ui/EmptyState.svelte` (`message` prop)
- `src/lib/components/ui/InfiniteScroll.svelte`
- `src/lib/components/ui/LoadingSpinner.svelte`
- `src/lib/components/ui/Notifications.svelte` (renders toasts from `notification.store`)
- `src/lib/components/ui/PopOver.svelte`
- `src/lib/components/ui/PrincipalText.svelte` (formatted principal — code-shaped, not translated)
- `src/lib/components/ui/SectionHeader.svelte` (`title` / `subtitle` props)
- `src/lib/components/ui/StatCard.svelte` (`label` / `value` props)
- `src/lib/components/ui/Tabs.svelte` (consumers pass localized `label`s)

**Settings primitives** — row shells; labels supplied by consumers:

- `src/lib/components/settings/SetRow.svelte`
- `src/lib/components/settings/SetSegmented.svelte`
- `src/lib/components/settings/SetToggle.svelte`
- `src/lib/components/settings/SettingsSection.svelte`
