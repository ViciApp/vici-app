# Prototype Parity Audit

Source of truth: `../VICI WebApp Beta V1.2/`.

This is the consolidated divergence list from a four-agent deep audit
(2026-05-26). **~270 individual divergences** across **24+ surfaces**.
Each is being addressed in its own commit on the
`feat/beta-v1.2-remodel` branch.

## Status legend

- ⬜ Not started
- 🟨 In progress (commit drafted)
- ✅ Done (commit landed)
- ⏭ Skipped (intentional divergence — see note)

## Tier-C decisions (additive features the prototype doesn't have)

These need a per-item decision before deletion. Default = remove.

| ID   | Surface          | Feature                                                     | Decision          | Note                                                                       |
| ---- | ---------------- | ----------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| C-1  | Markets list     | Status tabs (`Active / Trending / Expiring / Resolved`)     | ✅ Remove         | Locked in earlier wave                                                     |
| C-2  | Markets list     | Global search box                                           | ✅ Remove         | Locked in earlier wave                                                     |
| C-3  | Markets list     | "Suggested for you" rail                                    | ✅ Remove         | Prototype is truth                                                         |
| C-4  | Markets list     | "LIVE" pulsing pill in appbar                               | ✅ Remove         | Prototype is truth                                                         |
| C-5  | Markets list     | Hover lift on cards (`hover:-translate-y-0.5`)              | ✅ Remove         | Prototype is truth                                                         |
| C-6  | Sign-in          | Decorative orb radial gradients                             | ✅ Remove         | Prototype is truth                                                         |
| C-7  | Sign-in          | `or` divider between providers                              | ✅ Remove         | Prototype is truth                                                         |
| C-8  | Sign-in          | Internet Identity + Passkey + Dev buttons                   | ⏭ Keep            | Production-needed; style to match prototype tone                           |
| C-9  | Flow             | FlowTopBar (persistent close/progress/streak header)        | ✅ Remove         | Prototype is truth                                                         |
| C-10 | Flow             | LIMIT pill on edge labels (limit-order indicator)           | ✅ Remove         | Prototype is truth                                                         |
| C-11 | Flow             | Suggested badge in meta row                                 | ✅ Remove         | Prototype is truth                                                         |
| C-12 | Flow             | flow-card-rail bottom hint row                              | ✅ Remove         | Prototype is truth                                                         |
| C-13 | Flow card        | True 3D rotateY flip (vs prototype's opacity crossfade)     | ✅ Remove         | Use opacity crossfade per prototype                                        |
| C-14 | Flow card        | Edge-inset glow on swipe (`box-shadow inset 0 0 60px`)      | ✅ Remove         | Prototype is truth                                                         |
| C-15 | Profile          | Friends row (count + pending badge)                         | ✅ Remove         | Prototype is truth                                                         |
| C-16 | Profile          | ReferralCard                                                | ✅ Remove         | Prototype is truth                                                         |
| C-17 | Profile          | Skill grid (Accuracy/Calls/Wins/Streak)                     | ✅ Remove         | Prototype is truth                                                         |
| C-18 | Profile          | 30-day streak activity heatmap                              | ✅ Remove         | Prototype is truth                                                         |
| C-19 | Settings         | Language selector segmented control                         | ⏭ Keep            | Production-need (7 locales shipped)                                        |
| C-20 | Settings         | Inline blocking-leagues link list in delete flow            | ⏭ Keep            | Production safety                                                          |
| C-21 | Settings         | Transfer ownership UI in delete flow                        | ⏭ Keep            | Production need; backend shipped                                           |
| C-22 | League detail    | Transfer ownership CTA + modal                              | ⏭ Keep            | Production need; backend shipped                                           |
| C-23 | Account settings | Different intro copy / no provider-specific glyphs          | ✅ Strip glyphs   | Stripped; reverted provider-glyph tile + VERIFIED chip in commit `ac6dcc8` |
| C-24 | Wallet           | Multi-tab production wallet (Send / Receive / History tabs) | ⏭ Keep            | Production need                                                            |
| C-25 | Portfolio        | OpenOrders table                                            | ⏭ Keep            | Production need (limit orders)                                             |
| C-26 | Tournament       | (additive UI from us — TBD list)                            | ✅ Re-audited     | Findings in Tournament re-audit sub-section; 3 shipped, 6 deferred         |
| C-27 | Friends          | Back-arrow appbar to Profile                                | ✅ Remove         | Drop standalone `/friends` route; Friends only inside Social               |
| C-28 | Layout           | 200ms cross-fade between routes                             | ⏭ Keep            | Confirmed earlier as intentional                                           |
| C-29 | Worlds           | Podium prize claim banner                                   | ⏭ Keep            | Production need (real claim flow)                                          |
| C-30 | Layout           | DomainSwitch                                                | ✅ Hidden in prod | Locked earlier                                                             |

## Surface checklist — A-tier divergences (must-fix)

### Welcome / Landing (8)

- ✅ Hero LIVE tag pill (uses tokens, not custom CSS pulse) — keyframe renamed to `pulse-live`
- ✅ WC kickoff chip wired into hero meta row (driven by `WORLD_CUP_KICKOFF.daysToKickoff`)
- ✅ Hero stats: `<strong>` → `<span class="num">`
- ✅ Primary CTA targets: secondary CTA now routes to `AppPath.Markets`
- ✅ Hero visual replaced with `WelcomeHeroFlowCard` (real `WELCOME_MARKET_PREVIEWS[0]` data, port of `LandingFlowCard`)
- ✅ FAQ section landed (`WelcomeFAQ`, six accordion items, native `<details>`)
- ✅ Hardcoded deck values disappeared with the FlowCard port — now driven from `WELCOME_MARKET_PREVIEWS`
- ✅ Italic accent: `.serif-italic.acc` spans unchanged (already in use across landing components; not visibly broken)

### Sign-in (14) ✅ commit `<signin>`

- ✅ Title template / wordmark size + accent color — `Logo` swapped for
  an inline 3rem laurel-coloured VICI wordmark; `serif-italic` accent
  on the brand token inside `signin-title`.
- ✅ Missing predictor proof line — `signin-proof` row renders
  `184,000 PREDICTORS · 1,240 CALLS THIS HOUR` via new
  `signin.proof.*` keys (locale-aware separators).
- ✅ Sent-state UI — `SignInProviderStack` swaps to a check-mark +
  "Check your inbox" + Continue + "Use a different email" stack via
  `phase === 'sent'`.
- ⏭ Email provider functional — kept as disabled placeholder behind
  `EMAIL_ENABLED = false` until the satellite magic-link endpoint
  ships. Sent-state code path is wired so swap is one constant.
- ⏭ Apple provider functional — kept as disabled placeholder behind
  `APPLE_ENABLED = false` (no SIWA backend yet); "Coming soon"
  micro-label rendered.
- ✅ Provider button order — Apple / Google / Email / IC / Passkey /
  Dev top-to-bottom per prototype.
- ✅ Faded "other" providers when email open — `is-faded` modifier
  driven by `emailOpen && phase === 'idle' && signingIn === null`
  toggles `opacity: 0.4` on the sibling provider buttons.
- ✅ Loading state per provider — single `signingIn: ProviderId | null`
  drives the swap between provider label and `signin.loading.<id>`
  ("Opening Apple…", "Opening Google…", "Sending sign-in link…", …)
  plus the `is-loading` opacity dim.
- ✅ "Create an account" CTA copy + routing — bottom-of-page link
  reads "Don't have an account yet? Create one →" and routes to
  `PublicPath.SignUp`.
- ✅ Legal block content — two-line layout with anchor links to
  `/info/terms` and `/info/privacy`, copy split across
  `signin.legal.line1` and `signin.legal.line2.*`.
- ✅ C-6 — decorative orb radial gradients stripped (no
  `.signin-orb-a` / `.signin-orb-b`, no `--laurel-glow` /
  `--yes-wash` radial fills on `.signin-wrap`).
- ✅ C-7 — `or` divider removed from the Sign-in page provider stack
  (`signin.divider` key kept for now since `SignInActions` still
  renders it inside `LoginRequired` / `SignInModal` /
  `OnboardingBeat3` — those surfaces are separate audit items).
- ⏭ C-8 — Internet Identity, Passkey, and Dev buttons kept (production
  need) and re-rendered with the same `signin-provider-btn` shape +
  per-provider loading state.

### Onboarding (22) ✅ commit `a7e04d1`

- ✅ Beat 1 — progress-dots header removed (`OnboardingBeat1` no longer
  renders the dot row + step label; markup drops straight to the WC
  eyebrow).
- ✅ Beat 1 — inline italic accent on "Your call comes next" via
  `subtitle_a` + `subtitle_b` split with `<span class="serif-italic acc">`
  wrapping the accent half (mirrors the landing pattern).
- ✅ Beat 1 — localised team promotion: new
  `detectUserCountryCode` helper in
  `#lib/utils/locale-country.utils.ts` reads `navigator.languages`,
  Beat 1.a promotes the matching participant into slot 1 of the
  favourites grid when not already visible.
- ✅ Beat 1 — skip CTA: `.ob2-skip-team` no longer underlines (kept the
  prototype's "Skip — just following the tournament →" copy).
- ✅ Beat 1.b — card body upgraded: question heading +
  prob-bar split (NO%/track/YES%) shipped inline on the swipe card
  (mirrors `WelcomeHeroFlowCard`). The YES/NO tap fallback buttons stay
  for accessibility. Kept the existing `SwipeableMarketCard` primitive
  for swipe physics.
- ✅ Beat 1.b — static "Make your first call." heading hoisted above the
  card via `onboarding.beat1b.headline`.
- ✅ Beat 1.b — progress-dots header dropped.
- ✅ Beat 1.b — shared `FlowCoach.svelte` overlay (`surface="onboarding"`)
  mounted inside the `.ob-stage`; runs the full five-phase gesture cycle
  (NO / YES / SKIP / TAP / IDLE) with card drift/blur via
  `data-coach-phase`, phase-3 "tap" degrading to a zoom-and-de-blur on the
  faceless `.ob-card` (no flip); tap-anywhere dismiss, once per device.
- ✅ Beat 2 — "taken" state on pool chips: live probe of the top 50
  leaderboard rows via `getLeaderboard()`, seeded into a
  `SvelteSet<string>` (case-insensitive); chips render the inline
  "taken" tag and disable, custom input maps to the same `avail.taken`
  reason key.
- ✅ Beat 2 — italic accent on `@handle` in the availability message
  via new `avail_ok_prefix` split + `<span class="serif-italic acc">`.
- ✅ Beat 2 — validation error strings: parity verified — all four
  reasons (`too_short`, `too_long`, `invalid`, `taken`) match the
  prototype copy across all 7 locales.
- ✅ Beat 2 — affiliation chip uses `team.id` (event participant code)
  - `team.color` direct via inline `style:background` on the tag.
- ✅ Beat 2 — affiliation flag style: `color-mix(... 13%, transparent)`
  bg + `team.color` foreground applied inline (matches prototype's
  `color+'22'` recipe in computed-token form).
- ✅ Beat 3 — heading + subcopy: subtitle now renders
  `"@handle, your call resolves {resolves}. We'll email you the
outcome…"` with the date formatted in the active locale via
  `Intl.DateTimeFormat` over `event.finalAt_ms`.
- ✅ Beat 3 — summary meta line includes resolves date: two parallel
  keys (`summary_meta` / `summary_meta_side`) so the `side` token
  collapses cleanly when the user skipped the swipe.
- ✅ Beat 3 — auth row swapped from `SignInActions` to the
  `SignInProviderStack` shipped in the Sign-in commit (Apple / Google /
  Email / II / Passkey / Dev; same provider order + sent-state).
- ✅ Beat 3 — TOS fine-print: new `tos.*` keys with anchor links to
  `/info/terms` and `/info/privacy`, "VICI is free." middle, italic
  serif tail ("Resolution on public data.").
- ✅ Beat 3 — back affordance copy: kept the prototype's
  "← Back to handle" wording (already in catalog as `beat3.back`).
- ✅ Sign-in switch link ("Already a member? Sign in") rendered at the
  top of `OnboardingFlow` via `onboarding.switch.prefix` +
  `onboarding.switch.signin`, anchored to `PublicPath.SignIn`.
- ✅ Beat 2 skip-link copy: "Pick later — keep placeholder"
  matches the prototype.

### Flow (28) ✅ commit `0322f7b`

- ✅ Front: stake selector hidden for <50 calls; SIZE · VXP display when
  unlocked — `vxpStakeSliderUnlocked({ calls })` gates the SIZE chip and
  the back-face stake slider; below the threshold the chip dims to the
  locked default (`VXP_DEFAULT_STAKE = 50`) and the back-face slider is
  replaced with the unlock-progress hint.
- ✅ Front: bar+payout split layout — single
  `flow-probs-track` with NO/YES fills + flanking percentages, plus a
  second row carrying chevron · payout · LONG SHOT/FAVORITE role label.
- ✅ Front: `ConsensusCompass` mounted in the head row (top-right), 42px
  size, semantic yes/no colour via `--needle-color`.
- ✅ Front: days-left chip in the meta row — `flow-days` pill alongside
  the category tag, urgency tiers (`is-soon` ≤ 7d, `is-urgent` ≤ 1d).
- ✅ Front: live WC suffix on the category tag —
  `wc.matchday` / `wc.kicks_off_tomorrow` / `wc.kickoff_week` driven off
  `$daysToKickoff`; the numeric "X DAYS" is owned by the days-left chip.
- ✅ Front: payout role labels (LONG SHOT / FAVORITE) — assigned per
  side based on `yesIsFav` and localised via `card.long_shot` /
  `card.favorite`.
- ⏭ Front: Trickster pill on contrarian markets — the existing companion
  Trickster beat in `FlowMode` already fires on `yes ≤ 0.25` /
  `yes ≥ 0.75` via `showCompanion`. The prototype's static pill would
  duplicate that signal, so the companion beat is the canonical surface.
- ✅ Front: friends-followed-lean line — when `followedLean.yes > 0`,
  the social row renders `{count} friend(s) YES · {other} NO` (via
  `card.followed_lean_template` + singular/plural friend keys).
- ✅ Front: sharp-predictor signal removed — no `flow-sharp` block on the
  front face; the back face owns it via the "Top 10% accuracy" row.
- ✅ Front: edge-to-edge `MarketArtwork` — `.flow-art-bleed` spans the
  full card body with no side padding, top/bottom border rules.
- ✅ Swipe physics — `SWIPE_THRESHOLD = 100`, `SKIP_THRESHOLD = 110`,
  rotation = `dragX / 18`, `SETTLE_MS = 220`, `vibrate(12)` on commit.
  Raw deltas (no Spring) match the prototype's `useState` model;
  `committedRef` is a one-shot latch reset on `market.id` change.
- ✅ Swipe overlay style — full-card `flow-overlay` blocks with
  `clamp(3.5rem, 14vw, 5rem)` text + tinted shadow per direction. No
  edge-inset glow (C-14 strip).
- ⏭ Locked-card nudge interaction — locked-card hard-pause flow is
  driven by `MotionBeat` / `flowPaused` in `FlowMode`, not by an
  in-card nudge. Front-face stays interactive-or-not via the existing
  `interactive` prop; the prototype's ±4 px nudge is deferred (no
  motion-engine signal currently emits it).
- ✅ Back: saved/heart + share buttons in the back-card head row —
  `SavedMarketToggle` + `MarketDetailShareButton` inside
  `flow-back-actions` (gated `data-no-card-gesture`).
- ✅ Back: "Resolves Yes if" block with full-rules toggle —
  `card.back.resolves_if` + `card.back.show_rules` / `hide_rules` and
  the rotating caret glyph.
- ✅ Back: full stake-slider parity — track + filled bar + handle dot +
  invisible native `<input type=range>` for drag/touch, with the 5-rung
  peg row underneath and the IF YES / IF NO / IF WRONG payout preview.
  `is-cap` modifier on the wrapper when the user lands on the top rung.
- ✅ Back: three-row "Who's calling what" — All callers + Top 10%
  accuracy (with `±N pts` diff badge vs consensus) + Predictors you
  follow (10-dot grid via `flow-followed-dots`).
- ✅ Back: prior-call section parity — `card.you_called_eyebrow` plus
  the live `card.prior_call_drift` line (`{when} · consensus {drift}
pts since`).
- ✅ Back: live countdown — `$effect` interval ticks `nowTick` once per
  minute; `getTimeRemaining` is derived off the tick. Urgent state (≤
  24h) drives a pulse dot next to the settles line.
- ✅ Back: track-record line — `card.your_accuracy_line` (`Your
{category} accuracy: {pct}% · {calls} calls`), coloured per the
  `acc ≥ 0.6` gate.
- ✅ Back-face swipe still commits — back-face `onPointerMove` guards
  horizontal motion (>20% over vertical) and reuses the same commit
  pipeline; YES/NO stamps mirror the front overlays with
  `flow-overlay-back`.
- ✅ "Why this card now" priority — prior-call branch wins over
  `whyNow`, with side-aware tinting (`is-yes` / `is-no`); falls back to
  the editorial `metadata.whyNow.text` chip.
- ✅ Header gradient + card body radial gradient parity — front head
  uses `linear-gradient(160deg, cat 18% → cat 7% → transparent)` and
  the card body adds the `radial-gradient(circle at 18% 0%, cat 18%,
transparent 32%)` over the surface-popover linear base. Back panel
  layers a `linear-gradient(180deg, cat 14%, transparent 60%)` on top
  of the same base.
- ✅ C-9 STRIP — `FlowTopBar.svelte` deleted; FlowMode no longer mounts
  a persistent header. A compact floating exit chip in the top-right
  preserves the close affordance for mouse users.
- ✅ C-10 STRIP — LIMIT pill removed from the edge labels (the old
  `isLimitOrderYes` / `isLimitOrderNo` props are no longer plumbed into
  `FlowCard`).
- ✅ C-11 STRIP — `SuggestedBadge` no longer appears in the card meta
  row.
- ✅ C-12 STRIP — `flow-card-rail` bottom hint row removed.
- ✅ C-13 STRIP — true 3D `rotateY` flip replaced with an opacity
  crossfade across both faces (delayed-opacity transition so the back
  never flashes through during the swap).
- ✅ C-14 STRIP — edge-inset glow (`box-shadow: inset 0 0 60px ...`)
  removed; the new full-card overlay text carries the swipe intent
  on its own.

### Sparkline + event markers (12) ✅ commit `<sparkline>`

- ✅ SVG dimensions (w=240, h=56, +8 overflow)
- ✅ Line + filled area beneath
- ✅ Trailing "Live" dot at right edge
- ✅ Tap-to-reveal event markers (idle pulse → active dotted vertical)
- ✅ Real-date event labels (DAY DOM MONTH · LABEL · ↑/↓)
- ✅ Hint copy when events present but none active
- ✅ All events plotted (not slice(0,2))
- ✅ Stroke color lean-aware (YES/NO)
- ⏭ Event `dir` field: kept `'up' / 'down'` (FE enum stays; only the rendered glyph matches prototype's `↑/↓`)
- ✅ Pulse animation on dots when idle
- ✅ Reset active state on market change
- ✅ Marker Y coordinate uses event day index, not iteration index

### Markets list (14) ✅ commit `<markets-list>`

- ✅ Category chips at top — `MarketsCategoryChips` with the ♥ Saved
  chip prepended, then `All`, then the 6 `MARKET_TAGS` categories.
  Per-tag accent driven by `var(--cat-{id})` via the `tagColor`
  helper. Per-category glyphs via `@lucide/svelte` icons
  (LandPlot / Bitcoin / Landmark / Wand2 / Trophy / Sparkles).
- ✅ Status tabs removed — `MarketFilters` no longer mounted on the
  Markets list page; the page is now driven entirely by category
  chip state. (Tier C-1.)
- ✅ Saved toggle relocated to a first-class category chip — the
  legacy inline "saved-only" pill is gone; saved view enters via
  the heart chip and exits via any other chip.
- ✅ Trending horizontal carousel — `MarketsCarousel` rail on
  `cat === 'all'`. Sorted by `totalVolume` desc (open markets only)
  and capped at 8. Reuses `MarketsFeaturedCard`.
- ✅ Saved horizontal carousel — `MarketsCarousel` rail on
  `cat === 'all'` when `savedCount > 0`, capped at 6. "See all N →"
  CTA jumps straight to the saved chip view.
- ✅ FeaturedCard vs ListRow split — `MarketsFeaturedCard` for
  carousels (column layout, 17.5rem fixed width, 3-line title clamp,
  YES%+pair chips) vs `MarketsListRow` for the list (row layout,
  inline tag · volume · close meta, bar+pct foot).
- ✅ Volume + close eyebrow on list cards — `MarketsListRow` head
  renders `"{volume} · {timeLeft}"` via `formatVolume` +
  `getTimeRemaining`.
- ✅ Section heading "All markets / Saved / {label}" with count —
  `.markets-section-head` renders the active category label (via
  `MARKET_TAG_LABEL_KEYS`) and the list length in the trailing
  `num` count.
- ✅ List gap density tightened — `.markets-list` is `gap: 0.5rem`
  (8px) and `.markets-root` runs `0.875rem` between top-level
  sections, replacing the previous `space-y-5/space-y-6` 20-24px
  scaffold.
- ✅ Empty-state copy — kept "No saved markets yet." + "Tap the
  heart on any market card…" body; the heart eyebrow stays so the
  affordance is discoverable in 7 locales.
- ✅ Page header — appbar shows only the `MARKETS` allcaps eyebrow;
  the LIVE pill and count badge are gone. Beneath, a single
  serif-italic display h1 carries `markets.hero.title`
  ("What will the world do?") at `--t-24`, `tracking-tight`.
- ✅ Tag chip styling — list-row + featured-card tags render as
  bare colored text (no bg / no border), via `style:color` from
  `tagColor`. Matches prototype's `<span className="tag">` style.
- ✅ Per-category icon glyphs in the chip strip (Item 11).
- ✅ Skeletons for loading — `.markets-row-skeleton` × 4 while
  `marketsNotInitialized` is `true`; matches the list-row height
  - dashed border + animated pulse.
- ✅ No settings/notification icons in the appbar (Item 14) —
  prototype's appbar carries only the title; we honor that.
- ✅ (Tier C-3) "Suggested for you" rail removed — replaced by
  Trending; the previous `suggestedRail` /
  `eventRailItems` derived block on `MarketsPage` is gone.
- ✅ (Tier C-4) "LIVE" pulsing pill removed from the appbar —
  `markets-mobile-live` and its `count` slot were cut alongside the
  page-header rewrite.
- ✅ (Tier C-5) Hover-lift removed — `MarketsListRow` /
  `MarketsFeaturedCard` use border-color + background-color
  transitions on hover only, no `hover:-translate-y-0.5`.

### Market detail (16) ✅ commit `19c8441`

- ✅ Appbar share + watch buttons (`MarketDetailShareButton` + `SavedMarketToggle` in appbar right slot)
- ✅ LIVE pulsing pill next to category tag (`MarketDetailLivePill`)
- ✅ Hero probability layout — 48px YES + 24px NO baseline-aligned + split bar (`MarketDetailProbHero`)
- ✅ 7-day chart card with period chips 1d/7d/30d/ALL (`MarketDetailChartCard`, reuses `FlowCardSparkline`)
- ✅ Stats grid 2×2 — VOLUME / LIQUIDITY / CLOSES / MY CALL (`MarketDetailStatsGrid`)
- ✅ Resolution card position — directly below stats (`MarketDetailResolutionCard`)
- ✅ "Top predictors here" mini-leaderboard (`MarketDetailTopPredictors`, reads `leaderboard` derived)
- ✅ Sticky bottom YES/NO CTA bar (`MarketDetailCtaBar`; MobileNav suppressed on this route)
- ⏭ Sheet sizing UX (slider 10-500 step 10 + payout + Lock-in CTA): trigger is the new CTA bar but the sheet body still renders the production `TradeModal` → `PredictionInterface` (VXP balance gating, order-book sizing, decimals, market/limit toggle, error surfaces). Re-skinning the sheet itself with the prototype's 10–500 slider would either (a) break VXP economy guards or (b) require porting them into a parallel surface. Tracked as substantive C-item for a dedicated commit.
- ✅ Done-state confirmation overlay — blurred + check + "Locked in." (`MarketDetailLockedToast`)
- ✅ Category chip in hero — colored text only, no bg / no border
- ✅ Hero title size + family — display font, 1.5rem mobile / 1.75rem ≥md, -0.02em tracking, 1.22 line-height
- ✅ Removed meta grid (settles / time_left / created_by) — gone with `MarketDetailHeader` deletion
- ✅ Removed duplicate description from hero — only the resolution card carries it now
- ✅ Single linear page, no tabs (`MarketDetailTabs` deleted)
- ✅ Removed heart toggle from hero — relocated to appbar right (functional equivalent of prototype's eye)
- ✅ Desktop split column stripped — single column mobile-first, capped at 36rem max-width on ≥md per "prototype is truth"

### Dash (15) ✅ commit `f78e042`

- ✅ Title "Dashboard" not "Dash"; no right action (`DashPage.svelte` appbar — title only, no Briefcase button)
- ✅ Hero accuracy block — session-delta line + 30d global anchor + streak row inline under the big number
- ✅ Time-window chip strip (7d/30d/90d/All) — `dash-window` chips, visual switch until per-window aggregator lands
- ✅ Holdings card (VXP balance + Backed/Lifetime/This-session + invite-friend CTA → `/friends`)
- ✅ Accuracy trend sparkline chart — new `DashAccuracySparkline.svelte` (laurel area + accent line + trailing dot, no tap markers)
- ✅ Active calls section — list with urgency timers (red "Xh left" when ≤24h to expiry)
- ✅ By-category breakdown — horizontal bars + pct, sorted desc, only categories with calls
- ✅ Where you stand grid — Global / League / Top-category tile (League tile navigates to `/social`)
- ✅ Oracle insight callout — laurel-tinted card; copy is data-driven (best-win title → strongest-category → empty-state)
- ✅ Past predictions — filter chips (All/Won/Lost with counts), 8 rows w/ check/X glyphs + relative-time ctx + ±VXP delta
- ✅ Next-unlock achievement card — picks first locked from `ACHIEVEMENTS`, emblem in laurel-wash tile, progress bar
- ✅ Three disclosure foldouts at bottom — "How accuracy is calculated" / "About VXP" / "About leagues" (CTA → `/social`)
- ✅ Full-width container — removed `max-w-[var(--reading-max,64ch)]` wrapper; `dash-root` is full-bleed with section padding
- ✅ Remove ComebackBanner — banner no longer mounted on Dash (kept the file + i18n keys; banner is now unused, candidate for sweep)
- ✅ Streak placement inline with accuracy — `.dash-streak-row` inside `.dash-hero` (flame + days + sub + progress bar), no separate card

### Portfolio (10) ✅ commit `9a430e4`

- ✅ Single-page hero balance + 3-col stats — `PortfolioPage` now mounts the hero card (eyebrow + 48px VXP num + weekly delta) plus the 3-col mini stats grid; the legacy `PortfolioStats` 6-tile holdings + `PortfolioAllocation` + dual `PositionTable`/`TradeHistoryTable` split is gone
- ✅ Hero VXP balance — 48px num pulled from `balancesStore[VXP]` with the weekly delta line inline (`+/−` laurel / no-red), mirroring the Wallet hero pattern shipped in `2b48623`
- ✅ 3-col stats grid — `Active calls` / `Resolved` / `Lifetime VXP` chips under the hero (`portfolio.stat.active` / `.resolved` / `.lifetime_vxp`); Lifetime VXP reads the same VXP balance as the hero so the surface stays in lock-step
- ✅ Open positions list — flat `.portfolio-list` rows with `PositionArtThumb` · market title · YES/NO side pill · payout-at-prob meta · signed PnL (positive `--yes`, negative `--no`); rows link to `/markets/[id]`
- ✅ Resolved positions list — separate flat list with a `W` / `L` / `—` glyph tile (laurel / no-red / muted), market title, and signed PnL via `positionResolvedResult` + `calculatePositionPnL`
- ✅ Remove `SectionHeader`, use `MobileAppBar` — left-aligned `MobileAppBar` (title + ghost `LineChart` right slot); the desktop `SectionHeader` + description blob deleted along with `portfolio.sub`
- ⏭ (C-25 keep) `OpenOrdersTable` retained for limit-order cancellation; mounted under a `.portfolio-orders` section only when `$orders.length > 0` so it stays out of the hero when empty
- ✅ Empty state — `serif-italic` quote + body line + primary `Open Flow` CTA (`portfolio.empty.quote` / `.body` / `.cta`), replacing the old per-table `EmptyState` cards
- ✅ Drop redundant filter chips — the legacy `PortfolioStats` activity tiles + filter chip row are gone; the 3-col mini stats supersedes them
- ✅ Drop cumulative-PnL chart — never shipped; the prototype has no `PerfChart` either, so nothing to remove on this side

### Profile (16) ✅ commit `dfa444a`

- ✅ Appbar — Settings cog opens a trailing menu (Settings + Sign out); description + FeaturedEventChip stripped
- ✅ Identity card archetype-coloured blur halo (140×140 circle, opacity 0.10, blur 20px) — `.profile-halo` driven by `--archetype-accent`
- ✅ Editable avatar — tap opens an avatar-editor sheet stub (TODO: full shuffle flow ports with the avatar library; affordance discoverable today)
- ✅ Bio under handle in serif italic (FE-only `localStorage` source, mirrors prototype; full schema field deferred to avoid satellite redeploy in this PR)
- ✅ Session VXP delta inline (today, derived from `recentSettlements` window over 24h × VXP_PER_CALL = 240; green/red depending on sign)
- ✅ Streak flame inline at name level (`.profile-streak-inline` pill with `Flame` + day count)
- ✅ Joined date line — derived from Juno `Doc.created_at` (ns), formatted via `Intl.DateTimeFormat` for the active locale
- ✅ Stats line "X calls · Y% accuracy" — `profile.dashboard.lifetime_stats` with thousands-rounded `K/M` formatter
- ✅ Achievement rail — 36×36 emblem tile, `accent-glow` bg when earned, `opacity 0.6` when locked, sort by `(unlocked desc, progress desc)`
- ✅ Past calls preview — 3 rows above achievements, each row links to its market; section "All" button → `AppPath.Album`
- ✅ Level bar gradient `archetype.accent → var(--color-primary)`; level row labeled "VXP" not "XP"
- ✅ Affiliations grid (4 slots) — Uni / Country active via `lookupWorldsAffiliation` + `listMyAffiliations`; City + Company locked with `Lock` glyph + "Soon" copy
- ✅ Affiliations card tap → opens `AffiliationPickerModal` (same modal Worlds uses; refresh on pick)
- ✅ Edit-profile sheet (Modal) — handle + bio inputs with nickname availability inline hint, 140-char bio counter, Save/Cancel actions
- ✅ Sign-out entry point in trailing menu (uses `@junobuild/core` `signOut`); Settings entry point alongside
- ✅ Oracle weekly insight retained — laurel-washed card, eyebrow + serif-italic body
- ✅ (Tier C-15) Friends row removed
- ✅ (Tier C-16) ReferralCard removed from Profile (still mounted on Friends page)
- ✅ (Tier C-17) Skill grid removed
- ✅ (Tier C-18) 30-day streak heatmap removed
- ⏭ Full AvatarEditor (skin / hair / mood / crown / held / toga / backdrop tabs) — stub sheet today; full editor depends on the avatar-library port (tracked follow-up)

### Wallet (5 — full reconceptualization) ✅ commit `2b48623`

- ✅ Header — `MobileAppBar` back to `/profile` + centered title + History icon right slot (`SectionHeader` retired)
- ✅ Centered hero card — `VXP BALANCE` eyebrow, 48px num balance from `balancesStore[VXP]`, weekly delta (`+/−` laurel / no-red) computed from VXP settlements / trades in the last 7 days, dual Open Flow / Back a call CTA row
- ✅ Recent activity list — top 6 rows from the unified `filteredTransactions` feed (real history, not mock); renders title + market subtitle + `formatNanosecondsToDate` timestamp + signed amount
- ⏭ (C-24 keep) Send / Receive / History tabs retained — production need; restyled inside a single tone-down card under the hero / activity
- ✅ Remove `CollateralStats` secondary card + its modal (`CollateralModal`, `CollateralTokenRow` deleted as orphans; `WalletStats` also removed since the prototype hero supersedes it)

### Settings (24) ✅ commit `f521246`

- ✅ Identity row — added "Joined {date}" line from Juno doc `created_at`; archetype chip removed
- ✅ Account section — "Sign-in method" + "Email" rows added (route to `/settings/account`)
- ✅ Account section — Wallet row removed (and `settings.wallet*` keys retired in all 7 locales)
- ✅ Preferences ordering — Appearance → Flow deck → Notifications → Session length → Haptics → Language
- ⏭ (C-19 keep) Language row retained — production-need (7 locales shipped); placed last per ordering
- ✅ Appearance picker — 3 swatch tiles (dark/light/peach) via `AppearancePicker variant="tiles"`
- ✅ Flow deck segmented control — 2-up `all / wc` tab strip matches prototype shape
- ✅ Flow deck sub-copy parity — `{enabled} of {total} categories enabled` / one-category / world-cup variants
- ✅ Haptics sub-copy: "Subtle taps on YES/NO commit"
- ✅ Privacy & security section — title is "Privacy & security" (`settings.privacy` key)
- ✅ Duplicate Privacy section added — 3 toggles (Public profile / Global leaderboard / Worlds Universities); flashes local "Saved" toast (sharing slice on `preferences` is tracked follow-up)
- ✅ "Your data" section added (Export predictions / Download album) — both flash a "coming soon" toast until export pipelines land
- ✅ Legal section — Resolution rules row uses `Info` icon (`CircleQuestionMark` retired)
- ✅ Local transient toast pill pinned to the bottom of the page (mirrors `screens.jsx:1919-1923`)
- ✅ About line — `VICI · v{version} · Build {sha}` driven by `__APP_VERSION__` + `__BUILD_SHA__` injected via vite `define`
- ✅ Sign-out inline confirm — replaces the bare Sign out button with a confirm card (question + Cancel / Sign out)
- ✅ Delete flow — "Continue →" arrow glyph on the reason → confirm step
- ✅ Delete flow — Pause 30 days / Contact us mini-buttons wired in the retain block; both close the flow with their respective side-effects (toast / `/info/contact` route)
- ⏭ (C-20 keep) Blocking-leagues link list retained — production safety (transfer ownership before delete)
- ⏭ (C-21 keep) Transfer-ownership UI retained — production need; backend shipped via `transferLeagueOwnership`

### Account settings (8) ✅ commit `<account>` (partial — auth-scope-blocked) · revert commit `ac6dcc8` (C-23)

- ✅ C-23 STRIP — provider-specific 44×44 glyph tile (multi-color Google G / IC Fingerprint) reverted to a bare intro row. The green `VERIFIED` chip beside the email was also stripped. Locked decision: prototype-parity intro is bare; SSO-verified state is implicit. The three keys `account.method.google`, `account.method.ii`, `account.email.verified` were removed from all 7 locales.
- ⏭ Switch method — kept single signout button; the prototype's 3-button stack lists Apple + Google + magic-link, but Apple + magic-link are out-of-scope per locked auth decisions
- ⏭ Email card — edit flow (input + Send magic link + sent confirmation); blocked by magic-link backend out-of-scope
- ⏭ Padding bottom — kept current; prototype's 32px vs our 96px difference accepted

### Notifications (8) ✅ commit `<notifications>`

- ✅ Right action — text-only "Mark all read" ghost (allcaps eyebrow font, no border-box)
- ✅ Back destination — Flow (not Settings); back-arrow is borderless ghost
- ✅ Empty state — Bell icon stroke 1.4 + serif-italic + dim body (was already correct)
- ✅ Notification card layout — accent border + dot when unread; 32×32 icon tile (already matched)
- ⏭ Empty filter for zero-call users — depends on `combinedInboxStore` filtering; deferred (inbox is mocked)
- ✅ Tap routing — kind-driven via `notification.href` (already wired)
- ✅ i18n: `notifications.back_settings` → `notifications.back_flow` × 7 locales

### Album (9) ✅ commit `<album>`

- ✅ App bar — "My album" title (existing `album.title` key)
- ✅ Progress card — accent tokens (`var(--color-primary)`)
- ✅ Awards — glyph emblems (◎ ★ ⚡ ⧖ ◐ ⌘) replace lucide icons
- ✅ Tier classes — gold/silver/bronze CSS washes
- ⏭ Award definitions — sharpest-eye/bold-caller/league-founder/top-decile NOT added (requires `evaluateAchievements` extension; tracked as follow-up)
- ✅ Bottom-sheet modal — 64×64 tier-styled emblem tile
- ✅ Detail copy — rich multi-sentence prose (new `.detail` i18n key per achievement, 6 keys × 7 locales)
- ✅ Remove `+XP VXP` prefix on detail
- ✅ Position absolute within screen (not fixed inset)
- ✅ Knock-on: `ProfileDashboard` achievement-rail tiles also use glyph emblems + tier classes (replacing lucide icons)

### Social tabs container (3) ✅ commit `<social-tabs>`

- ✅ Tab strip — underline-active style (2px primary underline, no pill background)
- ✅ Tab persistence — already correct; `$effect` writes `'friends'` back to storage after legacy migration
- ⏭ Tab-aware `+` — kept the global `leaguesCreateIntent` store pattern (intentional cross-component signal)

### Friends (7+) ✅ commit `c69ecfd`

- ✅ Invite hero card — `FriendsTab.svelte` opens with a hero section that pulls the viewer's referral code via `getMyReferralCode()`, renders the `+500 VXP` mono eyebrow + `for both of you` suffix, serif-italic title, monthly bonus-cap line, and the Share / Copy row (Share via `navigator.share` with clipboard fallback; Copy swaps to `Copied ✓` for 1.8s via `writeToClipboard`). URL preview strips the scheme to keep the mono `host/signup?ref={code}` glance.
- ✅ Pending invites section — uses the existing `friendRequestsStore` (received) under a `Pending · waiting for first call` eyebrow; each row expands to inline Accept (`var(--yes)`-tinted) / Reject buttons, wired to the same `acceptFriendRequest` / `rejectFriendRequest` services. A separate `Awaiting reply` section surfaces `sentFriendRequestsStore` (lower-priority, no expand) with an inline Cancel.
- ✅ Friends-ranked list — `rankedFriends` $derived sorts the friend roster by accuracy desc; each row renders the `01`/`02`/… padded mono rank, avatar, `@{nickname}`, `{acc}% · {streak}d` meta, and the h2h delta chip (`var(--yes)` wash when the viewer leads, `var(--no)` wash otherwise). A sticky `YOU` row pinned via `position: sticky; bottom: 5rem` sits below; tapping a row opens the friend mini-profile sheet.
- ⏭ Friends feed list — Deferred: no `getFriendsFeed` service today; the surface renders the prototype's `Recent activity` eyebrow + the serif-italic quiet copy as a placeholder. 👏 reactions also deferred (no per-event reaction model yet). Tracked with an in-line `TODO:` so the next pass picks it up when the satellite ships an activity stream.
- ✅ Global ranking link with delta — bottom CTA card derives `myRank` from the cached `$leaderboard` derived store (`indexOf` viewer's principal + 1) and links to `/social/leaderboard`. ⏭ The week-over-week `↑ N` delta is deferred — no `previousRank` snapshot exists satellite-side; an in-code comment documents the gap.
- ✅ Friend mini-profile sheet — inline bottom-sheet pattern (custom scrim + sheet, since the shared `Modal` is a centered dialog only). Surfaces `Accuracy / Streak / VXP` stat tiles, the h2h `You lead by {delta} pts` / `Behind by {delta} pts` line tinted yes/no, and a destructive `Remove friend` button wired to `unfriendUser` + `refreshFriendRelations`.
- ✅ Add-by-handle bottom sheet — `@`-prefixed pill input with a "Find by handle or principal" blurb and an invite-by-link footnote (`No matches yet. Invite by link gets both of you {amount} VXP.`). Submits through to `sendFriendRequest`; the satellite still keys by principal text today (nickname resolution lands in a follow-up), so the visual `@` is the UX cue while the input accepts either form.
- ✅ (Tier C-27) Standalone `/friends` route dropped — `src/routes/(app)/friends/+page.svelte` + `FriendsPage.svelte` + `FriendsList.svelte` deleted, `AppPath.Friends` removed from the enum, `MobileNav`'s cascade table tightened (Social no longer aliases `/friends`), the inbox bell's `friend_request` action item now points at `AppPath.Social` so the Friends tab restores from `vici.social-tab`, and `DashPage`'s referral CTA jumps straight to `/social`.

### Leagues list (~10) ✅ commit `<leagues-list>`

- ✅ Appbar `+` only — `LeaguesPage` no longer renders the Create/Join pill row above the list; the Social shell's appbar `+` is the only top-of-page entry point, with trailing CTA cards picking up the slack at the end of the list.
- ✅ Founded/Joined card classification — rows are partitioned by `role === 'owner'` into two sections ("Your leagues · Admin" / "Leagues you're in") via `$derived` filters in `LeaguesPage.svelte`.
- ✅ League-logo-sm gradient + emblem character — new `LeagueListCard.svelte` renders a 2.5rem tile with `linear-gradient(160deg, {accent}33, {accent}11, var(--bg-surface))` and an emblem derived from the league name's first code point (uppercased; falls back to `◆` for non-alphabetic names).
- ✅ Friend overlap row — `friendOverlapFor` intersects each league's `listLeagueMembers` roster with `friendsListStore.participants` and the row renders an avatar dot + `@{handle} + N friends` line (singular/plural keys, profile-cache hydrated via `loadProfilesByPrincipals`).
- ✅ Latest-activity preview — derived from `listLeagueBouts`: trailing non-resolved bout's `{state}: bout vs {opponent}` (opponent resolved against the caller's own membership list when possible; truncated id otherwise). Bouts have no `created_at` on the wire schema, so sort is by `kickoffMs`.
- ⏭ Trend chip (↑/↓ rank delta) — Deferred: no historic rank-delta storage on the satellite. The chip needs a `previousRank` snapshot we don't capture today, and synthesizing one from a deterministic seed would lie about real data. Tracked as follow-up requiring a satellite write.
- ✅ Inline copy-invite pill — `LeagueListCard` ships a copy pill on the trailing edge that writes `vici.market/league/{inviteCode}` to the clipboard, swaps to a `Check` glyph + "Copied" for 1.5s, and uses `role="button"` + key handler to stay accessible inside the parent button row without nesting buttons.
- ✅ Trailing "Create a league" + "Join with code" CTA cards — new `LeagueCtaCard.svelte` renders the two end-of-list entries (Plus glyph for create, JOIN mono badge for join), tile-styled to match the league-row shape.
- ⏭ Recommendations section ("Friends are in") — Deferred: the satellite has no listing for leagues the caller isn't already in, so the "friends here, you're not" overlap can't be computed without a new query endpoint. Strings + card variant are scaffolded; UI ships when discovery lands.
- ✅ Empty-state — `LeaguesPage` empty branch renders serif-italic accent quote ("Leagues are private.") + dim body + a centered two-button row (primary "Create a league" + ghost "Join with code"). Replaces the previous title + sub + ctas stack.

### League detail (~10) ✅ commit `a3ae2bf`

- ✅ Head card gradient logo + emblem + N° corner badge — `LeagueDetailPage` head renders an 88px `--accent-grad` tile with the league emblem (derived from the first code-point of `league.name`) and a `N°{NN}` mono corner pinned to the caller's roster index.
- ✅ "{memberCount} members · {size} LEAGUE" line — head meta uses `leagues.detail.head_meta_one/many` interpolated with `{count}` + a derived size token (`size_xs/s/m/l` bucketed by roster headcount, since no server-side tier field exists yet).
- ✅ Inline Invite + Predict buttons in head card — ghost "Invite" pill (writes `vici.market/league/{inviteCode}` to clipboard, swaps to "Copied" for 1.6s) + primary "Predict ›" button that routes to Flow.
- ✅ LeagueBoutSection — eyebrow + active-bout card (in_flight / accepted / proposed picked in that priority) with inline state chip, kickoff→settle window, and the owner's accept / kickoff / resolve / retract affordances inlined. Empty state renders the dashed "No active bout." card with a "Challenge another league →" CTA for owners.
- ✅ Members folded into the leaderboard — the standalone sticker grid is retired. Roster (sorted self → owner → admin → member, join-asc within bands) renders as the leaderboard rows themselves, so members + ranking live in a single list.
- ✅ Leaderboard card w/ This week / All time tabs + top-6 + sticky YOU — segmented tabs styled to match the `lb-tabs` shape; top-6 rows are ≥44px `<button>` tap targets (rank · unified `<Avatar>` · handle · streak · accuracy) that open a member detail `BottomSheet` (avatar + accuracy / streak stat grid). Gold/silver/bronze rank colors on positions 1–3; a sticky YOU row drops below when the caller's outside the top-6. Tab state is wired (both views render the same roster projection today; per-period stats can drop in once the satellite carries them). Under four members a "just getting started" recruit prompt with an Invite CTA replaces podium theatre.
- ✅ Activity feed card — derived from `bouts` (newest first by kickoff/settle, capped at 6). Each row interpolates a verb key (`activity_verb_proposed/accepted/in_flight/resolved`) with the opponent league id, then trails a state chip + relative date.
- ✅ ChallengeLeagueModal — new `ChallengeLeagueModal.svelte`. Invite-code-driven opponent picker (we don't expose a public league directory yet) → 7 / 14 / 30-day duration segmented control → wraps `lookupLeagueByInvite` + `proposeBout`, the same services `ProposeBoutModal` uses. Wires the legacy `?propose=1` deep-link onto the new sheet so older shares still land.
- ✅ Settings cog in appbar — **removed**. A global `/settings` shortcut doesn't belong on a league surface; league detail no longer renders an appbar settings cog.
- ⏭ (Tier C-22) Transfer ownership CTA + modal — kept; production safety net, backend shipped. Restyled inline with the new controls row alongside the leave-league CTA, but the surface remains.

### Bouts inbox (~8) ✅ commit `dcf514d`

- ⏭ "What's a bout?" intro card (dismissible) — shipped with the prototype's `localStorage['vici.bouts-intro-seen']` flag rather than cross-device `preferences`. Migration to the profile `preferences` blob requires extending the satellite Candid + Rust binding (a new field on `app_get_profile`'s strict preferences record), which is out of scope for the parity pass. The dismissible UI is live; the flag carrier is the deferred portion.
- ✅ Worlds Universities grouped card — featured WC podium (top-3 by lifetime accuracy off `listAffiliationStats({ kind: 'university' })`) + monthly compact card. Deep-links into `/social/worlds/schools` and `/social/worlds/schools?scope=month`.
- ✅ Worlds Countries grouped card — same shape, sourced off `listAffiliationStats({ kind: 'country' })`. Glyph + flag rendered from `WORLDS_COUNTRIES`. Deep-links into `/social/worlds/countries`.
- ✅ Monthly Tournament curated card — pulls from `getCurrentTournament` + `TOURNAMENT_ROUNDS`. Renders only when at least one round has unresolved matches whose window is still open (`tournamentLiveRound !== null`). Surfaces the live round chip (`Round 1` / `Quarterfinal` / `Semifinal` / `Final`) plus a "your league is in" row when the caller's league is still in the bracket.
- ✅ Group by surface (Worlds Universities / Worlds Countries / Tournament / your league bouts) — state grouping (`in_flight`/`accepted`/`proposed`/`resolved`) removed. League bouts now render in a single state-sorted list (in_flight → accepted → proposed → resolved) inside the `Your league bouts` section.
- ✅ Removed top-level "Create bout" pill — the page header now only carries the sub-copy. The CTA lives on the right of the `Your league bouts` section eyebrow as a `+ Challenge` pill, matching `BoutsScreen.bouts-section-head-secondary`.
- ✅ Side chip style — emblem-tinted (`color-mix(in srgb, var(--side-accent) 13%, transparent)` background, 30% accent border) so each league's `accentColor` reads on the chip.
- ✅ Group items end with "see all →" / "see full standings →" affordance — Worlds monthly cards close with `See full standings →`, Tournament card closes with `Open bracket →`, and the league-bout list collapses to 4 items with a `See all {n} →` toggle.

### Tournament (~3) ✅ commit `<tournament>` · re-audit commit `cc6b2cb` (C-26)

- ✅ Bracket diagram styling — match-meta row now has three branches (concluded → date + winner →; live → "LIVE · ends {date}" in purple; upcoming → "upcoming · {date}" muted)
- ✅ Round chip color (#b49cff) — hero current-round tag + live-match border + live-meta text all use the tournament accent
- ✅ Live timer — days-left chip in hero head when a round is in flight; re-ticks every minute via `$effect` interval

#### Re-audit findings (C-26)

Surveyed `TournamentPage.svelte` against `screens.jsx:3657-3752`
(`TournamentBoutDetail`) to catch hidden divergences after the
initial port. Findings:

- ✅ Hero gradient — was a flat tinted background; now a top-down
  `linear-gradient(180deg, rgba(180,156,255,0.14), transparent 70%)` over
  `var(--bg-surface)`, mirroring the prototype's `card-elevated`
  inline gradient (`screens.jsx:3681`).
- ✅ Headline bracket size dynamic — was a hard-coded `"16-league
single-elimination bracket"`; now reads `tournament.bracketSize`
  from the loaded `TournamentDoc` (falls back to
  `TOURNAMENT_BRACKET_SIZE` when nothing is loaded yet). 7-locale
  `tournament.headline` strings re-parameterised with `{size}`.
- ✅ Prize-tier place glyph — was the numeric `1`/`2`/`3` in mono;
  now the medal emoji 🥇/🥈/🥉 at h2-scale, matching the prototype's
  `{p.label.split(' ')[0]}` t-h2 glyph (`screens.jsx:3741`). The
  numeric place is now `aria-hidden` to keep the surface clean.
- ⏭ App-bar title — prototype shows `T.name` ("May Tournament Bout",
  dynamic month). We render the static `tournament.title` key. The
  month-name surface isn't on `TournamentDoc` (only `id` / `monthMs`)
  — a follow-up could derive it from `monthMs` via `localeStore`.
- ⏭ Title alignment — prototype centers the app-bar title at
  `fontSize: 17, letterSpacing: -0.01em`. `MobileAppBar` is always
  `align="left"`. Different appbar pattern; treat as accepted
  cross-app divergence.
- ⏭ Headline serif-italic accent on "bracket" — prototype splits
  the headline so `bracket` renders in `serif-italic acc`. Skipped
  because the equivalent end-word differs per locale ("directa" /
  "directe" / "diretta" / "simples" / "Ligen" / "单淘汰赛"), and a
  forced split would read awkward.
- ⏭ Dynamic personalised hero sub — prototype shows
  `{remaining} leagues remain. {myLeagueName} is alive at #{yourLeagueRank}.`
  or "Your league did not enter this month." We surface a static
  evergreen sub (`tournament.sub`). Wiring the my-league derivation
  - remaining-count needs new selectors over `matches`; tracked as
    a follow-up.
- ⏭ `is-mine` styling — prototype tags any match containing the
  viewer's league with `is-mine` for emphasis. Needs the same
  my-league context as the dynamic sub; deferred together.
- ⏭ Prize tiers — sticker sub-line ("Exclusive {sticker} sticker")
  not shown. We don't have a sticker model in the satellite; the
  visual moment is deferred until the album surface gets a per-tier
  sticker registry.
- ⏭ Section headers — prototype uses `section-h h3` blocks for
  "Bracket" and "Prizes"; we use the existing `eyebrow h2` pattern
  used elsewhere in the app for cross-surface coherence. Treat as
  accepted cross-app pattern.
- ⏭ Bottom padding — kept at `6rem` for the mobile nav; prototype's
  `24px` would clip under the mobile tab bar.

### Worlds (~7) ✅ commit `d80bf4b`

- ✅ Hero event card — `FIFA WORLD CUP · Live` tags + WC Bout title + top-3 podium tiles (`.worlds-event` + `.worlds-pod-tile.is-gold/silver/bronze`); top-3 driven by lifetime accuracy on `listAffiliationStats({ kind: 'university' })`
- ✅ Scope toggle — `{month} season · all calls` / `WC Bout · {N}d left` (`.worlds-scope`); `{N}d left` reads new `daysToFinal` derived off `featuredEvent.finalAt_ms`, falls back to `archived` copy when the event has wrapped
- ✅ Top-6 leaderboard with school glyph + `{calls} calls` eyebrow + sticky YOU row — sticky `.worlds-you-sticky` row pins to bottom when the user's affiliation is outside the visible window; expand/collapse via `See all {N} schools →`. Members count omitted (no aggregated `members` on `AffiliationStatsDoc` — defer until per-affiliation roster aggregator lands)
- ✅ Affiliation prompt — "Where did you study?" card (`.worlds-affil-prompt`) shown only when the user has no `university` affiliation; opens `AffiliationPickerModal` (school kind)
- ✅ Removed worlds-podium prize card (legacy `+gold/silver/bronze` prize-tiles preview block deleted from `WorldsPage`; still rendered on `WorldsBoutDetailPage` where the editorial moment belongs)
- ✅ Removed locked-card UI — old per-slot `.worlds-locked-card` with leave CTA gone; the lock is now invisible to the user (still enforced by the satellite assert) and switching happens via the picker after expiry. Country slot picker entry retained for Profile (no Worlds-page surface)
- ✅ (Tier C-29 keep) Podium prize claim banner retained — `tryClaimPodium` fires on every mount, surfaces the `.worlds-podium-claim` toast when `awardsCreated > 0`. Re-skinned to laurel-tone to match the prototype palette without inventing a parallel claim flow

### Leaderboard (~5) ✅ commit `<leaderboard>`

- ✅ Scope tabs — `This week / This month / All time` (3 tabs, chip-style) replace `Global / Week / Friends / Activity` (4 tabs, pill-bg)
- ✅ Drop ActivityFeed sub-component (not in prototype)
- ✅ Drop friends-only filter (lives in Friends tab inside Social per the prototype)
- ✅ Single-column layout — podium row + flat list (vs split-column with right activity rail)
- ✅ Rank stripes — `is-first` (gold halo on #1), `is-you` (primary accent on viewer's row), both on podium tiles + rest rows
- ⏭ Mini-profile sheet on row tap (prototype's `screens.jsx:1246-1269`) deferred — friends-add backend wiring for non-friends needed

### Info / legal (~3) ✅ commit `<info>`

- ✅ Typography — serif-italic lede + sans body @ 1.65 line-height + 600-weight inline headings
- ⏭ TOC sidebar — prototype has no TOC sidebar; accept current flat scroll
- ✅ Eyebrow — primary accent colour + 0.16em letter-spacing
- ✅ Bonus: custom accent-dot list bullets, mono mailto with faint primary underline, bottom back-to-Welcome divider + ghost button

### Modals (~6 + 1 missing) ✅ commit `059736c`

- ✅ CreateLeagueModal — ported to new `BottomSheet` primitive (grip handle, blurred backdrop, safe-area inset, 22px top corners)
- ✅ JoinLeagueModal — ported to `BottomSheet`
- ✅ CreateBoutModal — ported to `BottomSheet`; inner padding trimmed so sheet horizontal padding owns the layout
- ✅ AffiliationPickerModal — ported to `BottomSheet`; added in-sheet kind toggle (Uni / Country segmented control under the title), `kind` prop now seeds the initial tab while letting the user switch in-sheet
- ✅ ChallengeLeagueModal — already shipped in commit `a3ae2bf`; ported to `BottomSheet` in this pass so it follows the same grip-handle pattern as the other 4
- ⏭ Remove ResolveBoutModal — KEEP. Used by `LeagueDetailPage`, `BoutDetailPage`, and `BoutsInboxPage`; the explicit scoreboard preview (us / them / draw) is the production resolution surface. Inferring resolution from state would require reworking all three callers; tracked as future C-item, not a parity blocker
- ⏭ Remove TransferOwnershipModal — KEEP (tier C-21/22 production need); already shipped on this branch (working copy `TransferOwnershipModal.svelte`)

## Total

**~270 divergences across 24+ surfaces. ~2-4 weeks of focused work.**

This PR will land them in separate commits as each surface gets its
parity pass. Tier-C decisions are resolved one at a time before the
relevant commit drops.
