# App Design

Working roadmap and rule book for the SvelteKit app's design. This
page is the single source of truth for which surfaces / tokens /
assets exist, which still need work, and the behavioural rules that
govern Flow Mode (§7). Tick rows off as PRs land.

> **Conventions**: any agent or contributor working on the design
> must respect both:
>
> 1. Any commit that adjusts a design surface must update at least
>    one row here in the same commit. When a row reaches "✅ Done"
>    it stays in the table for traceability; it's not deleted.
> 2. **Never reference temporary or external design source materials**
>    (folder names, spec exports, file names, or section numbers
>    from those files) anywhere in the repo (code, comments, commit
>    messages, PR bodies). Temporary scratch is temporary; the
>    product reflects **the** design. When a code comment needs to
>    cite a rule, point at this file (`docs/ai/frontend/design.md`)
>    for surface / Flow / component rules, or
>    [`brand.md`](./brand.md) for brand / voice / palette / type /
>    iconography rules, never at the off-repo brand book by name.
>    Don't qualify the design as "new", "old", "redesigned", or
>    "previous"; there is only one.

The companion guidance lives in:

- [`brand.md`](./brand.md): palette, typography triad, voice & tone,
  iconography, character cast, copy patterns. The brand book lives
  there; this file is the surface roster.
- [`reusability.md`](./reusability.md): extend existing components before
  adding new ones.
- [`stack-and-patterns.md`](./stack-and-patterns.md): Tailwind v4 token
  rules (no `[var(--token)]` arbitrary values; tokens flow through
  `@theme` in [`src/app.css`](../../../src/app.css)).
- [`a11y.md`](./a11y.md): `aria-hidden` on decorative icons, labelled
  inputs, real buttons.

---

## 1. Tokens

The brand palette is already exposed through Tailwind v4 `@theme` in
[`src/app.css`](../../../src/app.css). Most named colours, the laurel
ramp, the YES/NO/HOLD signals, the parchment / ink scale, and the
easing curve are present. Outstanding items:

| Token                                                                                  | App status  | Action                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--shadow-toast`, `--shadow-card`, `--shadow-card-light`                               | ✅ Done     | Exposed in `@theme`. `Notifications.svelte` uses `shadow-toast`. `Card.svelte` default variant uses `shadow-card`, which resolves to `--inset-hi` in dark and `--shadow-card-light` in light.               |
| `--ticker-h: 32px`                                                                     | ✅ Done     | Declared in `:root`; nothing reads it today. The `/welcome` ticker is the `.lpc-ticker` marquee in [`WelcomeProof.svelte`](../../../src/lib/components/landing/WelcomeProof.svelte), which does not use it. |
| Peach theme tokens                                                                     | ✅ Done     | `[data-theme='peach']` defines the warm blush canvas, warm dark foreground, and deeper laurel accent swap.                                                                                                  |
| Named oversize type (`--t-88`, `--t-128`)                                              | ✅ Done     | Available for hand-tuned editorial moments via `var(--t-88)` etc.                                                                                                                                           |
| Z-index scale (`--z-overlay`, `--z-modal`, `--z-dropdown`, `--z-toast`, `--z-tooltip`) | ❓ Implicit | Audit existing modals / popovers; if z-index is inlined per-component, extract to `@theme` once during a primitive pass.                                                                                    |

Three large-radius / edge-spacing surfaces sit just off the standard
scale and are named for the surface they belong to, so call-sites read
the intent rather than a bare literal: `--radius-frame` (18px, elevated
framed surfaces, e.g. the swipeable onboarding card), `--radius-nav`
(28px, the floating bottom-nav pill shell only), and `--spacing-edge`
(20px, the screen-edge horizontal gutter, owned by `ScreenHeader`).
`--text-micro` (10px) is the hard type-size floor for dense data labels:
nothing renders smaller. `--r-xl` is a back-compat alias of
`--radius-frame`.

For spacing, sizing, radii, and most typography use Tailwind v4 utilities
(`p-*`, `gap-*`, `text-*`, `tracking-*`, `leading-*`, `rounded-*`).
Utility classes already exposed in `src/app.css`: `.eyebrow`, `.allcaps`,
`.serif-italic`, `.display`, `.display-num`, `.lede`, `.surface`,
`.surface-elevated`, `.hairline`, `.num`. Add tokens or helpers to
`src/app.css` only when a real consumer needs one.

Card-system primitives in `src/app.css` (use these, don't re-style cards
per surface): `.card-surface` (self-contained tile, `--gap-card` stack,
12px radius, the Markets featured/trending carousel cards), `.card-inline`
(flush list row: transparent, hairline-top separator, used as a `<button>`
in the Markets list; the parent column owns the side padding and uses
`gap: 0`), and `.card-empty` (the **only** dashed-border surface in product;
pairs with `.c-eyebrow` / `.c-title` / `.c-body` for its type ramp).
`.title-action` is the mono uppercase "See all" affordance (its trailing `→`
is appended via `::after`, so pass an arrow-free label). Selection state on
`.chip.active` is parchment-on-elevated (`--bg-popover` / `--text-base` /
`--border-strong`); laurel is reserved as an identity accent, never a
filter/tab selection state.

---

## 1.1 Themes

The app supports three themes through `data-theme` on `<html>`:

| Theme   | Canvas / register                     | Accent rule                                                                |
| ------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `dark`  | Warm near-black, terminal / editorial | `--laurel`                                                                 |
| `light` | Parchment / ink                       | `--laurel`                                                                 |
| `peach` | Warm blush / coral-cream              | `--laurel-deep` (`#B68B1F`) for primary/accent so contrast holds on peach. |

The `peach` theme is **labelled "Coral"** in the UI (`ui.theme.peach`,
localized per locale). The `data-theme="peach"` value and the `Theme`
union keep the internal `peach` name; the rename is display-only.

Theme state lives in
[`src/lib/stores/theme.store.ts`](../../../src/lib/stores/theme.store.ts)
and persists to `localStorage` as `vici-theme`.

The canonical picker is
[`src/lib/components/ui/AppearancePicker.svelte`](../../../src/lib/components/ui/AppearancePicker.svelte).
It renders three swatch tiles as pressed buttons (`aria-pressed`) and
is currently mounted in the user menu and the dev-only Tweaks panel.
When the Settings surface lands, use the same component; do not create
a second picker.

Third-party marks keep their own colours in every theme (see §2).

---

## 2. Brand assets

This section is the in-repo source of truth for the VICI mark, palette,
and asset wiring. The rules below are mirrored from the upstream brand
book; when the two diverge, this file is the one that ships, and the
divergence is a bug to reconcile.

### 2.1 Logo rules

The wordmark is **type-set**, not custom letterforms: Hanken Grotesk
weight 700, ALL CAPS, `letter-spacing: 0.18em`. It travels as text,
which is why the in-product mark in
[`Logo.svelte`](../../../src/lib/components/layout/Logo.svelte) is a
`<span>` and not an SVG.

**Colour variants.** Only two:

| Variant   | Use on         | Token         | Hex       |
| --------- | -------------- | ------------- | --------- |
| Black     | Light surfaces | `--ink`       | `#0E0D0B` |
| Parchment | Dark surfaces  | `--parchment` | `#F2ECDC` |

Pure `#FFFFFF` and pure `#000000` are **not** used; the warm ink and
parchment are part of the brand. The in-product `Logo.svelte` resolves
this automatically via `text-foreground` (`--text-base`), which swaps
parchment → ink between dark and light themes.

**Monogram (V).** Use when the wordmark won't fit: under 24 px tall on
screen, under 12 mm in print. Same colour rules as the wordmark.

**App icon.** Encapsulated mark: gold V on an ink tile, 14 px corner
radius (proportional). **Laurel gold (`#E2B842`) is reserved for the
app-icon tile.** Do not apply it to the wordmark or monogram.

**Clear space & minimum size.**

- Clear space = the height of the **I** stem on all four sides.
- Minimum digital height: 24 px (wordmark) · 16 px (monogram).
- Minimum print height: 12 mm (wordmark) · 8 mm (monogram).

**Don't.**

- Don't italicize, skew, stretch, or rotate the mark.
- Don't apply gradients, glow, drop shadow, or bevel.
- Don't recolour outside Black or Parchment (laurel gold is app-icon-only).
- Don't lock up the mark with a tagline.
- Don't typeset the wordmark with a different font or tracking; Hanken
  Grotesk Bold + 0.18em or use the SVG/PNG files.

### 2.2 Asset wiring

| Asset             | App target                                                                                                                                                                                                               | Status                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark          | [`Logo.svelte`](../../../src/lib/components/layout/Logo.svelte) (type-set, live) · `static/branding/vici-wordmark-{black,parchment}.{svg,png}` (locked artwork for OG / partner / print use)                             | ✅ Done. In-product mark is type-set per §2.1; no SVG, no `drop-shadow`. The static SVG/PNG variants are for surfaces where typesetting isn't possible (link previews, partner assets).             |
| Monogram          | `static/branding/vici-monogram-{black,parchment}.{svg,png}`                                                                                                                                                              | ✅ Done. Wrap in `IconViciMonogram.svelte` if a reusable in-product consumer appears (`≤ 24 px` tall placements per §2.1).                                                                          |
| App icon          | `static/branding/vici-favicon.svg` (favicon) · `vici-favicon-32.png` (legacy favicon) · `vici-favicon-192.png` (PWA / Android home-screen) · `vici-app-icon-{512,1024}.{svg,png}` (master) · `apple-touch-icon.png` 180² | ✅ Done. Wired in [`app.html`](../../../src/app.html) and [`manifest.webmanifest`](../../../static/manifest.webmanifest). Gold V on ink tile per §2.1; `apple-touch-icon.png` is derived from 512². |
| Signal icons      | `IconSignalYes` / `IconSignalNo` (not in the repo)                                                                                                                                                                       | Not built. Add the components when an in-product consumer appears.                                                                                                                                  |
| Streak-flame icon | [`StreakFlame`](../../../src/lib/components/characters/StreakFlame.svelte)                                                                                                                                               | ✅ Done. Distinct from `FlameChar.svelte` (the animated character).                                                                                                                                 |
| Grain texture     | `static/branding/grain.svg`                                                                                                                                                                                              | Static asset only; no in-product consumer today.                                                                                                                                                    |
| Laurel watermark  | `static/branding/laurel-watermark.svg`                                                                                                                                                                                   | ✅ Done.                                                                                                                                                                                            |

When adding bespoke icons, register them in
[`reusability.md`](./reusability.md) so the next agent finds them.

Third-party marks keep their own brand colours. Do not recolour the
Juno footer mark, Internet Computer mark, Google mark, or future Apple
mark with VICI theme tokens. They may sit inside VICI surfaces, but the
SVG paths / fills remain brand-owned.

---

## 3. Characters

Already implemented. **No work needed.**

| Character                                                 | App equivalent                                                                                                                                                                          | Status  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Vici (4 moods)                                            | [`src/lib/components/characters/ViciChar.svelte`](../../../src/lib/components/characters/ViciChar.svelte)                                                                               | ✅ Done |
| Oracle                                                    | [`OracleChar.svelte`](../../../src/lib/components/characters/OracleChar.svelte)                                                                                                         | ✅ Done |
| Trickster (± lightning)                                   | [`TricksterChar.svelte`](../../../src/lib/components/characters/TricksterChar.svelte)                                                                                                   | ✅ Done |
| Flame (5 stages: spark → ember → flame → blaze → inferno) | [`FlameChar.svelte`](../../../src/lib/components/characters/FlameChar.svelte) + [`streak.utils.ts`](../../../src/lib/utils/streak.utils.ts)                                             | ✅ Done |
| Companion message UX                                      | [`Companion.svelte`](../../../src/lib/components/ui/Companion.svelte) + `CompanionOverlay.svelte` + `companion.store`                                                                   | ✅ Done |
| Character idle animations                                 | Registered globally in [`src/app.css`](../../../src/app.css) (`char-bob`, `char-blink`, `char-pulse`, `char-twinkle`, `char-ear`, `char-tail`, `char-bolt`, `char-flicker`, `char-pop`) | ✅ Done |

---

## 4. Components

| Component          | App equivalent (search-first)                                                                             | Status  | Notes                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bottom navigation  | [`src/lib/components/layout/MobileNav.svelte`](../../../src/lib/components/layout/MobileNav.svelte)       | ✅ Done | Translucent theme-aware shell, central Flow button emphasis, `t()` labels via `labelKey`, active cascade for `/markets/*`, `/wallet`, `/settings`, `/notifications`.                                                                                                                 |
| Flow card          | [`src/lib/components/market/FlowCard.svelte`](../../../src/lib/components/market/FlowCard.svelte)         | ✅ Done | Front/back flip, why-now chip, sharp-predictor strip, metadata resolution + sparkline events, user-context block, and card-stack rhythm wired. Sharp-predictor lean still uses available consensus-derived values until a reputation aggregate exists.                               |
| Screen header      | [`src/lib/components/layout/ScreenHeader.svelte`](../../../src/lib/components/layout/ScreenHeader.svelte) | ✅ Done | The single compact 50px top chrome for **every** screen, at all widths (optional `title` in `section` / `editorial` variant, optional `back`, optional `right` snippet, optional `chips` metadata row). Omit `title` for back-only bars whose name lives in an editorial hero below. |
| Ticker             | [`WelcomeProof.svelte`](../../../src/lib/components/landing/WelcomeProof.svelte) (`.lpc-ticker`)          | ✅ Done | Marquee of @handles making calls on `/welcome`; decorative (`aria-hidden`), paused under reduced motion.                                                                                                                                                                             |
| UI primitives      | `#lib/components/ui/{Button,Card,Badge,Dialog,Modal,Tabs,Tooltip,…}.svelte`                               | ✅ Done | Button, Badge, Tabs, Card, Modal, StatCard, and settings primitives use tokenized variants; `Tabs.svelte` supports localized labels while preserving stable values. `AppearancePicker.svelte` remains the canonical theme picker.                                                    |
| Top header / frame | [`DesktopAppNav.svelte`](../../../src/lib/components/layout/DesktopAppNav.svelte) + `MobileNav`           | ✅ Done | Theme-aware translucent desktop nav, pill nav states, `t()` nav + sign-in, same active cascade as bottom nav.                                                                                                                                                                        |
| Characters         | _see §3_                                                                                                  | ✅ Done |                                                                                                                                                                                                                                                                                      |

---

## 5. Screens

| Screen            | App equivalent                                                                                                                                                                  | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow Mode         | [`src/lib/components/market/FlowMode.svelte`](../../../src/lib/components/market/FlowMode.svelte) + [`FlowCard.svelte`](../../../src/lib/components/market/FlowCard.svelte)     | ✅ Done | Swipe deck with brand-aligned typography, generative artwork in-card, top session chrome, footer hint rail, 80 ms commit-feedback beat, named haptic patterns, daily-streak Flame chip, reward ladder, character bubbles (priority-resolved), a cold-load Oracle moment (`FlowEntry`, §7.10), and a brand-voice FlowEnd. Buttons + keyboard shortcuts kept as accessibility fallback. See §7 below for the rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Markets list      | [`MarketsPage.svelte`](../../../src/lib/components/pages/MarketsPage.svelte)                                                                                                    | ✅ Done | Compact editorial discovery list, tab labels, filter chrome, probability blocks, skeletons, and empty state wired through `t()` (EN · IT · ES · DE · FR · PT). WC-focus when `worldCupActive`; see §11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Market detail     | [`/markets/[id]/+page.svelte`](<../../../src/routes/(app)/markets/[id]/+page.svelte>) + `MarketDetail*` modules                                                                 | ✅ Done | Prob hero, chart card, stats grid, resolution card, top-predictors, branded YES/NO signal icons, token colour classes, and decorative icon hiding while preserving trade handlers, order-book polling, and sizing math. Streaming load renders [`MarketDetailSkeleton`](../../../src/lib/components/market/MarketDetailSkeleton.svelte) (module-rhythm pulse blocks) so the layout doesn't reflow. The sticky CTA bar renders **only while `status === 'Open'`**: Expired/Resolved markets suppress the YES/NO actions entirely. Chart-period chips (1d/7d/30d/all) are a visual switch pending the satellite history aggregator (no data re-scope yet).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dashboard         | [`DashPage.svelte`](../../../src/lib/components/pages/DashPage.svelte)                                                                                                          | ✅ Done | `/dash`; performance stats, daily streak, by-category accuracy, holdings, rank context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Portfolio         | [`PortfolioPage.svelte`](../../../src/lib/components/pages/PortfolioPage.svelte)                                                                                                | ✅ Done | `/portfolio`; open and resolved positions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Onboarding        | [`Onboarding.svelte`](../../../src/lib/components/onboarding/Onboarding.svelte)                                                                                                 | ✅ Done | One-screen pre-sign-in flow on `/signup`: claim a handle, then sign up through the provider stack (passkey/OAuth). No team-pick, gestures or categories steps. See §8.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Profile           | [`ProfilePage.svelte`](../../../src/lib/components/pages/ProfilePage.svelte) + `ProfileDashboard.svelte`                                                                        | ✅ Done | Performance identity surface with avatar/handle, archetype, level/XP progress, stats grid, recent activity blocks, achievements, and existing profile edit flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Arena (hub)       | [`ArenaPage.svelte`](../../../src/lib/components/pages/ArenaPage.svelte)                                                                                                        | ✅ Done | `/arena`; tabbed hub (Friends / Leagues / Battles); `ArenaPage` owns the tab layout. Above the tab strip sits the **standing hero** ([`ArenaStandingHero.svelte`](../../../src/lib/components/arena/ArenaStandingHero.svelte)): one swipe-only ~76px rank that pages across the viewer's scopes (Global → Friends → each League → Battle) with tappable scope dots and NO auto-advance (swipe / arrow-keys / dot to switch, tap opens the scope's surface: Global → leaderboard, Friends/Leagues → the matching tab, Battle → `/arena/worlds/school/[id]`). Global leads with a percentile bracket (`Top 1%` / `5%` / `10%` / `25%` / `50%`, rounded UP to the next worse tier; falls back to `#rank of total` below Top 50%); movement reads `▲ {n}` (a percentile-point delta with a `%` suffix for Global). Every scope is real (clearing `getStandings` / `getLeagueStandings` windows for global / friends / per-league rank + `rankDelta`; monthly affiliation-stats order for Battle) and is only added once its rank is known, so it never fabricates a position. Sub-surfaces below.                                                                                                                                                                                                                                      |
| ↳ Leaderboard     | [`LeaderboardPage.svelte`](../../../src/lib/components/pages/LeaderboardPage.svelte)                                                                                            | ✅ Done | `/arena/leaderboard`; Global / Week / Friends / Activity tabs, current-user highlight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ↳ Leagues         | [`LeaguesPage.svelte`](../../../src/lib/components/pages/LeaguesPage.svelte) + [`LeagueDetailPage.svelte`](../../../src/lib/components/pages/LeagueDetailPage.svelte)           | ✅ Done | `/arena/leagues`, `/arena/leagues/[id]`; private cohorts. **League-vs-league battles live only here**: each league detail has its own battle section (active card with accept / kickoff / resolve / retract, or a Challenge-another-league CTA via [`CreateBoutModal`](../../../src/lib/components/leagues/CreateBoutModal.svelte), pinned to this league, on `?challenge=1`/`?propose=1`). League detail folds the roster into the leaderboard: each row is a ≥44px `<button>` (rank · `<Avatar>` · handle · streak · accuracy) that opens a member [`BottomSheet`](../../../src/lib/components/ui/BottomSheet.svelte) (`<Avatar>` + accuracy / streak stat grid). Sticky YOU row stays pinned below the top-6. Under four members the podium is swapped for a `recruit` prompt with an Invite CTA. No settings cog on this surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ↳ Battles         | [`BattlesInboxPage.svelte`](../../../src/lib/components/pages/BattlesInboxPage.svelte) + [`BattleDetailPage.svelte`](../../../src/lib/components/pages/BattleDetailPage.svelte) | ✅ Done | `/arena/battles`, `/arena/battles/[id]`; **institutional + tournament inbox only**: one [`WorldsBattleCard.svelte`](../../../src/lib/components/worlds/WorldsBattleCard.svelte) per roster (Worlds Universities + Worlds Countries), each a single card with a `World Cup ⇄ Season` scope toggle (top-3 podium + your-row + accuracy% re-rank per scope, `Live` badge + `{days}d left`, tap → `/arena/worlds/{schools,countries}?scope=…`), plus the monthly tournament card, the intro card, and a footer link to Leagues. League-vs-league battles are **not** listed here (they live under Leagues, per that row); de-duped so a league battle has one home. Battle is the name end to end: the `battles` collection, `BattleDoc`, and the user-facing copy all match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ↳ Worlds          | [`WorldsPage.svelte`](../../../src/lib/components/pages/WorldsPage.svelte) + affiliation/battle detail                                                                          | ✅ Done | `/arena/worlds/*`; universities & countries, affiliation detail, world-cup battle detail. The Worlds battle surface is presentational framing over the `affiliations` / `affiliation_stats` collections; it does not use the `battles` collection. Affiliation choices live in [`worlds-affiliations.constants.ts`](../../../src/lib/constants/worlds-affiliations.constants.ts): `WORLDS_COUNTRIES` (ISO-2 + emoji flag) and `WORLDS_UNIVERSITIES`: the full ~278-school directory. University entries carry `short`/`glyph`, `country`, `region` (`NA`/`UK`/`EU`/`AS`/`AU`/`LATAM`/`MEA`), QS `rank`, brand `color`/`text`, and verified `domains` (the last reserved for a later membership-verification pass; unused today). The picker ([`AffiliationPickerModal.svelte`](../../../src/lib/components/leagues/AffiliationPickerModal.svelte)) keeps the fuzzy name/acronym search for both kinds; for the university kind it also shows a region-tab row (All · North America · UK · Europe · Asia · AU·NZ; `LATAM`/`MEA` surface only under All or via search) and pins home-country schools (`detectUserCountryCode()`) to the top under a "Near you · N schools" divider when idle. The country picker path is unchanged. Editing the roster drops no live data; the leaderboard reads `affiliation_stats`, not this list. |
| ↳ Tournament      | [`TournamentPage.svelte`](../../../src/lib/components/pages/TournamentPage.svelte)                                                                                              | ✅ Done | `/arena/tournament`; league-vs-league bracket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Wallet            | [`WalletPage.svelte`](../../../src/lib/components/pages/WalletPage.svelte)                                                                                                      | ✅ Done | Treasury section header, wallet stats, collateral stats, send/receive/history tabs, and supporting surfaces use the shared card/chrome language while preserving wallet actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Notifications     | [`NotificationsPage.svelte`](../../../src/lib/components/pages/NotificationsPage.svelte)                                                                                        | ✅ Done | `/notifications`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Settings          | [`SettingsPage.svelte`](../../../src/lib/components/pages/SettingsPage.svelte) + [`AccountSettingsPage.svelte`](../../../src/lib/components/pages/AccountSettingsPage.svelte)   | ✅ Done | `/settings`, `/settings/account`; appearance, flow-deck scope, account/delete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Album             | [`AlbumPage.svelte`](../../../src/lib/components/pages/AlbumPage.svelte)                                                                                                        | ✅ Done | `/profile/album`; full past-calls history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Market resolution | [`MarketResolutionInterface.svelte`](../../../src/lib/components/market/MarketResolutionInterface.svelte)                                                                       | ✅ Done | Admin settle form (binary YES / NO or categorical outcome, resolution text, source, confirm step); copy through `t()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Admin             | [`AdminPage.svelte`](../../../src/lib/components/pages/AdminPage.svelte) + markets / resolutions / access                                                                       | ✅ Done | `/admin/*`; operator surfaces, English-only (the settle form above is the exception: its copy goes through `t()`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 6. Landing page

The app does not currently expose a public landing surface. Adding one
would introduce a new top-level route; surface the discussion in the
PR before doing so (see [structure rule](./structure.md#top-level-src)).

| Surface                                      | App equivalent                                                                                   | Status  | Notes                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------ |
| Landing page                                 | [`WelcomePage.svelte`](../../../src/lib/components/pages/WelcomePage.svelte) at `/welcome`       | ✅ Done | Public hero, ticker, product mockup/card stack, live questions, FAQ, CTAs; full six-locale `t()` for landing keys. |
| Landing sections (hero / ticker / FAQ / CTA) | `WelcomePage` + [`WelcomeProof.svelte`](../../../src/lib/components/landing/WelcomeProof.svelte) | ✅ Done | Ticker marquee, product loop, trust, and FAQ blocks on welcome route.                                              |

---

## 7. Flow Mode: rules

The swipe deck is the primary surface and carries the brand's heaviest
behavioral contract. The rules below are the source of truth: code
comments reference these rules, not vice versa.

### 7.1 Motion principles

- **Affirm, don't narrate.** A motion has to earn its place by adding
  something a number can't ("Locked in." not "Great job!").
- **Scarcity protects meaning.** Routine swipes are silent on the
  character layer: XP pop + edge tint + haptic only. Characters
  appear at milestones, state changes, and resolution events.
- **Speed is a feeling.** Reactive motion fires within 80–150 ms of an
  action. Past 200 ms the swipe rhythm breaks and the user notices the
  lag instead of the result. The commit-feedback beat in
  `FlowMode.svelte` is fixed at `COMMIT_FEEDBACK_MS = 80`.
- **Defended territory.** Each character owns one moment:
  VICI = protagonist + ambient · Flame = streak only ·
  Oracle = truth (resolution / threshold) · Trickster = contrarian
  predictions (low-consensus cards). They never cross territory.
- **Negative states deserve motion.** A wrong call, a broken streak,
  a skip, an empty deck: each has its own choreography. None borrow
  celebratory vocabulary; none go silent.
- **The ladder stretches.** First predictions feel like fireworks;
  later rewards are rare and feel earned. Bonus XP scales with
  rarity, not consistency (see §7.3).

### 7.2 Swipe commit choreography

| Phase                  | Duration                     | What happens                                                                   |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Release past threshold | -                            | Card locks, edge tint at full opacity, directional label visible, haptic fires |
| Commit feedback beat   | 80 ms (`COMMIT_FEEDBACK_MS`) | Card frozen in committed state; drag disabled                                  |
| Exit                   | ~450 ms `out:fly`            | `flying-yes` / `flying-no` / `flying-up` translates the card off-screen        |
| Reset                  | 600 ms (`COMMIT_RESET_MS`)   | Parent clears `committedAction` so the next card mounts neutral                |

Double-commits during the 80 ms window are ignored.

### 7.3 Motion engine: economy + beats

The Flow reward engine lives in
[`src/lib/utils/motion-engine.utils.ts`](../../../src/lib/utils/motion-engine.utils.ts)
(`recordMotionSwipe`). A swipe **places** a call; it never resolves one,
so the engine has no "correct" signal and never moves accuracy. It
rewards the act of calling and the discipline of showing up.

**A committed swipe mints no VXP.** There is no per-swipe / per-combo
award: `FlowMode` does not grant or display VXP on a swipe, and the
streak combo drives haptics and the streak banner only. The session VXP
counter (`+{xp} VXP this session`) reflects **only** the engine's genuine
grants below, so a routine daily-ten session shows `+0`.

**Deflation-safe VXP economy**: dopamine is not currency. Routine
swipes, the daily ten, and the moment-only lifetime marks (1 / 25)
mint **nothing**. Real VXP is minted only at:

- the **overtime finish** (`+25`, repeatable, the only repeatable mint), and
- rare **lifetime-volume milestones** at the 10 / 100 / 500 / 1000-call
  marks, each firing once ever:

| Lifetime call | Bonus VXP | Character | Extra        |
| ------------- | --------- | --------- | ------------ |
| 1             | 0         | Vici      | FIRST CALL   |
| 10            | +50       | Oracle    |              |
| 25            | 0         | Oracle    | moment only  |
| 100           | +100      | Oracle    | CENTURION    |
| 500           | +250      | Oracle    |              |
| 1000          | +500      | Oracle    | custom title |

Volume milestones seed off the **real lifetime call count**
(`lifetimeCalls`, passed by the caller); when the caller cannot supply
it the engine falls back to its own persisted tally. **Credit stacks**:
if a volume milestone coincides with the daily-complete beat, both
bonuses are credited even though only one beat animates.

**Copy is a rotating pool per slot** (`POOLS`): never the same line
twice running, persisted across sessions under `vici.motion.state.v3`.
Pools hold **i18n keys** (`motion.pool.*`), so the engine only chooses
which key and every line still resolves through `t()`. Beats also carry
`subKey` / `treatKey` / `badgeKey` chips.

**Within-day rhythm** beats (`r3` / `r5` / `r8`) fire on **jittered**
positions inside a window (2–4, 4–6, 7–9), re-rolled each local day so
the cadence is never memorised; they carry no VXP. **Overtime rhythm**
adds a Trickster beat at call 11 and a Trickster beat at call 13. The
daily session is hard-capped at `DAILY_HARD_CAP = 15`.

The engine's beat cadence runs off a **per-session counter**, not the
cross-session daily-goal total: `FlowMode` passes `sessionBaseline + callsCount` (the
calls already made today when the session opened, plus this session's) as
`dailyDone` and the live **session cap** as `dailyTarget`. The session
opens at the daily ten; the **"Push to 15 →"** opt-in on FlowEnd raises
that cap to `DAILY_HARD_CAP`, so `dailyTarget >= DAILY_HARD_CAP` flips
the engine into overtime: the calls-11 / 13 rhythm beats and the
overtime-complete `+25` fire as the counter climbs past ten. The
cross-session daily-goal count (still capped at `DAILY_HARD_CAP`) is the
streak source and the trigger for the **"come back tomorrow"** hard-cap
gate (`FlowDailyCap`): once a full day's calls are placed, re-entering
Flow shows that takeover instead of a fresh deck.

**Wildcard**: a rare (~1-in-6) variable-ratio surprise carrying a
non-currency `treat` (sticker / shield / flair), never VXP.
**Comeback**: a distinct, no-shame opener (`isComeback`) for a user
returning after a broken streak, separate from the daily welcome-back.

Haptics map each beat `kind` to a named pattern via `hapticForBeat`
([`haptics.utils.ts`](../../../src/lib/utils/haptics.utils.ts)); the
engine also emits raw `haptic` envelopes, but `FlowMode` drives feedback
through the named vocabulary (§7.9).

Sound is the audio sibling of haptics and matters more on iOS Safari,
which has no Vibration API. `FlowMode` fires the named cues from
[`flow-sound.utils.ts`](../../../src/lib/utils/flow-sound.utils.ts):
`flowTick()` on every committed YES / NO swipe (SKIP is silent),
`flowBeat(hard)` paired with the beat haptic (`hard` for any deck-gating
beat), `flowWild()` on a wildcard treat in place of the beat cue, and
`flowSummary()` as FlowEnd takes over. Cues lazy-init the `AudioContext`
on first use, no-op where Web Audio is unavailable, and honor the
`soundEnabled` preference. The visible Settings sound toggle is a
separate follow-up.

### 7.4 Daily streak: Flame stages

Defined in [`src/lib/utils/streak.utils.ts`](../../../src/lib/utils/streak.utils.ts)
(`stageForStreak`, `applyDailyStreakBump`, `todayKey`, `dayDelta`).
Five stages on a day count:

| Stage   | Days  | Notes                                                                        |
| ------- | ----- | ---------------------------------------------------------------------------- |
| SPARK   | 1–2   | Streak just starting (also: the visual after a break; Flame never goes dark) |
| EMBER   | 3–6   |                                                                              |
| FLAME   | 7–14  | Top-bar Flame chip activates `is-hot` from here                              |
| BLAZE   | 15–29 |                                                                              |
| INFERNO | 30+   |                                                                              |

Rules:

- Streak progresses on **any swipe** (YES, NO, SKIP all count) once per
  local day.
- **One missed day is forgiven.** The streak continues (and
  increments) as long as the gap since the last active day is within
  the forgiveness window: `dayDelta <= 2`, i.e. at most one fully-missed
  day. A gap of two or more fully-missed days (`dayDelta >= 3`) resets to
  SPARK 1 on the next swipe. No freezes beyond this single grace day.
- Break choreography: `low-thud` haptic + single banner naming the
  stage that ended ("BLAZE ended. Fresh start."). No celebration, no
  consolation.
- Flame appears in the Flow header + home screen only; never on
  every screen.

### 7.5 Accuracy gate

Below `ACCURACY_GATE_CALLS = 30` lifetime calls, accuracy is hidden:
calls + streak are the visible stats. The percentage unlocks at 30,
which is the smallest sample where it starts to be meaningful (and
not noisy). The FlowEnd celebration deliberately never surfaces
accuracy (a swipe places a call, it doesn't win one; see §7.3); the
gate applies to Profile + leaderboard previews on their next pass.

The **call-size ladder** is available to every predictor: the Flow-card back
shows the per-call size slider
([`FlowCallSize.svelte`](../../../src/lib/components/market/FlowCallSize.svelte))
whenever call-size controls are wired on the ViciXP domain, starting from the
`VXP_DEFAULT_CALL_SIZE` rung. There is no lifetime-call gate; sizing is
offered from the first call.

### 7.6 Negative-state choreography

| State                                    | Haptic           | Visual                                                   |
| ---------------------------------------- | ---------------- | -------------------------------------------------------- |
| Wrong call (resolution event, Portfolio) | `low-thud` (TBD) | Dim, no character                                        |
| Streak break                             | `low-thud`       | "X ended. Fresh start." banner, fresh SPARK              |
| Skip                                     | `soft-tick`      | Card flies up; session combo unchanged (skip is neutral) |
| Empty deck                               | none             | VICI in `thinking` mood + "Nothing here. Yet."           |

### 7.7 Character beats: priority resolver

`recordMotionSwipe` in
[`src/lib/utils/motion-engine.utils.ts`](../../../src/lib/utils/motion-engine.utils.ts)
runs a **single pass**: many beats can be eligible on one swipe, but only
the highest-priority one animates: **never two back to back**. The
comeback opener owns the first call of a returning day; otherwise:

```
Daily/overtime complete > Volume milestone > Overtime rhythm (11/13) >
First-time (yes/no/contrarian/leaderboard) > Within-day rhythm (jittered) >
Wildcard > Ambient (every 10th)
```

Bonus VXP still **stacks** across all eligible sources even when a
lower-priority beat is suppressed (see §7.3 credit-stacking). Lower-
priority beats are dropped, not queued; by the next swipe they're
stale. A real beat hard-pauses the deck (`FlowMode` sets `flowPaused`
until `onMotionBeatDone`); the ambient every-10th pop never gates.

### 7.8 Generative artwork: per-category

Defined in [`src/lib/utils/flow-art.utils.ts`](../../../src/lib/utils/flow-art.utils.ts)
and rendered by
[`src/lib/components/artwork/FlowArtFrame.svelte`](../../../src/lib/components/artwork/FlowArtFrame.svelte).
Six categories, six visual languages: same formal vocabulary per
category, different specifics per market:

| Category   | Visual language                                                                        |
| ---------- | -------------------------------------------------------------------------------------- |
| `macro`    | Concentric rings + horizontal atmospheric planes; one bright core anchors the eye      |
| `crypto`   | Angular polygon shards + neon seam piercing the focal shard; small floating fragment   |
| `sports`   | Heavy chevron stroke + trailing chevrons + diagonal speed strokes                      |
| `politics` | Colonnade: 5–9 columns, lintel, base; focal column wider + accent-gilded               |
| `tech`     | Isometric block stack on a faint dot grid; one focal block accent-blue                 |
| `culture`  | 1–2 organic ink blobs on warm paper wash; single calligraphic stroke + scattered marks |

Three states per category: neutral (Flow Mode default), won
(saturate + gild), lost (fracture + desaturate). Resolution-state
crossfade is for Portfolio only; Flow Mode renders neutral only.
Artwork is theme-aware: `dark` defines neutral / won / lost palettes;
`light` and `peach` define neutral palettes and reuse neutral for
resolved states. `FlowArtFrame` passes the active theme from
`theme.store.ts` into `renderFlowArt`, so previews react immediately
when the user switches appearance.

Compositional rules every piece must satisfy:

- One clear focal element (rule-of-thirds intersection).
- Readable at 80 × 80 (deck thumb). If it becomes mud at thumb size,
  redesign.
- One strong idea per piece: restraint over density.
- Designed mark, not banner: square viewBox, intentional inner
  padding, never edge-bleeding.
- No suggestion of data: no axis lines, gridlines, percentage
  labels, multi-line waveforms. The card already has the numbers.

Deterministic seeding: same `${category}::${marketId}::${state}`
triplet always renders the identical composition (FNV-1a hash +
mulberry32 PRNG).

### 7.9 Haptic vocabulary

[`src/lib/utils/haptics.utils.ts`](../../../src/lib/utils/haptics.utils.ts):
nine named patterns. Call sites use the name, never raw ms numbers.

| Pattern        | When                                         |
| -------------- | -------------------------------------------- |
| `light-tap`    | Ambient / background                         |
| `soft-tick`    | Skip, softer than commit, reads "passed"     |
| `firm-tap`     | YES / NO commit on a routine swipe           |
| `double-pulse` | Swipe-count milestone (10 / 50 / 250 / 1000) |
| `triple-tap`   | First call + streak tier-up                  |
| `mischief`     | Trickster signature (staccato)               |
| `soft-hum`     | Idle / Companion arrival                     |
| `low-thud`     | Streak break (honest, no warmth)             |
| `celebration`  | Session complete                             |

The wrapper is best-effort: no-ops on iOS Safari and any UA without
`navigator.vibrate`, never throws.

### 7.10 Cold-load Oracle moment

While the first Flow card is still fetching, the deck shows a brand-on
loading state instead of a bare spinner:
[`FlowEntry.svelte`](../../../src/lib/components/market/FlowEntry.svelte),
the full-bleed frosted entry `FlowMode` renders over the deck until the
session begins. Its `ready` prop is the **real first-card fetch state**
(`ready={!loading}`): no auto-enter and no tap reveals a deck that has
not arrived.

Everything sits under one `role="status"` region. In deck mode:

- **Deck riffle.** Three placeholder cards fan and snap, decorative
  (`aria-hidden`).
- **Oracle orb.** `OracleChar` floats above the cards.
- **Rotating oracle copy.** Terse oracular lines (`flow.entry.line.*`)
  cycle while the fetch is in flight.

The surface auto-enters once the deck is ready and a short dwell has
elapsed (`DECK_DWELL_MS`); the "Enter Flow" CTA is an optional
tap-to-skip. When calls settled since the last visit, the "while you
were away" digest takes over instead and waits for the user, with a
safety-net auto-enter (`SAFETY_AUTO_ENTER_MS`).

**Reduced-motion:** under `prefers-reduced-motion: reduce` the riffle,
float and CTA fill stop (the cards rest in their fanned pose), the copy
line stays fully visible and advances on a plain timer instead of a
fade, and the dwell shortens (`DECK_DWELL_REDUCED_MS`).

---

## 8. Routing & sign-in shell

The product splits into two layers: a public layer (sign-in,
sign-up, OAuth callbacks) and the gated `(app)` group. SvelteKit
file-based routes; there is no central nav store.

### 8.1 Auth gate

`src/routes/(app)/+layout.svelte` gates every route in the group.
It reacts to `userSignedOutResolved` from
[`src/lib/derived/user.derived.ts`](../../../src/lib/derived/user.derived.ts),
the `authBusy`-aware derived store that's only `true` after the
initial auth handshake has resolved to "definitely signed out".
Reacting to `authBusy` directly would bounce users to `/signin`
during a normal page load.

When the gate triggers, redirect via `goto(PublicPath.SignIn,
{ replace: true })` so the back-button doesn't loop the user
back into the gated route.

### 8.2 Public surfaces

| Path               | Purpose                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/signin`          | Returning-user sign-in surface (`SignInScreen` mode `"signin"`). Welcome-back framing. Routes signed-in users straight to home.                       |
| `/signup`          | Pre-sign-in onboarding (see §8.3): one screen to claim a handle and sign up (passkey/OAuth). No team-pick, gesture-practice or category-picker steps. |
| `/auth/callback/*` | OAuth callback handlers (Google today). Public: `signInWithGoogle` redirects through these.                                                           |

`PublicPath` enum + `isPublicPath(pathname)` helper live in
[`src/lib/constants/routes.constants.ts`](../../../src/lib/constants/routes.constants.ts).

### 8.3 Onboarding

[`src/lib/components/onboarding/Onboarding.svelte`](../../../src/lib/components/onboarding/Onboarding.svelte)
is the canonical create-account prelude: one screen that claims a handle
and signs up. Top to bottom: brand wordmark, hero, handle field, reward
chip, auth provider stack, escapes, legal fine print.

- **Handle field.** Live availability probe with a monotonic cancel
  token, a session cache of taken handles, an offline-tolerant `failed`
  state and a claim-time TOCTOU re-check. An empty field falls back to a
  typewriter placeholder cycling through `HANDLE_POOL` picks; every pick
  already passes the handle validator, so the settled one is directly
  claimable.
- **Reward chip.** The starter-pack VXP and the event title are derived
  (`newUserVxpAmountMilestone1BaseUnits` and the `featuredEvent` store),
  never hardcoded.
- **Auth.** `SignInProviderStack` locks the record (passkey / OAuth). A
  guest button skips into preview and keeps the chosen handle; "Already a
  member? Sign in" routes to sign-in.

Team selection happens in the post-signup Profile, so the emitted
handoff always carries `participantId` and `side` as `null`.

There is **no gestures step and no category-picker step** in the current
flow. The archetype step is not part of onboarding either. Post-auth
layouts must not gate on `profile.archetype`; if pre-sign-in onboarding
data is available, apply the handle (and team / side) to the profile
after authentication and clear the pending handoff.

### 8.4 SignInScreen: visual shell

[`src/lib/components/authn/SignInScreen.svelte`](../../../src/lib/components/authn/SignInScreen.svelte)
is the canonical sign-in / sign-up visual:

- Tracked-out `WELCOME BACK` / `WELCOME` eyebrow (`.allcaps`).
- Display sans + serif italic title: `Sign in to *VICI.*` /
  `Start predicting on *VICI.*`. Wordmark italicised in `.serif-italic`,
  in `--laurel`.
- Sub copy in `--text-muted`.
- Provider stack rendered through
  [`SignInActions.svelte`](../../../src/lib/components/authn/SignInActions.svelte):
  the four supported methods today: Internet Identity, Google,
  Passkey (WebAuthn), Dev (local only).
- Footer switcher between sign-in and sign-up modes.
- Legal fineprint at the bottom of the page (terms, privacy,
  play-money preview disclaimer).

**Out of scope today**: Apple Sign-In (Juno's auth provider list
covers `internet_identity` / `google` / `github` / `webauthn` /
`dev` only; adding Apple needs a custom OAuth flow on top of
Juno's delegation system) and email magic-link.

### 8.5 Bottom-nav active state

The mobile tab bar
([`MobileNav.svelte`](../../../src/lib/components/layout/MobileNav.svelte))
exact-matches `page.url.pathname` to the nav button's path, with
two cascade rules:

1. The Markets nav button (configured as `AppPath.Home` since the
   markets feed lives at `/`) lights up for any
   `/markets/[id]` detail route.
2. The Profile nav button lights up on `/wallet` (which has no
   nav slot of its own).

If new nav-less routes are added (e.g. `/notifications`,
`/settings`: both deferred), they extend this cascade table.

### 8.6 Dev-only Tweaks panel

[`src/lib/components/dev/TweaksPanel.svelte`](../../../src/lib/components/dev/TweaksPanel.svelte)
is a floating wrench-icon FAB, gated by `isDev()` from
[`src/lib/env/app.env.ts`](../../../src/lib/env/app.env.ts).
Currently provides an appearance picker, quick-jumps to every
nav-relevant route, a sign-out trigger, and a **World-Cup mode**
toggle that flips the persisted `worldCupMode` preference for QA
(see §11). The panel renders the live archive-gate state next to the
toggle so QA can confirm the gate independently of the opt-in.

It mounts in the **root** layout
([`src/routes/+layout.svelte`](../../../src/routes/+layout.svelte))
so it's available on the public surfaces too: a QA flow that
needs to bounce between `/signin` and the gated app benefits from
having it everywhere.

---

## 9. Market metadata

The app stores VICI-side market context in the public-read
`market_metadata` collection. This is a layer above the market engine:
it does not change clearing, settlement, payouts, or registry state.
It gives creators/admins a place to attach editorial and UX context used
by Flow cards and market detail.

### 9.1 Data shape

[`src/lib/schema/market-metadata.schema.ts`](../../../src/lib/schema/market-metadata.schema.ts)
defines:

| Field                     | Purpose                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `whyNow`                  | Front-card curation chip (`closing`, `trending`, `new`, `topical`, `social` + text).                                                |
| `events`                  | Up to two timeline annotations for compact sparklines / detail surfaces. Wire direction is `up` / `down`; UI may render +/- glyphs. |
| `resolution`              | Human-readable resolution criteria, source, and optional settle timestamp.                                                          |
| `updatedAt` / `updatedBy` | Audit fields set by the satellite update endpoint.                                                                                  |

The document key is the market/series id.

### 9.2 Authorization

Writes go through the typed satellite update endpoint
`upsertMarketMetadata`. The collection itself is configured as
`read: public`, `write: controllers`; frontend code should never call
`setDoc` directly for this collection.

The satellite authorizes writes if:

- the caller has the app admin role, or
- the caller is the market creator according to the registry canister.

### 9.3 Frontend usage

- Read/write helpers live in
  [`src/lib/services/market-metadata.services.ts`](../../../src/lib/services/market-metadata.services.ts).
- The creator/admin editor lives in
  [`MarketMetadataForm.svelte`](../../../src/lib/components/market/MarketMetadataForm.svelte)
  and is mounted on market detail when the viewer is authorized.
- Flow-card front/back consumers read from this service in
  [`FlowMode.svelte`](../../../src/lib/components/market/FlowMode.svelte)
  (batch load per deck) and pass metadata into
  [`FlowCard.svelte`](../../../src/lib/components/market/FlowCard.svelte).

---

## 10. User market signals

The Flow-card back face needs user-specific context. The derived signal
layer lives in
[`src/lib/utils/market-signals.utils.ts`](../../../src/lib/utils/market-signals.utils.ts)
and
[`src/lib/services/market-signals.services.ts`](../../../src/lib/services/market-signals.services.ts).

| Signal         | Source                                          | Behaviour                                                                                                              |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `categoryAcc`  | User clearing history + series category mapping | Settled events are grouped by FlowArt category. Positive settled quantity counts as a win. Accuracy is `wins / calls`. |
| `priorCalls`   | User executed clearing events                   | Latest executed event per market. Stores side, display date, and event-time consensus proxy when available.            |
| `followedLean` | Followed users' public trade activity           | Sparse map of followed-user YES/NO activity per market. If there is no usable followed activity, omit the row.         |

These signals are client-derived. They are not persisted in the
metadata collection and do not affect clearing, settlement, or profile
statistics.

`priorCalls` also gates the Flow deck: `prepareFlow`
([`flow-prep.services.ts`](../../../src/lib/services/flow-prep.services.ts))
drops every market the viewer has already called from the swipe queue:
a card you predicted on never re-enters Flow. This is a **hard** filter
(no recycle): if you've called every open market the deck legitimately
empties to the caught-up state, unlike the per-deck `exclude` set (which
only spans the immediately-previous deck and recycles when it would
otherwise empty a small inventory). The exclusion is keyed off the full
trade history, so a call from any earlier day or session counts; the
history fetch is shared with `getUserMarketSignals` via its optional
`tradeHistory` input so it is issued once per deck build.

---

## 11. Featured event & World-Cup mode

The app builds a temporary, curated experience around a single
tentpole "featured event" (the 2026 World Cup today). Everything
event-specific reads from one `FeaturedEvent` instance so the next
tentpole plugs in by swapping a constant.

- The event data + its lifecycle dates live in
  [`featured-event.constants.ts`](../../../src/lib/constants/featured-event.constants.ts).
  `archiveAfter_ms` is the **product-set archive cut-over date**
  (currently `2026-08-01`, a buffer past the final), adjustable in
  that one constant.
- Lifecycle status (`upcoming` / `live` / `wrap-up` / `archived`) and
  the convenience gate `featuredEventActive` derive off a 1-minute
  heartbeat in
  [`featured-event.derived.ts`](../../../src/lib/derived/featured-event.derived.ts).

World-Cup mode layers two orthogonal signals, surfaced together from
[`world-cup.derived.ts`](../../../src/lib/derived/world-cup.derived.ts):

| Signal                | Source                                 | Meaning                                                          |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `worldCupMode`        | `preferencesStore` (cross-device pref) | User's persisted opt-in. Pure preference; survives archival.     |
| `worldCupNotArchived` | `featuredEventActive` (archive gate)   | Product gate: `false` once `now > archiveAfter_ms`. Time-driven. |
| `worldCupActive`      | `worldCupMode && worldCupNotArchived`  | "Render World-Cup content now": the boolean most surfaces want.  |

The persisted flag default is `false` (off): the featured event is
still `upcoming` at time of writing, so the deck stays in its
all-categories shape until a user opts in. Consumers read the derived
stores in `world-cup.derived.ts` (`worldCupActive`, or `worldCupPhase`
for the Markets focus, § 11.1) rather than re-deriving the gate or
destructuring the preferences object.

### 11.1 Markets WC-focus

When `worldCupActive` is `true`, the Markets list
([`MarketsPage.svelte`](../../../src/lib/components/pages/MarketsPage.svelte))
opens **laser-focused on the World Cup** rather than its evergreen
all-categories shape:

- **Default filter** is the `wc` tag (not `all`). Read once at init via
  `get(worldCupActive)`: tying it to a live `$derived` would fight the
  user once they pick another chip.
- **Collapsed chip rail**: `MarketsCategoryChips` takes a `wcFocus` prop.
  In focus mode it leads with the World Cup chip and hides Saved · All ·
  the other categories behind a single **"More markets →"** control
  (`markets.more`) that expands them in place. No separate toggle, banner,
  or phase scrubber.
- **Two-tier header**: `MarketsPage` renders the featured event as a small
  uppercase eyebrow row (`.markets-eyebrow`) above the board, with the copy
  from the `markets.wc_eyebrow` key (never hardcoded).

Outside focus mode every one of these falls back to today's behavior, and
the sort rail / carousels / skeletons / empty states are unchanged in both
modes.

### 11.2 Markets retention arc (`worldCupPhase`)

The WC-focus above is one beat of a four-phase **retention arc** that
gradually widens the deck back to all categories as the event winds down,
pre-empting the post-Cup engagement cliff. The phase is a single derived,
[`worldCupPhase`](../../../src/lib/derived/world-cup.derived.ts), layered on
the existing signals; it does **not** introduce a parallel source of
truth. It updates live off a 1-minute heartbeat (same cadence as
`featured-event.derived`) so the phase advances mid-session as the date
thresholds pass.

| Phase      | When                                               | Markets behavior                                                                                                                                             |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `off`      | `!worldCupMode`                                    | All-categories, unchanged.                                                                                                                                   |
| `wc-focus` | opted in, `now < finalAt_ms − 14d`                 | WC-focus as in §11.1, unchanged.                                                                                                                             |
| `bridge`   | opted in, `finalAt_ms − 14d ≤ now < finalAt_ms`    | Still WC-focused, **plus** a "Beyond the Cup" rail (top non-WC open markets by volume) + a continuity line, seeded on the `wc` view before the Cup resolves. |
| `open`     | opted in, `now ≥ finalAt_ms` **or** event archived | Reverts to all-categories (default chip is `all`, not `wc`); a `WorldCupRecapCard` sits at the top.                                                          |

- **Threshold source:** `finalAt_ms` from `featured-event.constants.ts`
  (the 14-day bridge window is a single const in the derived). Once the
  product archive gate (`worldCupNotArchived`) flips, the arc settles on
  `open` regardless of the clock.
- **`MarketsPage` wiring:** the init default chip reads `get(worldCupPhase)`
  once (WC only in `wc-focus`/`bridge`); `wcFocus` is `$derived` off the
  live phase so the chrome drops the moment the phase advances. The bridge
  rail reuses `MarketsCarousel`; the recap card mounts above the list in
  `open` and never fights the user's chip selection.
- **`WorldCupRecapCard`** reads the user's `wc` category bucket from the
  persisted `user_stats` doc (`loadMyUserStats`, same source as the Dash
  rank tile): accuracy `= wins / calls`, plus the raw call count. Both fall
  back to `EMPTY_VALUE` when there are no WC calls or the snapshot hasn't
  loaded, never a fabricated figure. Its "Explore all markets" CTA clears
  the focus by setting the list to `all`.

---

## Style direction

- Tokens flow through [`src/app.css`](../../../src/app.css) `@theme`;
  per-component styling goes in the component's `<style>` block per the
  [stack-and-patterns rules](./stack-and-patterns.md#tailwind-v4--design-tokens).
- For spacing, sizing, radii, and most typography use Tailwind v4
  utilities. Only add a token to `src/app.css` when a real consumer
  needs a value Tailwind can't express.

---

## Recent alignment commits

Track substantive design alignment commits here (not every typography
tweak). Drop entries that no longer reflect the current product.

| Commit                                            | Summary                                                                                                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `style(ui): align primitives and app chrome`      | Retunes Card, Button, Badge, Tabs, SectionHeader, StatCard, Header, and MobileNav around the app shared card / chip / pill / translucent chrome language.                                                                        |
| `style(auth): align public onboarding surfaces`   | Aligns `/signin`, `/signup`, and `/welcome` around the compact sign-in shell, visual Apple/email placeholders, four-step onboarding, starter pack, product mockup, and landing rhythm.                                           |
| `style(market): align flow and question detail`   | Aligns Flow cards, Flow back face, market detail header, forecast/action modules, stats, and info panels around the question-detail anatomy while preserving swipe timing, trade execution, order-book polling, and sizing math. |
| `style(social): align retention surfaces`         | Reframes Arena, Profile, and Portfolio as a connected retention loop: Arena tabs and top-entry cards, performance-identity profile, recent activity blocks.                                                                      |
| `style(app): polish supporting surfaces`          | Polishes market discovery, wallet, settings, notifications, empty/loading states, and supporting widgets with the shared card/chrome language.                                                                                   |
| `fix(ui): tighten mobile theme and screen chrome` | Theme-coherent peach/light controls, compact theme picker, scoped sign-in provider styling, mobile-first hide of the desktop header/footer/challenge FAB on mobile pages, reduced onboarding coach background.                   |
| `feat(ui): add per-screen mobile appbars`         | New `MobileAppBar` primitive plus per-screen mobile appbars on Markets, Market Detail, Profile, Portfolio, Arena.                                                                                                                |
