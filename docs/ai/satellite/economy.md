# VXP economy — award code

The governing rules (earn surfaces, caps, gates, anti-farming posture,
and the doc-drives-code reconciliation protocol) are in
[`economy.md`](../economy.md); the behaviour-level map is in
[`PRODUCT.md`](../PRODUCT.md#vxp-economy). This page is the
implementation side: the invariants every award change must respect,
and the checklist for adding a new award type.

## Invariants

Every server-fired VXP grant (streaks, referrals, calibration,
comeback, achievements, league founder, podium, tournament, …) follows
one pattern. Each of these has bitten a PR before:

- **Amounts are base units, always.** VXP has 4 decimals — derive
  every reward / floor / threshold constant via `parseToken`, never a
  raw int, and compare / transfer in base units (whole VXP is for
  display only). A raw int silently miscalibrates by 10⁴.
- **Parameters have one home.** All amounts, caps, and gates live in
  the canonical constants files (master:
  [`vxp-economy.constants.ts`](../../../src/lib/constants/vxp-economy.constants.ts));
  services import them. Never restate a value in a second file, a
  spec, or a comment.
- **A new award type lands in TWO places:** the `VxpAwardType` union
  in [`vxp-award.ts`](../../../src/lib/types/vxp-award.ts) **and** the
  `VxpAwardTypeSchema` Zod enum in
  [`vxp-award.schema.ts`](../../../src/lib/schema/vxp-award.schema.ts).
  `svelte-check` only catches the union — a missing enum entry fails
  at runtime.
- **Idempotency IS the doc key.** Award docs in `vxp_awards` are keyed
  `${recipient}/${awardType}/${awardKey}` via `vxpAwardKey()` — a
  retry collides with the existing doc and that collision is the
  dedup. No separate "already paid?" check; pick an `awardKey` that
  encodes the one-shot unit (league id, milestone, month).
- **Lifecycle is `pending → paid | failed`, then frozen.** Paid docs
  are immutable (`assertSetVxpAward`). A `failed` payout is re-driven
  through a settle/retry endpoint — there is no hook replay (see
  [hooks fire only for client writes](./patterns.md#hooks-fire-only-for-client-writes-never-for-serverless-setdocstore)),
  so endpoint-triggered payouts run **inline** in the endpoint.
- **Every award is a real ICRC transfer** through the shared payout
  service
  ([`vxp-payout.services.ts`](../../../src/satellite/services/vxp-payout.services.ts))
  — no satellite award path increments a counter instead of moving
  tokens.

## Adding a new award type — checklist

1. **Type, in both places:** add the member to the `VxpAwardType`
   union ([`vxp-award.ts`](../../../src/lib/types/vxp-award.ts)) and
   the `VxpAwardTypeSchema` Zod enum
   ([`vxp-award.schema.ts`](../../../src/lib/schema/vxp-award.schema.ts)),
   and document the trigger in the union's doc comment.
2. **Parameters:** add the constant(s) to
   [`vxp-economy.constants.ts`](../../../src/lib/constants/vxp-economy.constants.ts)
   in base units via `parseToken`.
3. **Service:** new
   `src/satellite/services/vxp-<surface>-awards.services.ts`
   mirroring an existing one (the streak service is the smallest
   template). Build the doc key with `vxpAwardKey()`, pay through
   [`vxp-payout.services.ts`](../../../src/satellite/services/vxp-payout.services.ts).
4. **Trigger:** a hook works only on a **client-written** collection
   (e.g. `profiles`, `activities`); anything fired from an endpoint
   must pay **inline** — never design "endpoint writes a row → hook
   pays" (see
   [patterns.md](./patterns.md#hooks-fire-only-for-client-writes-never-for-serverless-setdocstore)).
5. **`awardKey` choice:** encode the one-shot unit so the key
   collision is the idempotency (per the invariant above), and expose
   a settle/retry path if the payout can fail after the doc exists.
6. **Wire + regenerate:** register the hook / endpoint in
   [`src/satellite/index.ts`](../../../src/satellite/index.ts), run
   `npm run juno:functions:build`, commit the regenerated files.
7. **Docs, same PR:** add the surface to the earn-surfaces list in
   [`PRODUCT.md`](../PRODUCT.md#vxp-economy) (meta-update rule).
