# Spec: Friends' daily win/loss feed (24h window)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

## Goal

Make the Arena → Friends "Recent activity" feed show only **friends'
daily win/loss** (each friend's decisive position outcomes (won /
lost) from the last 24 hours) instead of a generic action log. The
surface becomes a rolling 24h scoreboard of how the friend graph
actually did.

## Context: why this needs backend work

The naive reading ("filter the activity feed to settlements in 24h")
does not work, and this spec exists to record why:

- The activity-feed `SETTLEMENT` rows are **market-resolution events**,
  not per-friend outcomes. They are written by the admin/solver who
  settles a market
  (`src/lib/services/resolution.services.ts:115`,
  `src/lib/services/authn.services.ts:54`) with
  `user = <settler principal>` and `title: "Market Resolved: <outcome>"`.
  `src/lib/services/market.services.ts:514` only uses them to build a
  `marketId → outcome` map. So filtering them yields admin rows, not a
  friend's win/loss.
- A user's actual win/loss comes from the clearing canister's per-user
  `Settled` events → `tradeHistory` → the `resolvedPositions` derived
  (`src/lib/derived/resolved-positions.derived.ts`, `result: 'won' |
'lost' | 'neutral'`). But `tradeHistory` is loaded only for the
  **viewer** (`LoaderTradeHistory`); there is no path to read a
  _friend's_ settled positions.

So the feed needs a **new read** that returns recent settled positions
(or a win/loss summary) for a set of friend principals, windowed to 24h.

## Scope (proposed, to refine before build)

- A backend read that, given a set of principals (the viewer's friend
  set, `friendsListStore`) and a 24h window, returns each friend's
  decisive settled positions (or an aggregated per-friend win/loss).
- A frontend store/derived/loader to consume it, then render windowed
  win/loss rows in `FriendsTab.svelte` with the `--yes` / `--no` signal
  per outcome (no fourth signal: brand §4.2).
- Empty state: settlements are sparse, so the 24h window is often empty;
  keep a quiet copy block.

### Out of scope

- The reaction affordance, shipped in
  [`2026-06-12-feat-friend-feed-reaction-redesign.md`](./2026-06-12-feat-friend-feed-reaction-redesign.md).
- Aggregated net daily P&L (summed VXP up/down): a summary chip can be
  a later follow-up; this spec shows per-position win/loss rows.

## Technical requirements (satellite / backend): mandatory, to complete

This section must be filled before the spec leaves `Draft`. Open
questions to resolve first:

- **Source.** Can friends' settled positions be served from the
  existing clearing surface (the `Settled` event log /
  `SETTLEMENT_LEADERBOARD` index, see
  `src/declarations/clearing/clearing.d.ts`) filtered by `(user,
window)`, or is a new `defineQuery` / clearing method required? If the
  latter, it is an `icdc-core` change (separate repo, own `AGENTS.md`)
  wired here via regenerated bindings in a follow-up PR.
- **Performance.** Friend sets can be tens of principals; a per-friend
  fanout is N reads per feed open. Specify the call frequency and the
  instruction-budget impact; prefer a single bulk read keyed on the
  principal set + window over N+1.
- **Scalability.** Behaviour at 10× / 100× friends and settlement
  volume; pagination / cap.
- **Memory & storage.** No new collection expected if served from
  clearing; confirm.
- **Security.** A friend's win/loss is semi-public within the friend
  graph: confirm the caller-permission model for reading another
  principal's settled outcomes (the clearing settlement-derived reads
  are guarded by `caller_is_not_anonymous`).
- **Parameters.** Reuse `DAY_IN_MS` from
  `src/lib/constants/app.constants.ts` for the window; do not restate a
  literal.

## Acceptance criteria

- [ ] The Friends feed shows only friends' decisive win/loss outcomes
      from the last 24h; nothing older, no non-settlement rows.
- [ ] Wins render `--yes`, losses `--no`; no fourth colour.
- [ ] The friends'-settlements read is a bulk call, not an N+1 fanout.
- [ ] `npm run quality` and `npm run check` pass (plus
      `npm run juno:functions:build` if the satellite is touched).

## Decisions

- **Split from the reaction redesign.** The reaction work is
  data-source-independent and shippable now; the win/loss feed needs a
  backend read that does not exist. Splitting keeps the reaction PR
  small and unblocked.
