# Spec: Friend activity feed — reaction redesign (Zap)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#825)

## Goal

Replace the reaction affordance on each row of the Arena → Friends
"Recent activity" feed. The resting-state cue today is the `Sparkles`
glyph (a stand-in "clap"), which reads as celebratory confetti. The
redesigned reaction is a single tap-to-react **Zap** that lets you
acknowledge a friend's call, with a small on-brand commit motion.

The reaction style is **decided** (from the design artifact below):
Lucide `Zap`, `size={16}`, `strokeWidth={1.6}`; committed state in
`--laurel` (`color` + a 15%-opacity wash); a `tilt` commit animation on
the icon (`react-tilt`, 420ms `var(--ease-vici)`, reduced-motion gated)
plus a `--laurel` particle burst; single tap-to-react interaction (one
reaction per row, toggles on tap).

> The separate "show only friends' daily win/loss in a 24h window"
> change is **not** in this spec — tracing the data layer showed the
> friend feed has no per-friend win/loss source (the activity
> `SETTLEMENT` rows are admin market-resolution events, not friends'
> position outcomes). That work is split into
> [`2026-06-12-feat-friend-win-loss-feed.md`](./2026-06-12-feat-friend-win-loss-feed.md)
> (Draft, backend). This reaction redesign is independent of the feed's
> data source and ships on the current friend activity feed.

## Context

The feed and reaction live in
[`src/lib/components/arena/FriendsTab.svelte`](../../../../src/lib/components/arena/FriendsTab.svelte):

- The reaction button is ≈ lines 1001–1010:
  `<Sparkles size={15} strokeWidth={1.8} />` inside `button.feed-react`,
  toggled by `toggleClap` (≈ line 598) against the local-only
  `clappedKeys` `SvelteSet` (≈ line 594), with `haptic('light-tap')` on
  commit.
- `.feed-react` / `.is-clapped` styles are ≈ lines 1693–1724
  (transparent resting at `opacity: 0.45`, `--color-primary` wash on
  commit, `scale(0.92)` on `:active`).
- `Sparkles` is imported from `@lucide/svelte/icons` at the top of the
  component (line 4). `SvelteSet` is already imported (line 6).
- Copy key: `arena.friends.feed.clap` ("Clap") in
  `src/lib/constants/messages/en.ts:2156`, present in all 8 locale
  catalogs.

Brand constraints
([`docs/ai/frontend/brand.md`](../../frontend/brand.md)):

- §2.3 no emoji — Lucide glyph only (`@lucide/svelte` is the standard,
  §6.1, stroke 1.6).
- §4 `--laurel` (`#E2B842`) is the singular brand accent.
- §8 motion: a per-row reaction is frequent, so the commit keeps a
  small tactile motion, never a full celebratory bounce; reduced motion
  is non-negotiable — gate CSS with
  `@media (prefers-reduced-motion: reduce)` and JS with
  `prefersReducedMotion()` from
  `src/lib/utils/reduced-motion.utils.ts`.

## Scope

- Swap `Sparkles` → `Zap` (from `@lucide/svelte/icons`),
  `size={16} strokeWidth={1.6}`.
- Rename the local reaction state to read as a "like": `clappedKeys` →
  `likedKeys`, `toggleClap` → `toggleLike`, `.is-clapped` →
  `.is-liked`. Keep the local-only `SvelteSet` semantics (no
  persistence — see Out of scope). Single tap toggles on/off.
- Committed (`.is-liked`) state: `color: var(--laurel)`,
  `background: color-mix(in srgb, var(--laurel) 15%, transparent)`.
- Commit motion: a transient `is-firing` class drives `react-tilt`
  (420ms `var(--ease-vici)`) on the reaction `svg`, plus a `--laurel`
  particle burst (8 radial particles, ~560ms). Track firing keys in a
  second `SvelteSet`; add on commit, `setTimeout`-remove after 600ms.
  Skip both when `prefersReducedMotion()` is true, and zero the
  animation under `@media (prefers-reduced-motion: reduce)`.
- i18n: rename `arena.friends.feed.clap` → `arena.friends.feed.like`
  with value "Like" across **all 8** locale catalogs (`en`, `de`, `es`,
  `fr`, `it`, `pt`, `pt-BR`, `zh-Hans`); update the `aria-label`
  reference in the component.

### Out of scope

- A persisted, satellite-backed reaction model (counts, who reacted).
  The reaction stays a local-only `SvelteSet`; persistence is a tracked
  follow-up.
- The feed's data source / 24h win/loss window — owned by the separate
  win/loss feed spec.
- The non-friend / ranked-friends fallback branches of the feed.

## Design artifacts (frontend)

The interactive explorer used to lock the reaction styling (icon, colour
token, size, stroke, animation, burst) lives at
`2026-06-12-feat-friend-feed-reaction-redesign/reactions-explorer.html`. It
was once removed under a former post-merge cleanup rule and has been
restored: spec asset folders are kept after merge.

## Technical requirements (satellite / backend)

Pure-frontend. No `src/satellite/**`, collection, or `.did` changes —
the reaction stays local-only.

## Implementation outline

1. In `FriendsTab.svelte`, replace the `Sparkles` import with `Zap`.
2. Rename `clappedKeys` → `likedKeys`, `toggleClap` → `toggleLike`; add
   a `firingKeys` `SvelteSet` and an `isFiring(activity)` check.
3. In `toggleLike`: on add, `haptic('light-tap')`, and — unless
   `prefersReducedMotion()` — add the key to `firingKeys`, port the
   artifact's `fireBurst` particle helper, and `setTimeout`-clear after
   600ms.
4. Update the button markup: `<Zap size={16} strokeWidth={1.6} />`,
   `class:is-liked`, `class:is-firing={isFiring(activity)}`,
   `aria-label` → the `like` key, keep `aria-pressed`.
5. Restyle `.feed-react.is-liked` to the `--laurel` colour + 15% wash;
   add the `react-tilt` keyframes, the `.is-firing svg` rule, the
   particle-burst markup/styles, and the reduced-motion guard.
6. Rename the i18n key in all 8 catalogs; run `npm run check:i18n`.

## Acceptance criteria

- [ ] The reaction renders `<Zap size={16} strokeWidth={1.6} />`; a
      single tap toggles it on/off; committed state is `--laurel`
      (colour + 15% wash).
- [ ] On commit the icon plays `react-tilt` (420ms) and a `--laurel`
      particle burst; both are suppressed under
      `prefers-reduced-motion: reduce` and `prefersReducedMotion()`.
- [ ] No emoji is introduced; the glyph is from `@lucide/svelte`.
- [ ] `arena.friends.feed.like` exists in all 8 locale catalogs and the
      `clap` key is gone; catalogs stay in parity.
- [ ] `npm run quality` (incl. i18n) and `npm run check` pass.

## Decisions

- **Zap over Heart/ThumbsUp.** Chosen in the artifact: a quick energy
  cue that fits acknowledging a call without the romantic read of a
  heart or the generic read of a thumbs-up.
- **`tilt` + burst over a plain pop.** A per-row action is frequent, so
  the motion stays a short tilt with a single burst rather than a
  spring/overshoot, per brand §8. Both are reduced-motion gated.
- **Local-only reaction retained.** Persisting reactions needs a
  satellite model and fan-out; out of scope here to keep the redesign
  shippable. Tracked as a follow-up (later shipped — likes persist with
  counts, #891 / #897).
- **Implementation deviated to `--color-primary` (code is canonical).**
  This spec's liked-state styling specced `--laurel`, but the shipped
  `FriendsTab.svelte` uses `--color-primary` (for contrast, per the code
  comment there). As an `Implemented` record this spec defers to the code:
  the `--laurel` references above are the original proposal, not shipped
  truth — `FriendsTab.svelte` is authoritative.
