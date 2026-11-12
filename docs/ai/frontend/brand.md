# Brand

Canonical Claude/agent reference for the VICI visual identity: palette,
typography, voice & tone, iconography, character cast, and copy patterns.
Distilled from the off-repo brand book.

> **Per the off-repo brand book:** when an in-repo rule disagrees with
> this document, **this document wins** (and the divergence is a bug to
> reconcile). When this document disagrees with what the implementation
> ships, treat the implementation as the deviation, not the spec.
>
> **Companion docs:**
>
> - [`design.md`](./design.md): surface roster, component / screen
>   status, Flow Mode rules, market metadata.
> - [`stack-and-patterns.md`](./stack-and-patterns.md): Tailwind v4
>   token usage; no `[var(--token)]` arbitraries.
> - [`reusability.md`](./reusability.md): shared component catalog.

---

## 1. Brand position

VICI is a consumer prediction platform. Three layers in one product:
prediction markets, gamified UX, a reputation system where accuracy is
status. The wedge is **entertainment-first onboarding**: Flow Mode,
swipe-based, free. Real-money markets and deep liquidity come later.

**Four layers, deliberately separated.** They are named in code, in copy,
and on marketing surfaces with these exact words:

1. **Trading.** Stablecoins. Regulation-friendly.
2. **Protocol.** Open prediction markets.
3. **Reputation.** Accuracy. VXP. The silent competition.
4. **Coordination.** The VICI token. Governance, not payment.

**The collision that makes the brand:** classical editorial typography
(Instrument Serif) meets terminal/data mono (JetBrains Mono). Restraint
in everything else.

---

## 2. Voice & tone

> Confident, terse, slightly classical. Treats the user as a competitor,
> not a customer. Never apologises. Never explains twice. **Length is the
> enemy of confidence.**

### 2.1 Four principles

1. **Direct & declarative.** Second person, present tense, no hedging.
   _"You called it."_
2. **Imperative for actions.** Buttons are commands, not invitations.
   _"Predict." "Stake." "Lock in."_
3. **Confident, not cocky.** Earns gravitas by being short. _"Locked in."_
4. **Latin, sparingly.** A drop-cap of classical posture, never cute.
   _"Veni." / "Vici."_

### 2.2 Calibration table

| ✘ Don't                                  | ✓ Say                         |
| ---------------------------------------- | ----------------------------- |
| Click here to make your first prediction | Predict.                      |
| Oops, looks like the market closed.      | Market closed. You missed it. |
| Congratulations on your win!             | Called it. +240 VXP.          |
| Your prediction has been submitted.      | Locked in.                    |
| Great job!                               | _(say nothing; let XP speak)_ |

Affirm, don't narrate. A line earns its place by adding something a
number can't.

### 2.3 No emoji, ever

Quoting the source: _"No emoji, ever. Use a glyph (·, →, ↑, ↓) or a
small icon. The brand carries weight by what it omits."_

**Approved typographic glyphs** (use these in copy and in compact UI):

```
·   →   ↑   ↓   ∞   ◎   ★   ⚡   ⌬   ⊿   ✦   ◐   ⧖   ⌘   ✓   —
```

**Forbidden in user-facing surfaces:**

- 🔥 → use [`StreakFlame`](../../../src/lib/components/characters/StreakFlame.svelte)
  or `FlameChar.svelte` (the animated character).
- 🥇🥈🥉 → use a tabular rank numeral (`1` / `2` / `3`) on a tinted chip.
- 📈 → use `↑` glyph or an icon component.
- 👤 → use the user's initials in an avatar tile, or
  [`IconRobot`](../../../src/lib/components/icons/IconRobot.svelte) for
  anonymous principals.
- 🎉 ✨ 🏆 etc. → no celebratory pictographs. Let XP, copy, and motion
  carry the moment.

Country flags **now render via
[`CountryFlag.svelte`](../../../src/lib/components/ui/CountryFlag.svelte)**,
a `<img>` backed by the lipis/flag-icons 4x3 SVG set shipped under
[`#lib/assets/flags/`](../../../src/lib/assets/flags/) and indexed
through [`COUNTRY_FLAGS`](../../../src/lib/constants/country-flags.constants.ts).
Same pattern as the `control-panel` repo. Pass the ISO-3166 alpha-2
code (e.g. `<CountryFlag countryCode={team.id} />`). The emoji `glyph`
strings still on country records in
[`worlds-affiliations.constants.ts`](../../../src/lib/constants/worlds-affiliations.constants.ts)
and
[`featured-event.constants.ts`](../../../src/lib/constants/featured-event.constants.ts)
are now unused at render time and can be stripped on the next data
migration. **Never set a coloured background box behind a flag**: flags
are already colourful and a tinted tile muddies them. Render the flag on
the surface itself (a transparent layout container is fine); the country
slot, picker, battle rows, and onboarding previews all follow this.
Achievement emblems (`◎ ★ ⚡ ⌬ ⊿ ✦ ◐ ⧖ ⌘` in
[`achievements.constants.ts`](../../../src/lib/constants/achievements.constants.ts))
are part of the approved glyph set and stay.

### 2.4 Copy snippets that are canonical

These are brand-set strings: keep them word-for-word and don't
"improve" them:

- `Veni. Vidi. Vici.`: colophon, share footers, OG meta.
- `Predict.`: primary CTA on cold surfaces.
- `Earn the laurel.`: onboarding / push framing.
- `The market doesn't know what you know.`: landing register.
- `Locked in.`: post-commit confirmation.
- `Called it. +N VXP.`: correct-resolution toast.
- `Market closed. You missed it.`: closed-state empty.
- `Nothing here. Yet.`: empty-deck companion line.
- `Fresh start.`: streak-break banner (paired with the ended stage).
- `Bold.`: Trickster opener when going against the crowd.

**Affiliation slot labels** (`profile.dashboard.affiliations.*`): personal,
possessive framing rather than dry category nouns: **Alma Mater** (university:
the Latin-sparingly principle in action; kept Latin across locales), **Citizen**
(country), **Residence** (city), **Workplace** (company). The picker still uses
the plain category nouns (`worlds.picker.*`: "University", "Country").

---

## 3. Logo

The wordmark is **type-set**, not custom letterforms. It travels as
text. In product, it ships as a `<span>`:
[`Logo.svelte`](../../../src/lib/components/layout/Logo.svelte): not
as artwork.

### 3.1 Type-set spec

| Property         | Value                                         |
| ---------------- | --------------------------------------------- |
| Family           | `Hanken Grotesk`                              |
| Weight           | `700`                                         |
| Case             | `ALL CAPS`                                    |
| `letter-spacing` | `0.18em`                                      |
| Italic / skew    | **Never.**                                    |
| Effects          | No gradient, glow, drop shadow, or bevel.     |
| Lockups          | No tagline lockup. Mark stands alone.         |
| Tracking variant | Tracking is locked at 0.18em; do not deviate. |

### 3.2 Two colour variants, only

| Variant  | Use on         | Token         | Hex       |
| -------- | -------------- | ------------- | --------- |
| Primary  | Light surfaces | `--ink`       | `#0E0D0B` |
| Reversed | Dark surfaces  | `--parchment` | `#F2ECDC` |

Pure `#FFFFFF` and pure `#000000` are **not** used. **Laurel gold
(`#E2B842`) is reserved for the app-icon tile only**; never tint the
wordmark or monogram with it. Italic-laurel _"VICI."_ in the sign-in
title is an editorial moment in serif, not a recolouring of the mark.

### 3.3 Six application surfaces

The wordmark + V monogram cover every surface VICI wears:

1. **Favicon · browser**: ink tile, gold V, 14 px radius.
2. **Web push / notification**: favicon + in-the-moment voice.
3. **Social avatar**: round + square / profile + OG.
4. **Product & landing · dark**: reversed wordmark on ink.
5. **Product & landing · light**: primary wordmark on parchment.
6. **Share / OG card**: 1.91:1, dark, with ticker.

Min digital height: 24 px (wordmark) · 16 px (monogram). Min print:
12 mm (wordmark) · 8 mm (monogram). Clear space = the height of the
**I** stem on all four sides.

> The wordmark is `BETA` in the source book; final letterforms TBD
> before public launch. Everything else (palette, type, characters,
> motion) is locked.

---

## 4. Palette

### 4.1 Foundation: warm-not-cool, marble at dusk

Backgrounds carry a slight brown/bronze undertone. Foreground is
parchment cream, never paper-white. **One gold for the brand. One red
for editorial. Nothing else.**

| Role               | Name         | Hex       | Token            |
| ------------------ | ------------ | --------- | ---------------- |
| Primary canvas     | Ink          | `#0E0D0B` | `--ink`          |
| Hero wash          | Ink Deep     | `#080705` | `--ink-deep`     |
| Cards              | Ink Raised   | `#16140F` | `--ink-raised`   |
| Sheets / elevated  | Ink Elevated | `#1E1B14` | `--ink-elevated` |
| Primary foreground | Parchment    | `#F2ECDC` | `--parchment`    |
| Singular accent    | Laurel       | `#E2B842` | `--laurel`       |
| Editorial          | Terracotta   | `#B5462C` | `--terracotta`   |

`--laurel-deep` (`#B68B1F`) is the deeper-laurel sibling used in light /
peach themes where pure laurel reads thin.

### 4.2 Signals: three states, nothing between

Every prediction surface resolves to one of three. **Never invent a
fourth signal**: use weight, opacity, or border treatment for other
states. Each signal ships with a 12%-opacity wash for chips and pills.

| State                  | Name | Hex       | Token    | Wash token    |
| ---------------------- | ---- | --------- | -------- | ------------- |
| UP · CORRECT · CONFIRM | Yes  | `#4FD3A1` | `--yes`  | `--yes-wash`  |
| DOWN · WRONG · DENY    | No   | `#FF6B6B` | `--no`   | `--no-wash`   |
| PAUSE · DATA · NEUTRAL | Hold | `#6B9FFF` | `--hold` | `--hold-wash` |

In Tailwind, write `text-yes`, `bg-no-wash`, `border-hold`. Never reach
for `text-[var(--yes)]` or arbitrary hexes; see
[stack-and-patterns rules](./stack-and-patterns.md#tailwind-v4--design-tokens).

### 4.3 Appearance modes

Three modes via `data-theme` on `<html>`. Theme state lives in
[`src/lib/stores/theme.store.ts`](../../../src/lib/stores/theme.store.ts);
the canonical picker is
[`AppearancePicker.svelte`](../../../src/lib/components/ui/AppearancePicker.svelte).

| Mode    | Register                              | Accent rule                                                        |
| ------- | ------------------------------------- | ------------------------------------------------------------------ |
| `dark`  | The default. Marble at 2 a.m.         | `--laurel` pure.                                                   |
| `light` | Editorial alternate. Parchment / ink. | `--laurel` pure. Soft drop-shadow elevation; "The Economist".      |
| `peach` | Warm coral blush.                     | `--laurel-deep` (`#B68B1F`) so gold holds contrast on warm canvas. |

### 4.4 Extended palettes (in product, off-book)

These extend the brand for surfaces the source book doesn't cover.
Live in [`src/app.css`](../../../src/app.css):

- **Category tags** (`--cat-macro`, `--cat-crypto`, …): used to tint
  market category chips and FlowArt seeds. Not foundation; can be
  retuned per category without touching brand.
- **Character accents** (`--char-vici`, `--char-oracle`, …): see §6.
- **Generative artwork palettes** in
  [`flow-art.utils.ts`](../../../src/lib/utils/flow-art.utils.ts):
  per-category, per-theme, per-state (neutral / won / lost). The brand
  accent in those palettes always resolves from `--laurel` /
  `--laurel-deep`.

Third-party marks (Juno, Internet Computer, Google, Apple, sports
team colours) **keep their own brand colours** in every theme. Don't
recolour them with VICI tokens.

---

## 5. Typography: Serif. Sans. Mono.

A strict triad. Editorial italic for big moments, warm grotesk for UI,
tabular mono for every probability, timestamp, address, and VXP value.
Mixing within a line is on-brand: _"You were"_ early. _"By"_ 4 hours.

### 5.1 The three families

| Role      | Family             | Where it lives in CSS |
| --------- | ------------------ | --------------------- |
| Editorial | `Instrument Serif` | `var(--font-serif)`   |
| UI        | `Hanken Grotesk`   | `var(--font-display)` |
| Data      | `JetBrains Mono`   | `var(--font-mono)`    |

All three are self-hosted under `static/fonts/`; see the `@font-face`
block at the top of [`src/app.css`](../../../src/app.css).

### 5.2 Type roles

| Role           | Family | Spec               | Helper class               |
| -------------- | ------ | ------------------ | -------------------------- |
| Hero (display) | Serif  | 88 / 128 italic    | `.display`                 |
| Section        | Serif  | 64 / 44            | `.display` (size override) |
| Pull-quote     | Serif  | 32 / 24            | `.serif-italic`            |
| Body           | UI     | 16 / 12            | _Tailwind default_         |
| Eyebrow        | UI     | 11 / 12, allcaps   | `.eyebrow`                 |
| Allcaps tag    | UI     | 12, wide tracking  | `.allcaps`                 |
| Body weights   | UI     | 400 → 700          | -                          |
| Odds           | Data   | tabular, slashed 0 | `.num`                     |
| Hero numeric   | Data   | 128 / 1            | `.display-num`             |
| VXP delta      | Data   | `+240 VXP`         | `.num`                     |
| Volume         | Data   | `2.4M vol`         | `.num`                     |

Every probability, timestamp, principal address, and VXP value uses the
`.num` class (or one of its display siblings) so digits stay tabular
and `0` reads slashed.

---

## 6. Iconography

### 6.1 System

> **One style. Stroke 1.6. No emoji.**

A single Lucide-style family, custom-drawn for consistency at 1.6
stroke. Brand-specific glyphs (laurel, signals, flame, VXP-chevron)
sit alongside. Unicode (`· → ↑ ↓ ∞`) is typographic and is encouraged
in copy.

Canonical icon vocabulary (per the source book's icon grid):

```
laurel · signal-yes · signal-no · signal-hold · flame · vxp-chev ·
flow · market · profile · ranks · wallet · search · clock · bell ·
target · lock
```

In the repo, branded glyphs live in
[`src/lib/components/icons/`](../../../src/lib/components/icons/):

- [`IconSignalYes`](../../../src/lib/components/icons/IconSignalYes.svelte)
  / `IconSignalNo` / `IconSignalHold`
- [`IconIC`](../../../src/lib/components/icons/IconIC.svelte) /
  `IconGoogle` / `IconPasskey` / `IconRobot`

The streak flame is
[`StreakFlame`](../../../src/lib/components/characters/StreakFlame.svelte),
in `characters/` next to `FlameChar.svelte`.

For everything else, reach for `@lucide/svelte`, the project standard.
When you add a bespoke brand glyph, register it in
[`reusability.md`](./reusability.md).

### 6.2 The menu toggle (2-stroke)

The hamburger / close menu is the one motion icon called out by the
source book:

| Property              | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Resting state         | Two horizontal strokes at `y=12`, offset `±3 px`              |
| Press behaviour       | Each line translates back to centre, rotates `±45°` into an X |
| `stroke-width`        | `1.8`                                                         |
| `linecap`             | `round`                                                       |
| `transition` duration | `240ms`                                                       |
| Easing                | `cubic-bezier(0.2, 0.7, 0.2, 1)` (matches `--ease-vici`)      |

---

## 7. Characters

The cast lives in the gamification layer. **Roles, not personalities.**
They never appear together as a team; each owns a single moment in the
loop and the rest stay off-stage. Archivist is held in v2 reserve.

| Character                | Role                                                                                                                 | Accent                          | Lives in                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **VICI**                 | Your guide. First launch, daily check-in, level-ups. _"Welcome back. 12 markets close today."_                       | `--char-vici` (#B7B0E8)         | [`ViciChar.svelte`](../../../src/lib/components/characters/ViciChar.svelte)                                                                 |
| **Oracle**               | Seer of outcomes. Resolution, weekly review, accuracy reports. _"You called it. The crowd was 18 h late."_           | `--char-oracle` (laurel)        | [`OracleChar.svelte`](../../../src/lib/components/characters/OracleChar.svelte)                                                             |
| **Trickster**            | Loves the contrarian. Appears only when you bet against the crowd. _"Only 18% agree. Bold."_                         | `--char-trickster` (warm coral) | [`TricksterChar.svelte`](../../../src/lib/components/characters/TricksterChar.svelte)                                                       |
| **Flame**                | Fuel of streaks. _"Twelve days. Don't break."_ Five stages: spark · ember · flame · blaze · inferno. **Never dark.** | `--char-flame`                  | [`FlameChar.svelte`](../../../src/lib/components/characters/FlameChar.svelte) + [`streak.utils.ts`](../../../src/lib/utils/streak.utils.ts) |
| Archivist _(v2 reserve)_ | -                                                                                                                    | `--char-archivist`              | -                                                                                                                                           |

Priority resolver, beat ordering, and motion choreography live in
[`design.md §7`](./design.md#7-flow-mode-rules). Don't restate it here.

---

## 8. Motion: restraint as a feature

The brand book's motion principles are mirrored in product as the
Flow-Mode rules. The headlines, repeated so they live near the brand:

- **Affirm, don't narrate.** A motion earns its place by adding
  something a number can't.
- **Scarcity protects meaning.** Routine swipes are silent on the
  character layer. Characters appear at milestones, state changes,
  and resolution events.
- **Speed is a feeling.** Reactive motion fires within 80–150 ms.
- **Defended territory.** Each character owns one moment. They never
  cross.
- **Negative states deserve motion.** None borrow celebratory
  vocabulary; none go silent.

**Overshoot is a budget, spent by frequency.** How a moment is allowed
to move depends on how often it happens:

- **Rare peaks**: an achievement unlock, an end-of-session celebration
  _may_ spring / overshoot. They fire seldom enough to earn the
  flourish.
- **Frequent rewards**: a call settling, a routine grant, settle
  **without** overshoot. Repetition turns a bounce into noise.
- **Direct-action confirmations**: a button press, a swipe commit,
  keep a **small tactile pop**: enough to read as "registered", never a
  full bounce.

**Reduced motion is non-negotiable.** Every animation and transition
must disable under reduced motion, idle loops, celebration beats, and
incidental transitions alike. Gate CSS with `@media
(prefers-reduced-motion: reduce)`; gate JS-driven Svelte transitions
with `prefersReducedMotion()` from
[`reduced-motion.utils.ts`](../../../src/lib/utils/reduced-motion.utils.ts).

Curves and durations live in [`src/app.css`](../../../src/app.css):
`--ease-vici`, `--ease-quick`, `--ease-stage`, and the `--d-*` /
`--dur-*` duration scale (the `MOTION PRINCIPLE` comment block sits
beside them). Named haptic patterns live in
[`haptics.utils.ts`](../../../src/lib/utils/haptics.utils.ts): call
them by name, never by raw ms.

---

## 9. Source-of-truth map

| Concern               | File                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette + type tokens | [`src/app.css`](../../../src/app.css)                                                                                                              |
| Wordmark              | [`Logo.svelte`](../../../src/lib/components/layout/Logo.svelte)                                                                                    |
| Logo & icon assets    | `static/branding/*`                                                                                                                                |
| Theme store + picker  | [`theme.store.ts`](../../../src/lib/stores/theme.store.ts) · [`AppearancePicker.svelte`](../../../src/lib/components/ui/AppearancePicker.svelte)   |
| Characters            | [`src/lib/components/characters/`](../../../src/lib/components/characters/)                                                                        |
| Branded icons         | [`src/lib/components/icons/`](../../../src/lib/components/icons/)                                                                                  |
| Generative artwork    | [`flow-art.utils.ts`](../../../src/lib/utils/flow-art.utils.ts) · [`FlowArtFrame.svelte`](../../../src/lib/components/artwork/FlowArtFrame.svelte) |
| Haptics               | [`haptics.utils.ts`](../../../src/lib/utils/haptics.utils.ts)                                                                                      |
| Sound                 | [`flow-sound.utils.ts`](../../../src/lib/utils/flow-sound.utils.ts)                                                                                |
| Flow Mode rules       | [`design.md §7`](./design.md#7-flow-mode-rules)                                                                                                    |
| Brand book (source)   | off-repo · request from the brand owner                                                                                                            |

---

## 10. Known surfaces that still drift

Treat this list as the brand-alignment backlog. When a row is closed,
move the entry to the matching section of [`design.md`](./design.md)
"Recent alignment commits" and delete it here.

| Surface                                                                                 | Drift                                                                         | Suggested fix                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`social-premium.constants.ts`](../../../src/lib/constants/social-premium.constants.ts) | Food/drink emoji presets (`🍕 🍺 ☕ 🥂 🍝`) used as the gift visual identity. | Replace with line-art glyphs from the icon family (coffee, beer, pizza, glass, pasta) or render the label only. Coordinate with the gifting flow. |
| Light/dark icon parity                                                                  | When new bespoke icons are added, confirm strokes hold at 1.6 in both themes. | Add a visual test once the test runner lands ([`testing.md`](./testing.md)).                                                                      |

---

## Meta

When the brand book is updated, refresh this file in the same PR and
note the new edition in the header. When the implementation diverges
from this file, the implementation is the bug; open an alignment PR
that updates the surface, not this doc.
