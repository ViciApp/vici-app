# i18n Coverage: Triage

Generated 2026-05-23, file list refreshed 2026-11-26. Source of truth:
components under `src/lib/components/` and `src/routes/` that do
**not** import `#lib/utils/i18n.utils.ts`.

This file is a triage worksheet, not gospel. Verify each row when you
touch it. When a row is paid down, delete it. Once a file imports
`i18n.utils`, `local-rules/no-bare-svelte-text` checks it: the rule is a
`warn` in [`eslint.config.js`](../../../eslint.config.js), and `npm run lint`
runs ESLint with `--max-warnings 0`, so a hit already fails CI.

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

## Untranslated: needs review

Likely have hardcoded copy, not yet verified. Check the template, then
translate the file and delete its row, or move the row to § Exempt.

- `src/lib/components/arena/RankedRow.svelte`
- `src/lib/components/authn/Authn.svelte`
- `src/lib/components/authn/LoginRequired.svelte`
- `src/lib/components/authn/SignInActions.svelte`
- `src/lib/components/claim/MigrationBanner.svelte`
- `src/lib/components/dash/DashCallRow.svelte`
- `src/lib/components/dev/TweaksPanel.svelte`
- `src/lib/components/layout/ScreenHeader.svelte`
- `src/lib/components/leagues/LeagueCtaCard.svelte`
- `src/lib/components/market/ConsensusCompass.svelte`
- `src/lib/components/market/FlowCallSize.svelte`
- `src/lib/components/market/MarketArtwork.svelte`
- `src/lib/components/market/MarketDetailSkeleton.svelte`
- `src/lib/components/market/MarketsCarousel.svelte`
- `src/lib/components/menagerie/MenagerieBadgeSkeleton.svelte`
- `src/lib/components/menagerie/MenagerieCelebrationHost.svelte`
- `src/lib/components/menagerie/MenagerieSprite.svelte`
- `src/lib/components/pages/WelcomePage.svelte`
- `src/lib/components/profile/Avatar.svelte`
- `src/lib/components/ui/CountUp.svelte`
- `src/lib/components/ui/CountryFlag.svelte`
- `src/lib/components/ui/NestedButton.svelte`
- `src/lib/components/ui/ProbBar.svelte`
- `src/lib/components/ui/SeededAvatarStack.svelte`
- `src/lib/components/ui/SheetFooter.svelte`
- `src/lib/components/ui/ViciAvatar.svelte`
- `src/lib/components/wallet/PlaygroundVxpAutoDeposit.svelte`

Routes (thin wrappers around `<XxxPage>` components, usually no copy
of their own, but check `<svelte:head>` and meta):

- `src/routes/(app)/admin/+page.svelte`
- `src/routes/(app)/admin/access/+page.svelte`
- `src/routes/(app)/admin/markets/+page.svelte`
- `src/routes/(app)/admin/resolutions/+page.svelte`
- `src/routes/(app)/admin/vxp/+page.svelte`
- `src/routes/(app)/arena/+page.svelte`
- `src/routes/(app)/arena/battles/+page.svelte`
- `src/routes/(app)/arena/battles/[id]/+page.svelte`
- `src/routes/(app)/arena/leaderboard/+page.svelte`
- `src/routes/(app)/arena/leagues/+page.svelte`
- `src/routes/(app)/arena/leagues/[id]/+page.svelte`
- `src/routes/(app)/arena/tournament/+page.svelte`
- `src/routes/(app)/arena/worlds/+page.svelte`
- `src/routes/(app)/arena/worlds/countries/+page.svelte`
- `src/routes/(app)/arena/worlds/country/[id]/+page.svelte`
- `src/routes/(app)/arena/worlds/school/[id]/+page.svelte`
- `src/routes/(app)/arena/worlds/schools/+page.svelte`
- `src/routes/(app)/dash/+page.svelte`
- `src/routes/(app)/dash/transactions/+page.svelte`
- `src/routes/(app)/markets/+page.svelte`
- `src/routes/(app)/notifications/+page.svelte`
- `src/routes/(app)/portfolio/+page.svelte`
- `src/routes/(app)/profile/+page.svelte`
- `src/routes/(app)/profile/album/+page.svelte`
- `src/routes/(app)/settings/+page.svelte`
- `src/routes/(app)/settings/account/+page.svelte`
- `src/routes/(app)/wallet/+page.svelte`
- `src/routes/about/+page.svelte`
- `src/routes/claim/+page.svelte`
- `src/routes/i/[code]/+page.svelte`
- `src/routes/join/[code]/+page.svelte`
- `src/routes/m/[id]/+page.svelte`
- `src/routes/welcome/+page.svelte`

## Exempt: no user-visible text

These render only icons, SVG, layout primitives, or delegate every
piece of copy to their consumer via props/snippets. They do not need
to import `i18n.utils`.

**Icons / characters / artwork**: SVG only:

- `src/lib/components/artwork/FlowArtFrame.svelte`
- `src/lib/components/characters/FlameChar.svelte`
- `src/lib/components/characters/OracleChar.svelte`
- `src/lib/components/characters/StreakFlame.svelte`
- `src/lib/components/characters/TricksterChar.svelte`
- `src/lib/components/characters/ViciChar.svelte`
- `src/lib/components/icons/IconApple.svelte`
- `src/lib/components/icons/IconFacebook.svelte`
- `src/lib/components/icons/IconGoogle.svelte`
- `src/lib/components/icons/IconIC.svelte`
- `src/lib/components/icons/IconInstagram.svelte`
- `src/lib/components/icons/IconPasskey.svelte`
- `src/lib/components/icons/IconRobot.svelte`
- `src/lib/components/icons/IconSnapchat.svelte`
- `src/lib/components/icons/IconTelegram.svelte`
- `src/lib/components/icons/IconTikTok.svelte`
- `src/lib/components/icons/IconWhatsApp.svelte`
- `src/lib/components/icons/IconX.svelte`

**Loaders**: no UI of their own; everything is delegated to children
or stores:

- `src/lib/components/loaders/AtomicLoader.svelte`
- `src/lib/components/loaders/CachedLoader.svelte`
- `src/lib/components/loaders/DomainCachedLoader.svelte`
- `src/lib/components/loaders/IdentityAwareLoader.svelte`
- `src/lib/components/loaders/LoaderBalances.svelte`
- `src/lib/components/loaders/LoaderCollaterals.svelte`
- `src/lib/components/loaders/LoaderFollowing.svelte`
- `src/lib/components/loaders/LoaderLeaderboard.svelte`
- `src/lib/components/loaders/LoaderMarketMetadata.svelte`
- `src/lib/components/loaders/LoaderMarketTags.svelte`
- `src/lib/components/loaders/LoaderMarkets.svelte`
- `src/lib/components/loaders/LoaderOrders.svelte`
- `src/lib/components/loaders/LoaderPositions.svelte`
- `src/lib/components/loaders/LoaderReceivedReactions.svelte`
- `src/lib/components/loaders/LoaderTradeHistory.svelte`
- `src/lib/components/loaders/Loaders.svelte`

**UI primitives**: generic shells; consumers supply copy via props /
snippets:

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
- `src/lib/components/ui/PrincipalText.svelte` (formatted principal: code-shaped, not translated)
- `src/lib/components/ui/Tabs.svelte` (consumers pass localized `label`s)

**Settings primitives**: row shells; labels supplied by consumers:

- `src/lib/components/settings/SetRow.svelte`
- `src/lib/components/settings/SetSegmented.svelte`
- `src/lib/components/settings/SetToggle.svelte`
- `src/lib/components/settings/SettingsSection.svelte`
