# Spec: Flow motion & reward system

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#958)

## Goal

Reconcile Flow's beat selection and VXP economy against the Flow Motion
design source, landing a single agreed truth across the shipped engine and
`design.md` §7. The user-visible outcome is a Flow deck whose celebratory
beats, cadence, and reward grants behave consistently with the documented
design: no beat fires twice back to back, the economy stays
deflation-safe, and a freshly-crossed Menagerie tier always sequences after
the character beat rather than colliding with it.

This is a refinement of an already-shipped layer, not a net-new feature:
the engine, beat host, and celebration sequencing already live in the tree.
The spec exists to (a) capture the design source as the reference and
(b) record a small set of concrete reconciliation decisions captured under
[Scope](#scope) and [Decisions](#decisions). Where the source and the
shipped code disagree, the shipped code is canonical.

## Context

The Flow motion layer is implemented and live. The pieces this spec
touches or references:

- **Beat resolver**:
  [`src/lib/utils/motion-engine.utils.ts`](../../../../src/lib/utils/motion-engine.utils.ts).
  `recordMotionSwipe(input) → { bonusXp, beat | null }`. Single-pass
  priority resolver: comeback opener → daily/overtime complete →
  lifetime volume milestone → overtime rhythm → first-position events →
  within-day jittered rhythm → wildcard → every-10th ambient. Copy is a
  rotating, non-repeating pool of **i18n keys** (`motion.pool.*`), never
  literals. VXP is credit-stacked across all eligible sources even though
  only the highest-priority beat animates.
- **Reward gate**:
  [`src/lib/constants/flow-rewards.constants.ts`](../../../../src/lib/constants/flow-rewards.constants.ts)
  (`ACCURACY_GATE_CALLS`, `isAccuracyUnlocked`). The economy is
  deflation-safe: a committed swipe mints nothing; VXP is minted only at
  the overtime finish (+25, repeatable) and rare lifetime-volume
  milestones (`VOLUME` in `motion-engine.utils.ts`).
- **Beat host**:
  [`src/lib/components/market/MotionBeat.svelte`](../../../../src/lib/components/market/MotionBeat.svelte),
  consuming the `MotionBeatPayload` (copy / sub / treat / badge carried as
  i18n keys; `tier` for the Flame stage; `count` for volume count-up).
- **Orchestration + sequencing**:
  [`src/lib/components/market/FlowMode.svelte`](../../../../src/lib/components/market/FlowMode.svelte).
  Renders the active beat (`onMotionBeatDone`, line ≈491), pauses the deck
  for gating beats, and flips the beat-active flag.
- **No-collision contract**:
  [`src/lib/stores/flow-beat.store.ts`](../../../../src/lib/stores/flow-beat.store.ts)
  (`flowBeatActiveStore` / `setFlowBeatActive`). The achievement reveal in
  [`MenagerieCelebrationHost.svelte`](../../../../src/lib/components/menagerie/MenagerieCelebrationHost.svelte)
  is held while this flag is set, so the trophy sequences **after** the
  character beat (card → beat → trophy).
- **Characters / menagerie**:
  [`src/lib/constants/characters.constants.ts`](../../../../src/lib/constants/characters.constants.ts),
  [`src/lib/constants/menagerie.constants.ts`](../../../../src/lib/constants/menagerie.constants.ts)
  and the
  [`src/lib/components/menagerie/`](../../../../src/lib/components/menagerie/)
  reveal layer.
- **Streak tiers**: `tierForStreak` in `motion-engine.utils.ts`, mirroring
  `stageForStreak` in
  [`src/lib/utils/streak.utils.ts`](../../../../src/lib/utils/streak.utils.ts)
  with the added `NONE` floor.

Canonical product rules for all of the above live in
[`docs/ai/frontend/design.md`](../../frontend/design.md) §7: 7.3 economy
and beats, 7.4 Flame stages, 7.5 accuracy gate, 7.7 character-beat priority
resolver, 7.9 haptics. Per [AGENTS.md §2.5](../../../AGENTS.md), the spec
narrative describes behaviour and points at design.md §7; it does not carry
the design source's own versioning or section numbering into the tree as
product truth.

## Scope

The reference is the Flow Motion [design source](#design-source). Where
the source and the shipped engine disagree, this spec decides which wins
and records it (shipped code is canonical). The concrete reconciliation
items found by diffing the source against `motion-engine.utils.ts`:

1. **Overtime-rhythm character at call 13.** The design source assigns
   the call-13 overtime beat to `oracle`; the shipped `OT_RHYTHM[13]`
   uses `trickster`. Pick one and align both the engine and design.md
   §7.3. (See [Decisions](#decisions).)
2. **Economy description vs. table.** The design source's header comment
   describes VXP as minted "from 50 up (×50)", but its own `VOLUME` table
   mints from the 10-call mark (`10 → +50`). The shipped engine already
   corrected the prose to "from the 10-call mark up"; confirm the table
   (`10/100/500/1000 → +50/+100/+250/+500`, with `1/25` moment-only) is
   the intended ladder and that design.md §7.3 matches.
3. **No-collision / trapped-flag guard (must survive any rebuild).** The
   source's `__viciBeatActive` flag maps to `flowBeatActiveStore`. The
   guard is currently the effect-teardown
   `$effect(() => () => setFlowBeatActive(false))` at
   `FlowMode.svelte:253`, which force-clears the flag when Flow unmounts.
   This is the contract that stops every future achievement reveal from
   being silently suppressed after the user leaves Flow mid-beat. Keep it,
   and lock it behind an acceptance test so a refactor cannot drop it.

Everything else in the source (the priority order, the jittered rhythm
windows, the credit-stacking rule, the wildcard ~1/6 variable ratio, the
comeback opener, the haptic patterns) is already faithfully implemented
and stays as-is unless an open decision below changes it.

### Out of scope

- A persisted, satellite-backed **treats** model. Wildcard treats are
  surfaced as `treatKey` on the payload only; the engine does not credit
  or persist them (noted in `TREAT_KEYS`). A treats store is a tracked
  follow-up, not this spec.
- Win/loss or accuracy signals. A Flow swipe **places** a call; it never
  resolves one, so the engine never moves accuracy. The accuracy gate
  (`ACCURACY_GATE_CALLS = 30`) is unchanged.
- The generative artwork layer (design.md §7.8) and the cold-load Oracle
  moment (§7.10).
- Any change to the streak-tier thresholds (`tierForStreak`) or the
  underlying `streak.utils` ladder.

## Design source

The design reference is **Doc C ("Flow Motion") of the VICI System Design
handover**: a self-contained HTML spec plus a pure-JS reference engine
(`motion-engine.js`) that documents which beat fires and when. Those files
are **not committed here**: they contradict shipped reality in a couple of
places (the call-13 character and the volume-ladder framing, see
[Decisions](#decisions)) and predate this repo's terminology conventions,
so committing them as repo truth would mislead. They live in the original
handover and in the closed #867 PR's history for reference.

**Canonical, where they differ: the shipped TypeScript engine**
(`motion-engine.utils.ts`) and `design.md` §7. This spec records each
divergence and its resolution under [Decisions](#decisions); the design
source informs the decision but never overrides the shipped code.

## Technical requirements (satellite / backend)

Pure-frontend. No `src/satellite/**`, collection, `.did`, or icdc-core
changes. The engine's only persistence is `localStorage`
(`vici.motion.state.v3`: rotating-copy indices, the day's jittered
schedule, first-flags, lifetime tally), client-only, no canister state,
no instruction-budget or memory-growth impact. Volume milestones prefer
the profile's real `me.calls` (`lifetimeCalls`) over the local tally, so
correctness does not depend on `localStorage` surviving.

## Implementation outline

1. **Lock the reference.** Land this spec with the asset folder as the
   normative source; flip status to `In progress (#PR)` when the
   implementation PR opens.
2. **Resolve the open decisions** (below) with Giovanni; edit this Scope
   to record the chosen direction before changing code (workflow step 4).
3. **Reconcile the call-13 character** in
   `OT_RHYTHM[13]` (`motion-engine.utils.ts`) to the decided value, and
   make design.md §7.3 agree.
4. **Confirm the volume ladder** in `VOLUME` matches the decided economy;
   reconcile the design.md §7.3 economy table to the same numbers.
5. **No-collision guard regression test: deferred.** The repo has no FE
   unit-test harness (no `vitest` / `*.spec.ts` under `src/`), so locking
   the guard behind a test is a tracked follow-up, not this PR (see
   [Decisions](#decisions)). The guard itself (`FlowMode.svelte:253`) is
   verified present and unchanged.
6. **Update `docs/ai/PRODUCT.md`** in the same PR for any behaviour that
   changes (e.g. the call-13 character), per the workflow.
7. Run the local gates (`npm run quality`, `npm run check`) before
   review.

## Acceptance criteria

- [ ] The design source in the asset folder is the referenced normative
      spec; the spec narrative grounds in real repo paths and design.md
      §7, not the source's own section numbering.
- [ ] `OT_RHYTHM[13]` in `motion-engine.utils.ts` and design.md §7.3 agree
      on the call-13 character.
- [ ] The `VOLUME` ladder and design.md §7.3 economy table state the same
      mint values; the daily ten still mints nothing (deflation-safe).
- [x] No-collision guard (`FlowMode.svelte:253`) verified present and
      unchanged; the locking regression test is deferred (no FE test infra:
      see Decisions).
- [ ] No two beats animate back to back; credit-stacking still grants all
      eligible VXP on a single beat.
- [ ] All beat copy resolves through `t()` (i18n keys, present in every
      locale catalog); no literal strings introduced.
- [ ] `npm run quality` (incl. i18n) and `npm run check` pass.

## Decisions

- **Call-13 overtime character → `trickster` (shipped kept).** The design
  source assigns call-13 to `oracle`, but the shipped `OT_RHYTHM[13]` uses
  `trickster`. Decision: keep `trickster`: zero behaviour change, no engine
  edit, lowest risk. The design source's `oracle` is overridden, and
  `design.md` §7.3 (which had drifted to "an Oracle beat at call 13") is
  corrected to `trickster` to match the engine. Reversible if the design
  owner later prefers `oracle` (a one-character change in `OT_RHYTHM[13]`).
- **Volume ladder → confirmed `10/100/500/1000 → +50/+100/+250/+500`**
  (with `1` and `25` moment-only, no VXP). This is what the shipped `VOLUME`
  table holds, what `VXP_FLOW_MILESTONES` holds, and what the real-credit
  path (the flow-milestone award) pays: display and credit agree. The
  source comment's "×50 from 50 up" framing is **not** the ladder; the
  `design.md` §7.3 economy table (which had drifted to `50/250` thresholds)
  is corrected to these values.
- **No-collision guard regression test → deferred (no test infra).** The
  guard (`FlowMode.svelte:253`,
  `$effect(() => () => setFlowBeatActive(false))`) is verified present, but
  the repo has no FE unit-test harness (no `vitest`, no `*.spec.ts` under
  `src/`). Standing one up is out of scope for this reconciliation; the
  regression test is a tracked follow-up. The guard stays.

Net: the shipped engine already matches the design source on every other
point (priority order, jittered windows, credit-stacking, wildcard ratio,
comeback opener, haptics). This PR's only change is the `design.md` §7.3
doc alignment above: no behaviour change, so no `PRODUCT.md` update.
