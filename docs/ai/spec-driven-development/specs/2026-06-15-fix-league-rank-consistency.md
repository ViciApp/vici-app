# Spec: League rank is consistent across every surface

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#893)

## Goal

A member sees **one** rank for themselves in a given league, no matter
where it is shown. Today the same user in the same league reads as three
different positions on screen at once: `#2` on the leagues card, `#1` in
the detail-page hero, and row `03` in that page's own leaderboard list,
because each surface ranks by a different metric. After this change all
three derive from a single accuracy-first ranking, so the hero badge
matches the list directly beneath it and the card matches both.

## Context

Three surfaces each compute the caller's rank independently, from three
different sort keys:

- **Leagues card**: [`LeaguesPage.svelte:188`](../../../src/lib/components/pages/LeaguesPage.svelte)
  (`yourRankFor`) ranks by **roster join order**:
  `row.members.indexOf(selfPrincipal) + 1`. Rendered by
  [`LeagueListCard.svelte`](../../../src/lib/components/leagues/LeagueListCard.svelte)
  as `#{rank} of {memberCount}`.
- **Detail hero**: [`LeagueDetailPage.svelte:414`](../../../src/lib/components/pages/LeagueDetailPage.svelte)
  (`yourRank`) prefers `standingRank`, the **net realized P&L** rank from
  the clearing canister's `list_leaderboard`
  ([`standings.services.ts:117`](../../../src/lib/services/standings.services.ts),
  `getLeagueStandings`), filtered to the league roster and windowed by the
  active week/all tab; it falls back to the accuracy index only while that
  load is pending. Rendered at `LeagueDetailPage.svelte:1011` (corner
  badge) and `:1066` (`#{yourRank}` in the rank block).
- **Detail leaderboard list**: [`LeagueDetailPage.svelte:570`](../../../src/lib/components/pages/LeagueDetailPage.svelte)
  (`sortedMembers`) ranks by **prediction accuracy** (desc), tie-broken on
  `dailyStreak` (desc) then `joinedAtMs` (asc). Accuracy and streak come
  from the shared profile cache
  ([`profilesStore`](../../../src/lib/stores/profiles.store.ts);
  `memberAccuracy`/`memberStreak` at `:553`–`:557`). Rows render at `:1192`,
  the sticky "YOU" row (when the caller is outside the visible top-6) at
  `:1239`, and the sticky row prints `yourRank` (the P&L number), so it can
  disagree with where the same user would sort in the list it sits under.

The chosen canonical metric is **accuracy-first**, matching what the
leaderboard list already visibly shows and what the _global_ leaderboard
already does: [`LeaderboardPage.svelte:50`](../../../src/lib/components/pages/LeaderboardPage.svelte)
notes `globalStandingsRows` re-ranks the clearing P&L slice by accuracy
before display. This makes the league surfaces window-independent (the
profile-cache accuracy is a single lifetime figure, identical on the week
and all-time tabs).

**Point of truth: the prototype.** The VICI design prototype
(`../VICI-1.7-Engineering-Handover`, identical across V1.4→V1.7) ranks
league members **exclusively by prediction accuracy**: `data.js` orders
each league's `members` by descending `acc`, and both the hero
(`screens.jsx:6049`, `#{youMember.rank}`) and the list rows
(`screens.jsx:6116`, `{u.rank}`) read that one pre-computed accuracy rank.
There is no P&L, points, or join-order ranking anywhere. Production's
clearing-P&L `standingRank` is therefore a divergence from the design, and
is the source of the inconsistency. Two adjacent elements that look
metric-bound are, in the prototype, **purely decorative** and must be kept
as-is:

- **Trend arrow** (`screens.jsx:6051`): `const trend = (seedFromId(league.id) % 7) - 3;`:
  seeded noise rendered as "▲ N this week" / "– even". Never tied to any
  metric. Production wired it to the real weekly-P&L `rankDelta`; that
  weekly-momentum flourish is retained (it is _not_ claimed to be
  accuracy-rank movement).
- **THIS WEEK / ALL TIME tabs** (`screens.jsx:6109`): the prototype renders
  `members.slice(0, 6)` identically for both tabs: switching tabs changes
  nothing. They are decorative and are kept.

No shared league-ranking helper exists today: both `sortedMembers` and
`yourRankFor` are inline. There is an `accuracy.utils.ts` and an
`affiliation-stats.utils.ts` under
[`src/lib/utils/`](../../../src/lib/utils/) but no `league-*` util yet.
`LeagueMemberDoc` is defined in
[`league-member.ts`](../../../src/lib/types/league-member.ts).

`getLeagueStandings` stays in the service regardless: it is still used by
[`ArenaStandingHero.svelte:314`](../../../src/lib/components/arena/ArenaStandingHero.svelte).

## Scope

1. **One ranking helper.** Add `src/lib/utils/league-rank.utils.ts`
   exporting a pure ranking function that takes the member list plus
   accuracy/streak accessors and returns the roster sorted by the
   accuracy-first key (accuracy desc → streak desc → `joinedAtMs` asc),
   plus a helper for the caller's 1-based position in that order. This is
   the single definition of "league rank"; `sortedMembers`, the hero
   `yourRank`, and the card `yourRankFor` all route through it.

2. **Detail hero uses the list order.** Replace the `standingRank`-first
   `yourRank` derivation (`LeagueDetailPage.svelte:414`) with the caller's
   index in `sortedMembers`. The hero badge (`:1011`), the rank block
   (`:1066`), and the sticky YOU row (`:1247`) then all read the same
   number as the list. Remove the now-unused `standingRank` `$effect`
   (`:346`–`:365`) and its state.

3. **Card uses accuracy too.** `LeaguesPage` currently hydrates only the
   first overlapping friend's profile, so it lacks per-member accuracy.
   Hydrate the rosters of the caller's leagues (deduped across leagues)
   into `profilesStore`, then rank each card via the shared helper. See
   _Pending decisions_ for the hydrate-vs-drop choice.

4. **Dead-code removal.** Once `yourRank` no longer reads `standingRank`,
   the `standingRank` state + `$effect` (`LeagueDetailPage.svelte:336`,
   `:346`–`:365`) become dead (nothing reads the value) and are removed.

**Explicitly unchanged** (prototype-faithful, see _Decisions_):

- The **trend arrow** (`standingTrend` on the hero `:1074`, `leagueTrends`
  on the card `:206`) stays exactly as-is: the prototype's arrow is
  decorative, so production's weekly-P&L momentum flourish is fine beside
  an accuracy rank. `getLeagueStandings` and `findOwnStanding` therefore
  stay imported (still used by the trend effect + `ArenaStandingHero`).
- The **THIS WEEK / ALL TIME tabs** stay: decorative in the prototype, and
  retained here.

### Out of scope

- The **global** leaderboard / dashboard rank tiles: they already re-rank
  by accuracy for display; the P&L-vs-accuracy split on the Dash tile is a
  separately tracked known inconsistency (documented in
  `standings.services.ts:142`) and is not touched here.
- Moving accuracy ranking into the clearing canister (would make a
  windowed, authoritative accuracy rank possible; flagged in
  `standings.services.ts` as future work).
- Making the trend arrow or the week/all tabs metric-accurate: both are
  decorative in the prototype and stay that way.

## Linked issues

No open issue tracks this. The four open issues (`#810` GDPR, `#759` "Dash
looks different between me and Tim", `#543` anti-farm, `#350` flow-grant
credit) are unrelated. `#759` is about the Dash, not league rank, and is
explicitly out of scope. No closing keyword.

## Analytics

No new analytics. This is a correctness/consistency bugfix to how an
existing, already-rendered number is computed: it adds no new surface,
flow, or user action to instrument, and emits no behavioural signal that
isn't already covered. Existing league events (`league_invite_sent`, etc.)
are untouched.

## Implementation outline

1. Add `src/lib/utils/league-rank.utils.ts`:
   - `rankLeagueMembers({ members, accuracyOf, streakOf })` → members
     sorted by accuracy desc, streak desc, `joinedAtMs` asc (the exact
     comparator currently inlined at `LeagueDetailPage.svelte:577`).
   - `leagueRankOf({ sorted, principal })` → 1-based index, or `undefined`
     when absent.
   - Snapshot accuracy/streak once per member before sorting (preserve the
     existing "don't re-read the cache per comparison" property noted at
     `:568`).
2. `LeagueDetailPage.svelte`:
   - Derive `sortedMembers` via `rankLeagueMembers`.
   - Redefine `yourRank` as `leagueRankOf({ sorted: sortedMembers, principal: selfPrincipal })`, defaulting to `1` only when the caller is genuinely absent (preserve the never-blank-badge intent at `:410`).
   - Delete the now-dead `standingRank` state + `$effect`. Keep
     `standingTrend`, the trend block (`:1074`), and the week/all tabs.
3. `LeaguesPage.svelte`:
   - Hydrate roster profiles (deduped across all the caller's leagues) into
     `profilesStore` so per-member accuracy is available to the card.
   - Redefine `yourRankFor(row)` via the shared helper over `row.members`.
   - Leave `leagueTrends`/`trendFor` (the card trend arrow) unchanged.
4. Update [`PRODUCT.md`](../PRODUCT.md): add a short "League ranking"
   subsection stating the single accuracy-first rule and that it is
   window-independent, linking this spec as the decision record.
5. `npm run quality` + `npm run check`.

## Acceptance criteria

- [ ] For any caller in any league, the leagues-card badge, the detail
      hero (`#N` + corner `N°NN`), and the detail leaderboard list all show
      the **same** rank.
- [ ] The detail hero rank equals the caller's row position in the list on
      the same page (in-list YOU row and sticky YOU row agree).
- [ ] Ranking order is accuracy desc → streak desc → join order asc, and is
      identical on the THIS WEEK and ALL TIME tabs.
- [ ] A member with no settled predictions (0% accuracy) sorts to the foot
      rather than riding join order or role to the top.
- [ ] `rankLeagueMembers` / `leagueRankOf` are the only definition of
      league rank: no surface re-implements the comparator.
- [ ] `npm run quality` and `npm run check` pass.

## Decisions

All resolved against the design prototype (the point of truth) and the
product owner: none outstanding.

- **Canonical metric: accuracy-first** (accuracy desc → streak desc →
  join order asc), window-independent. Confirmed by the prototype, which
  ranks league members exclusively by `acc` across V1.4→V1.7, and by the
  product owner. Chosen over net-P&L (clearing) and join order because it
  is what the design specifies, what the leaderboard list already displays,
  and what the global leaderboard already ranks by: the smallest change
  that makes the three numbers agree. (Streak as the first tie-breaker is a
  production refinement; the prototype's seeded data never ties.)
- **Card badge: hydrate & rank.** `LeaguesPage` hydrates its leagues'
  rosters and ranks the card by accuracy via the shared helper, keeping the
  "#N of M" badge and matching the detail page. Bounded fan-out (few small
  leagues, deduped). Chosen over dropping the badge because the prototype
  card shows the same accuracy rank.
- **Trend arrow: keep unchanged.** The prototype's arrow is decorative
  seeded noise, never a metric; production's weekly-P&L momentum is a
  faithful realization of that flourish and does not claim to be
  accuracy-rank movement. Not removed.
- **Week/all tabs: keep unchanged.** Decorative in the prototype (both tabs
  render the same list). Retained.
