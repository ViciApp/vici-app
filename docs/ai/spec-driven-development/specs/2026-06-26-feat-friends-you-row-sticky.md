# Spec: Friends ranked (YOU row at its real rank, sticky to the nearest edge)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1020)

## Goal

In Arena → Friends → "Ranked", the viewer's own row is moved from a
fixed footer pinned to the bottom of the list to its **real position by
accuracy**, inline among the friend rows. So it never scrolls out of
sight, the row sticks to the **nearest scroll edge**, gluing to the top
while its true slot is above the fold, to the bottom while below, and
settles back inline the moment that slot scrolls into view. A viewer at
45% accuracy reads as rank 6 of 17 sitting between the 56% and 44%
friends, not as dead last.

## Context

The Ranked list lives in
`src/lib/components/arena/FriendsTab.svelte`; each row is the shared
`src/lib/components/arena/RankedRow.svelte` (`variant: 'friend' | 'you'`).
Friends are sorted accuracy-descending into `rankedFriends`
(`FriendsTab.svelte` `$derived.by`), the viewer's standing is
`myFriendRank` (count of friends with strictly higher accuracy, +1), and
both use the same `accuracyOf` source, all shipped in **#1017**, which
also moved the self-marker to a `YouBadge` beside the handle.

Today the list renders `visibleRanked` (`rankedFriends.slice(0, 10)`
unless `showAllRanked`) inside `<ul class="ranked-list">`, then appends
the YOU row as a separate trailing `<li class="ranked-li-you">` styled
`position: sticky; bottom: 0`. This spec relocates that row into the
ordered list at index `myFriendRank - 1` and changes its sticky anchoring
to both edges.

The "sticky to both edges" effect is native CSS: a single
`position: sticky` element with **both** `top` and `bottom` insets set is
held within the band between them, gluing to whichever edge its natural
position has crossed. No scroll listener, no `IntersectionObserver`. The
mock in this spec's asset folder demonstrates it across all four
scenarios (rank at top / visible-middle / scrolled-middle / bottom) and
all three themes.

Reusability: `RankedRow` already renders the `you` variant with the rank
number, `YouBadge`, accuracy/streak meta, and trailing value; no new
component. The change is the **placement** of the row and its sticky
anchoring, both in `FriendsTab.svelte` + `RankedRow.svelte`'s scoped
styles.

## Scope

1. **Insert the YOU row at its real rank.** In `FriendsTab.svelte`,
   render the `you` `RankedRow` inside the ordered list at position
   `myFriendRank - 1` rather than as a trailing sibling after
   `visibleRanked`. The friend rows keep their own `numLabel`
   (`idx + 1`); the YOU row keeps `numLabel={String(myFriendRank)…}`.
2. **Sticky to both edges.** Replace the YOU row's
   `position: sticky; bottom: 0` with `position: sticky` + a `top` and a
   `bottom` inset (small symmetric gutter), so it glues to the nearest
   edge off-screen and flows inline when its slot is visible. The row is
   a single line, always shorter than the scroll viewport, which is the
   precondition for the both-edges behaviour.
3. **List length** so the YOU row has a real inline slot to settle into
   even when the viewer ranks past the current 10-row cut; see Pending
   decisions (default: render the full list).
4. **PRODUCT.md.** Update the Arena → Friends description to state the
   YOU row sits at its real rank and stays edge-pinned while scrolling.

### Out of scope

- **Ranking logic / accuracy source.** `rankedFriends` sort and
  `accuracyOf` are unchanged; this is placement only.
- **The friend rows' h2h chips, avatars, mini-profile sheet**: untouched.
- **The global leaderboard** (`myRank` / `$leaderboard`, the "Global
  ranking" link): a different surface, not this list.
- **#1017's content** (rank number + `YouBadge`): already shipped; this
  spec depends on it but does not re-touch it.

## Linked issues

Searched the repo's open issues (`ViciApp/vici-app`) for
"friends rank", "you row", "leaderboard sticky": **no related open
issue**. Product-driven design work, not a tracked bug.

## Analytics

**No new analytics.** This is a pure presentational change to where an
already-rendered row sits and how it anchors during scroll; it adds no
new user action, navigable surface, or state transition to instrument.
The Friends surface's existing events are unaffected. Per the default-yes
bar: considered, and explicitly declined because there is no new
behavioural signal to capture (a scroll-anchoring style is not a user
decision). No event names touched in `src/lib/types/analytics-event.ts`
or its Zod mirror.

## Design artifacts

- [`./2026-06-26-feat-friends-you-row-sticky/sticky-you-row.html`](./2026-06-26-feat-friends-you-row-sticky/sticky-you-row.html):
  interactive mock with a **theme switcher** (dark / light / peach,
  rendered via `data-theme` the way the app does), test-scenario presets
  (rank at top / visible-middle / scrolled-middle / bottom), the two
  product toggles below, and a **Copy instructions** button that hands
  the chosen variants back to the chat. Retained as a living reference.

## Implementation outline

1. **`FriendsTab.svelte` markup.** Build the rendered list as friend rows
   with the `you` `RankedRow` (a `youRow` snippet) spliced in at
   `youInsertAt` (`myFriendRank - 1`); drop the trailing
   `<li class="ranked-li-you">`. Friend `numLabel`s below the slot shift
   `+1`. Remove the 10-row cap (`visibleRanked` / `showAllRanked` /
   `hiddenRankedCount` / the `See all` button) per the list-length
   decision: render `rankedFriends` in full.
2. **`RankedRow.svelte` styles.** Swap the YOU row's
   `position: sticky; bottom: 0` (currently the parent
   `.ranked-li-you`) for `position: sticky; top: <gutter>;
bottom: <gutter>; z-index`. If the sticky anchor must move from the
   `<li>` onto the row element, adjust which element carries it; keep the
   existing `--color-primary` wash / blur / shadow treatment.
3. **List length** per Pending decisions (default: render
   `rankedFriends` in full, retire the 10-row `slice`).
4. **`PRODUCT.md`**: Arena → Friends section.
5. `npm run quality` + `npm run check`.

## Acceptance criteria

- [ ] The YOU row renders inline at index `myFriendRank - 1` (e.g. rank 6
      of 17 at 45%), not as a bottom-pinned footer.
- [ ] While the YOU row's natural slot is above the viewport it sticks to
      the top edge; while below, it sticks to the bottom edge; when the
      slot is visible the row flows inline at its rank.
- [ ] The behaviour holds in dark, light, and peach themes, and on iOS
      Safari (see Open questions); no hardcoded colours, tokens only.
- [ ] The rank number + `YouBadge` beside the handle (from #1017) still
      render on the inline row.
- [ ] `PRODUCT.md` describes the real-rank, edge-sticky YOU row.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- **iOS Safari support for sticky-both-edges.** The app is a mobile PWA;
  the primary target is iOS Safari. The behaviour is verified in Chromium
  (the mock's scrolled-middle case anchors the row to the top edge with no
  JS). Still to confirm on a real iOS Safari device that a single
  `position: sticky` element with both `top` and `bottom` insets glues to
  the nearest edge there. If iOS drops one inset, the fallback is a JS
  `IntersectionObserver` toggling a top- vs bottom-pinned class, not
  built unless device testing shows it's needed.

## Decisions

- **List length: render the full ranked list.** The 10-row `slice`
  (`visibleRanked` / `showAllRanked` / "See all") is removed so the YOU
  row always has a real inline slot to settle into. The list is one friend
  group (tens, not thousands), so the cap bought little and broke the
  settle-inline payoff. (Owner-confirmed.)
- **YOU row trailing value: keep the VXP balance.** VXP is unique self-info
  the friend rows don't carry; a head-to-head chip is "vs whom?" ambiguous
  on your own row. (Owner-confirmed.)
- **Native CSS, no scroll JS.** `position: sticky` with both insets gives
  the glue-to-nearest-edge behaviour with no listener or observer; the JS
  fallback is only adopted if iOS device testing fails the open question
  above.
- **Reuse `RankedRow` as-is.** The `you` variant already carries every
  label; this spec changes placement and anchoring only, no new component
  or shared primitive (no meta-update needed).

## Divergence check

Implementation matches the spec. The YOU row is spliced into
`rankedFriends` at `youInsertAt` (`myFriendRank - 1`) via a `youRow`
snippet, friend rank labels below the slot shift `+1`, the full list
renders (cap removed), and `.ranked-li-you` is `position: sticky; top: 0;
bottom: 0`. The directional drop-shadow on `.ranked-row-you` was made
symmetric since the row can now dock to either edge, a detail not
foreseen in the outline.
