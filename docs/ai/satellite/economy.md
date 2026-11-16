# VXP economy: award code

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

- **Amounts are base units, always.** VXP has 4 decimals; derive
  every reward / floor / threshold constant via `vxpBaseUnits`, never a
  raw int, and compare / transfer in base units (whole VXP is for
  display only). A raw int silently miscalibrates by 10⁴.
- **Parameters have one home.** All amounts, caps, and gates live in
  the canonical constants files (master:
  [`vxp-economy.constants.ts`](../../../src/lib/constants/vxp-economy.constants.ts));
  services import them. Never restate a value in a second file, a
  spec, or a comment.
- **A new award type has one app home:** the `VxpAwardType` union
  in [`vxp-award.ts`](../../../src/lib/types/vxp-award.ts). The API
  derives its type and runtime guard from `VXP_AWARD_TYPES` in
  [`backend/src/vxp/awards.ts`](../../../backend/src/vxp/awards.ts);
  the shared-drift suite fails until that array is the union plus
  `onboarding`, and the awards suite until the `vxp_awards.award_type`
  check constraint admits exactly it.
- **Idempotency IS the doc key.** Award docs in `vxp_awards` are keyed
  `${recipient}/${awardType}/${awardKey}` via `vxpAwardKey()`; a
  retry collides with the existing doc and that collision is the
  dedup. No separate "already paid?" check; pick an `awardKey` that
  encodes the one-shot unit (league id, milestone, month). When the
  unit is coarser than an old key, the old keys must still block: the
  tournament prize is keyed on the tournament alone, and
  `decideTournamentPrize`
  ([`tournament-prize.utils.ts`](../../../src/satellite/utils/tournament-prize.utils.ts))
  also treats a doc under any per-place key (`<tournamentId>_place_<n>`)
  of an earlier claim as claimed; `assertSetVxpAward` refuses a new
  prize under a per-place key.
- **Lifecycle is `pending → paid | failed`, then frozen.** Paid docs
  are immutable (`assertSetVxpAward`). A `failed` payout is re-driven
  through a settle/retry endpoint; there is no hook replay (see
  [hooks fire only for client writes](./patterns.md#hooks-fire-only-for-client-writes-never-for-serverless-setdocstore)),
  so endpoint-triggered payouts run **inline** in the endpoint.
- **Award docs are never deleted by a client.** The collection is
  `write: 'public'`, so any client could delete one and reopen its key
  for a second payout. `assertDeleteVxpAward` rejects every delete
  whose caller is not a satellite controller. Serverless
  `deleteDocStore` runs the assert too, so a satellite path that must
  remove award docs (the account purge in `hardDeleteAccountFn`) signs
  as `controllerCaller(...)`.
- **Eligibility times are server-stamped.** A gate on when something
  happened (a join, an activity day) reads a time the satellite wrote:
  the doc's Juno `created_at` or `timeMs()`, never a caller-written `*Ms`
  field, which an assert can only hold to a tolerance. The Worlds
  podium pays only a slot whose `created_at` precedes the month's close
  (`joinedBeforeMonthClose` in
  [`worlds-podium.utils.ts`](../../../src/satellite/utils/worlds-podium.utils.ts)).
- **A calibration call is judged once.** `judgeCalibrationCall`
  ([`vxp-calibration.services.ts`](../../../src/satellite/services/vxp-calibration.services.ts))
  records the first side called on a market in the controllers-scoped
  `calibration_attempts` collection before comparing it with the outcome,
  as the API does in its table of the same name: a miss is on record, and
  a later call on the other side is refused (`already_called`).
- **Every award is a real ICRC transfer** through the shared payout
  service
  ([`vxp-payout.services.ts`](../../../src/satellite/services/vxp-payout.services.ts));
  no satellite award path increments a counter instead of moving
  tokens.
- **Payout state is server-owned.** A doc whose status the payout trusts
  (`owed` pays, `paid` below the expected amount tops up) must be one no
  client can rewrite or delete, or the owner is paid again. The
  `vxp_onboarding` ladder is set and deleted by a satellite controller
  only (`assertVxpOnboardingWrite`), and the onboarding hooks write it as
  `controllerCaller(...)`; the calibration engagement gate reads the same
  doc. The `referrals` record is the same: `assertSetReferral` accepts only
  a controller, a paid side never changes again, and a new record must
  satisfy the redemption rules itself (a profile, inside the signup window,
  both sides unarmed), so a direct write cannot skip
  `redeemReferralCode`. Only a controller deletes one, since a deleted
  record would let its referee redeem again.
- **What decides an award is server-written too.** A claim endpoint
  that pays from a doc (the tournament prize reads the concluded
  bracket) is only as safe as that doc. `tournaments` and
  `tournament_matches` are `write: 'public'`, so their asserts accept
  only a satellite controller, and the draw and resolution endpoints
  write as `controllerCaller(...)` (see
  [endpoint-computed docs](./patterns.md#endpoint-computed-docs-controller-only-assert)).

## Adding a new award type: checklist

1. **Type:** add the member to the `VxpAwardType` union
   ([`vxp-award.ts`](../../../src/lib/types/vxp-award.ts)) and
   document the trigger in the union's doc comment. On the API side,
   add it to `VXP_AWARD_TYPES`
   ([`backend/src/vxp/awards.ts`](../../../backend/src/vxp/awards.ts))
   and widen the `vxp_awards.award_type` check constraint in a new
   migration.
2. **Parameters:** add the constant(s) to
   [`vxp-economy.constants.ts`](../../../src/lib/constants/vxp-economy.constants.ts)
   in base units via `vxpBaseUnits`.
3. **Service:** new
   `src/satellite/services/vxp-<surface>-awards.services.ts`
   mirroring an existing one (the streak service is the smallest
   template). Build the doc key with `vxpAwardKey()`, write the
   `pending` doc and its `paid` / `failed` outcome with `persistAward` /
   `updateAward` from
   [`vxp-awards.services.ts`](../../../src/satellite/services/vxp-awards.services.ts),
   pay through
   [`vxp-payout.services.ts`](../../../src/satellite/services/vxp-payout.services.ts).
4. **Trigger:** a hook works only on a **client-written** collection
   (e.g. `profiles`, `activities`); anything fired from an endpoint
   must pay **inline**; never design "endpoint writes a row → hook
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
