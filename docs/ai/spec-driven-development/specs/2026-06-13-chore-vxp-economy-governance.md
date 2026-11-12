# Spec: VXP economy governance doc

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#870)

## Goal

Make the VXP economy a first-class, governed part of the product:
introduce a single canonical policy page —
[`docs/ai/economy.md`](../../economy.md) — that states the compulsory
rules of the VXP economy (earn surfaces, caps, gates, anti-farming
intent) and a **reconciliation protocol** that makes those documented
rules authoritative for economy _policy_. Today the economy is spread
across three constants files plus implementation notes, with no page
that says _what the economy must be_ and _how the code stays in sync
with it_. After this change, an agent that finds the code diverging
from a documented economy rule has one place that tells it the rule is
authoritative — and is prompted to propose anti-farming improvements
while reconciling.

Documentation-only: no `src/**` change. Every numeric value stays in
its constants file (the writing-for-agents rule forbids restating
numbers in docs); the new page references the constants, never copies
them.

## Context

Today the economy lives in:

- [`src/lib/constants/vxp-economy.constants.ts`](../../../../src/lib/constants/vxp-economy.constants.ts)
  — master tunables (stake ladder, streaks, flow milestones,
  calibration, comeback, podium, league founder, caps).
- [`src/lib/constants/referral.constants.ts`](../../../../src/lib/constants/referral.constants.ts)
  — referral bonuses, diminishing curve, hard cap, signup window.
- [`src/lib/constants/vxp-onboarding.constants.ts`](../../../../src/lib/constants/vxp-onboarding.constants.ts)
  — registration grant.
- [`docs/ai/satellite/economy.md`](../../satellite/economy.md) —
  implementation invariants + new-award-type checklist.
- [`docs/ai/PRODUCT.md`](../../PRODUCT.md) §VXP economy — a short
  behaviour summary.
- Award type union + Zod mirror:
  [`vxp-award.ts`](../../../../src/lib/types/vxp-award.ts) /
  [`vxp-award.schema.ts`](../../../../src/lib/schema/vxp-award.schema.ts);
  payouts through
  [`vxp-payout.utils.ts`](../../../../src/satellite/utils/vxp-payout.utils.ts),
  recorded in the `vxp_awards` collection.

What is missing is the **policy layer**: the rules the numbers serve,
the rationale for the deliberate constraints, the anti-farming posture,
and an explicit doc-drives-code reconciliation rule for the economy.

The new page is a cross-area topic page (the economy spans the
SvelteKit preview UI and the authoritative satellite payouts), so it
sits at the top of `docs/ai/` alongside `PRODUCT.md` and
`governance.md`, per the writing-for-agents layering guidance in
[`governance.md`](../../governance.md#structure-hierarchical-scoped-layered).

### Reconciliation against the canonical economy design

The shipped economy was reconciled rule-by-rule against the canonical
VXP economy design. Each divergence was reviewed with the product
owner; outcomes are recorded under **Decisions**. The headline is that
**every divergence resolved to "the shipped code is the rule — adapt
the documentation to it,"** with the farm vectors recorded as
anti-farming recommendations rather than fixed in this PR.

## Scope

1. **New** [`docs/ai/economy.md`](../../economy.md) — the governing
   page. Sections: the reconciliation protocol; economy principles
   (earn-only, no sinks, expected-vs-actual authority); the earn
   surfaces and their gating (by reference to the constants, no
   numbers); the caps-and-gates anti-farming spine; the known open
   farm vectors as flagged recommendations; and the design constraints
   with their rejected alternatives (stated standalone). Voice and
   layering per `governance.md`.
2. **Edit** [`docs/ai/PRODUCT.md`](../../PRODUCT.md) §VXP economy —
   add an up-link to the new governing page (smallest delta; the
   behaviour summary stays).
3. **Edit** [`docs/ai/governance.md`](../../governance.md) truth
   hierarchy — a one-line cross-reference noting the scoped
   economy-policy reconciliation exception, so the hierarchy is not
   silently contradicted.
4. **Edit** [`docs/ai/satellite/economy.md`](../../satellite/economy.md)
   — a back-link to the new policy page (it already points up to
   `PRODUCT.md`).

### Out of scope

- **Any constants / behaviour change.** All four reviewed farm vectors
  (onboarding sybil, repeatable overtime mint, league-founder mint,
  and the activity-log payout trigger) are **documented as
  recommendations only** — see Decisions and the new page's
  anti-farming section. Implementing any of them is a follow-up.
- **Closing #543 or #350** — referenced as tracking issues for the
  documented vectors, not fixed here.
- **The prototype design doc** itself — it lives outside this repo and
  is not modified or referenced by path/version in any committed file
  (house rule: no external/prototype refs in code or docs).

## Linked issues

- **Part of #543** (_Anti-farm: gate referral/onboarding payouts on an
  authoritative trade, not the client-written activity log_) — this
  spec documents the vector and names #543 as its tracking issue; it
  does **not** fix it, so no closing keyword.
- **References #350** (_Real VXP credit path for flow-session grants —
  deferred_) — the flow-milestone and overtime constants are defined
  but not yet minting; the new page states this and points at #350.
  Not closed here.
- No issue is fully fixed by this doc-only change.

## Analytics

None. This is a documentation/governance change — it adds no user
surface and no runtime behaviour, so there is nothing to instrument.
(Stated explicitly per the workflow's required analytics analysis.)

## Technical requirements (satellite / backend)

Not applicable — no `src/satellite/**`, collection, schema, binding,
or icdc-core-facing change. No `.did` regeneration. The page cites the
canonical constants files for every value rather than restating them,
so there is no second copy to drift.

## Implementation outline

1. Write [`docs/ai/economy.md`](../../economy.md) per the section list
   in Scope, in the declarative/imperative `docs/ai/` voice, linking
   every rule to the constant / type / util that backs it, and naming
   no prototype/version/external path.
2. Add the up-link from `PRODUCT.md` §VXP economy (one sentence).
3. Add the truth-hierarchy cross-reference in `governance.md` (one
   bullet/line).
4. Add the back-link in `satellite/economy.md`.
5. `npm run quality` (prettier `--check` covers the markdown) and
   `npm run check`.
6. Flip this spec's status to `In progress (#PR)` when the PR opens,
   then `Implemented (#PR)` in the final commit; update `PRODUCT.md`
   in the same PR (done in step 2).

## Acceptance criteria

- [ ] `docs/ai/economy.md` exists and contains: the reconciliation
      protocol, principles, earn-surface rules, the caps/anti-farming
      spine, the open-vector recommendations, and the
      rejected-alternatives rationale.
- [ ] The page restates **no** numeric economy value — every amount,
      cap, and gate is a link to its constant.
- [ ] The page names no prototype, version marker, or external repo /
      folder path.
- [ ] `PRODUCT.md` §VXP economy links up to the new page; the existing
      behaviour summary is intact.
- [ ] `governance.md` truth hierarchy cross-references the scoped
      economy-policy reconciliation exception.
- [ ] `satellite/economy.md` links to the new page.
- [ ] The four reviewed farm vectors appear in the page's anti-farming
      section as recommendations, with #543 / #350 cited where they
      track.
- [ ] `npm run quality` and `npm run check` pass.

## Decisions

Per-divergence review with the product owner (2026-06-13). Prototype
position → shipped behaviour → outcome:

- **Sinks / closed economy** — design model has stake-forfeiture and
  bout-entry sinks; shipped is earn-only (stakes are on-chain clearing
  collateral, not forfeited). **Ratify shipped**; document that
  inflation is bounded by per-surface caps and the zero-sum clearing
  engine, not by VXP sinks.
- **Comeback restore** — design model removed it in favour of a single
  calibration recovery path; shipped re-added comeback **and** kept
  calibration. **Code is the rule — adapt the docs:** document both as
  distinct mechanics (comeback = returning-after-absence nudge;
  calibration = active skill-climb while present). No new cap.
- **Onboarding grant** — flat registration grant, no engagement gate;
  combined with the referee bonus it is the largest single-account
  mint. **Ratify**; document as the primary sybil vector, mitigated by
  Internet-Identity-gated sign-up. Tracking: #543.
- **Flow volume milestones** — new one-time mints; **ratify**, document
  (bounded: lifetime one-time). Credit path deferred (#350).
- **Flow overtime bonus** — new repeatable daily mint, gated on raw
  call count. Credit path deferred (#350), so the farm is latent.
  **Document the risk** (when #350 wires it, add a distinct-markets /
  min-stake gate); no code change now.
- **Calibration caps** — daily cap matches; shipped adds a tighter
  hourly burst cap. **Ratify** (pure hardening); document.
- **League-founder reward** — new mint with a lifetime per-account cap;
  founding is a free write, so the capped total is still a low-cost
  mint. **Document the risk** (recommend a membership/activity quality
  gate); no code change now.
- **Referral limits** — shipped adds a hard lifetime cap (curve → 0
  past it) and a post-signup redemption window absent from the design
  model. **Ratify** (hardening); document.
- **Stake ladder, p_win floor, streak tiers, worlds podium** — match;
  ratify, no change.

Structural decisions:

- **One canonical page, top-level** (`docs/ai/economy.md`) over
  expanding `PRODUCT.md` or splitting per surface — the economy is one
  system spanning FE preview and satellite payouts; a single
  cross-area policy page matches the writing-for-agents layering and
  keeps the anti-farming posture readable as a whole.
- **Doc-drives-code, scoped to economy policy** — the default truth
  hierarchy (code wins) is locally inverted **only** for economy
  _rules_ (caps/gates/surface intent): the page is authoritative, an
  agent reconciles code to it and proposes anti-farming improvements.
  _Values_ still live in constants; `PRODUCT.md` still describes
  shipped reality. The exception is declared on the page and
  cross-referenced from `governance.md` so the hierarchy stays
  coherent.
