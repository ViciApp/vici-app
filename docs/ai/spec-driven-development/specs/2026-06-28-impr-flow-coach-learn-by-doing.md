# Spec: Learn-by-doing in-flow gesture coach

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1059)

## Goal

The first-run gesture coach (`FlowCoach`, layer 1 of the first-run tutorial
system) becomes a non-blocking gesture map laid over the live prediction
card instead of a timer-driven carousel that dictated pace and animated the
card. The user keeps interacting with the readable, swipeable card and the
coach dismisses on their first real call, teaching by doing rather than
forcing a sequence.

## Context

The coach previously ran a fixed five-phase timeline (NO → YES → SKIP → TAP
→ IDLE on hard-coded timers), tagged the deck's cards with
`data-coach-phase` so they drifted and blurred in sympathy via global CSS,
flipped the card on the TAP beat, and dismissed on any pointer-down. It
taught gestures the user could not yet try and got in the way of the card it
was explaining.

Touchpoints:

- `src/lib/components/onboarding/FlowCoach.svelte`: both surfaces (`flow`
  and `onboarding`). The component owns the new overlay markup and its
  component-scoped styles.
- `src/lib/components/market/FlowMode.svelte`: the deck. It already builds a
  per-commit signal on every committed YES / NO; the coach consumes it.
- `src/app.css`: held the legacy `.flow-coach*` overlay block and the
  `[data-coach-phase]` card-drift rules.
- i18n catalogs under `src/lib/constants/messages/`: held the old
  `flow.coach.hint_*` carousel keys.
- `src/lib/utils/onboarding-flags.utils.ts`: the per-surface, identity-scoped
  seen flags (`vici.coach-flow-seen` / `vici.coach-onboarding-seen`), reused
  unchanged.

## Scope

- Replace the carousel with a static centered gesture map: a heading and a
  cross, SKIP (up), NO (left), tap (center, detail), YES (right), with
  YES / NO carrying the primary visual weight and SKIP / TAP de-emphasized.
- Make the overlay non-blocking: `pointer-events: none` except the "Got it"
  opt-out button (and the confirm flash).
- Wire dismissal to the deck's first committed call. `FlowMode` exposes its
  per-commit counter as a reactive `commitSignal` prop; the coach snapshots
  it at mount and dismisses on the first increment past that baseline. The
  deck only bumps the counter on a committed YES / NO (reachable only when
  signed in), so for guests the "Got it" opt-out is the dismissal path.
- On the first commit, flash a short confirmation, then unmount; "Got it"
  dismisses immediately, without the flash. Either path persists the seen
  flag.
- Remove the legacy overlay styles, the `data-coach-phase` card-drift rules,
  and the now-unused coach keyframes from `app.css`.
- Replace the `flow.coach.hint_*` keys with a new `flow.coach.*` set
  (head / skip / skip_sub / no / no_sub / yes / yes_sub / tap_sub / got_it /
  confirm, plus the repurposed `aria`) across the live locales; drop the
  orphaned keys from the remaining catalog that carried them.

### Out of scope

- The `onboarding` surface keeps the same redesign and the same first-commit
  dismissal signal; no behavioural divergence between surfaces.
- No change to the funds gate, commit flow, or the per-swipe commit toast.

## Linked issues

No related open issue; this is a fidelity improvement to an existing
surface.

## Analytics

No new analytics. The coach is a passive overlay; the meaningful behavioural
event is the commit itself (`flow_swipe`), already instrumented in the deck.
Adding a coach-shown / coach-dismissed event would not change any product
decision here, so none is added.

## Implementation outline

1. Rewrite `FlowCoach.svelte` as the non-blocking gesture map with the
   confirm flash and "Got it" opt-out; move its styles into a
   component-scoped `<style>` with token colors and a reduced-motion gate.
2. Add a `commitSignal` prop; capture the baseline at mount and dismiss on
   the first increment past it.
3. In `FlowMode.svelte`, make the per-commit counter reactive and pass it as
   `commitSignal`.
4. Delete the legacy `.flow-coach*` and `[data-coach-phase]` rules and the
   unused coach keyframes from `app.css`.
5. Swap the i18n keys across all live catalogs and remove the orphaned
   `flow.coach.hint_*` keys.

## Acceptance criteria

- [ ] The overlay leaves the card readable and swipeable; only "Got it" is
      interactive.
- [ ] A signed-in user's first committed YES / NO dismisses the coach with a
      brief confirm; "Got it" dismisses immediately without it.
- [ ] Once dismissed by either path, the coach never reappears on that device
      for that identity.
- [ ] No `data-coach-phase` / carousel / timer logic or CSS remains.
- [ ] `npm run check` and `npm run check:i18n` pass.

## Decisions

- The first-call signal is passed as a plain reactive prop rather than a
  shared store or a `window` event: the counter already lives one component
  up in the deck, so a prop is the most direct idiomatic wiring.
- Guests can reach the deck but cannot commit, so their only dismissal path
  is "Got it", accepted by design rather than special-casing guest copy.
