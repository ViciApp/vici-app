# Spec: VXP call size from 10 to 200 in steps of 10

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#TBD)

## Goal

On the ViciXP balance domain, a prediction's call size is no longer a pick from a fixed ladder: it is
any multiple of 10 from 10 to 200 VXP (20 positions), defaulting to 50, chosen with one slider on
every surface that sizes a call (the Flow card back, the market detail confirmation sheet, the
landing Markets detail control). The 300 and 500 sizes disappear for everyone; a stored preference
that holds one of them restores as 200. Every surface previews the same net win, floored by the
unchanged `p_win` floor (`VXP_P_WIN_FLOOR`). The web2 API refuses sizes outside the set it can see.
Positions already open at any size stay as they are: nothing on the engine side is touched or
migrated.

The values above are the owner's decision for the constants in
[`vxp-economy.constants.ts`](../../../../src/lib/constants/vxp-economy.constants.ts). After this
spec ships, that file is their only home: code, docs and copy name the constants, never the numbers.

## Context

### Where the ladder lives today

Every read of the call size funnels through `VXP_CALL_SIZE_LADDER` and its helpers. A full search
(`CALL_SIZE`, `CallSize`, `callSize`, `isVxpCallSize`, `VXP_MIN_CALL_SIZE`, `snapToCallSizeLadder`,
`defaultAmount`) finds these sites:

| File                                                                                                            | What it does with the call size                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/constants/vxp-economy.constants.ts`                                                                    | Defines `VXP_CALL_SIZE_LADDER`, the literal-union type `VxpCallSize`, `VXP_MIN_CALL_SIZE` (destructured first rung), the membership predicate `isVxpCallSize`, and `VXP_DEFAULT_CALL_SIZE` typed as a rung. The ladder's doc comment calls its shape "curated, not arithmetic".                                                                                                                                                                                 |
| `src/lib/utils/vxp-economy.utils.ts`                                                                            | `snapToCallSizeLadder({ value })` snaps any number to the nearest rung (non-finite falls to the default). `vxpNetWin({ amount, pWin })` is the payout preview, floored by `VXP_P_WIN_FLOOR`.                                                                                                                                                                                                                                                                    |
| `src/lib/utils/trade.utils.ts`                                                                                  | `assertViciXpHumanPremium` throws unless `isVxpCallSize(amount)`; `executeOutcomeTrade` calls it for every ViciXp market before sizing the order (`qty = amountUsd / priceUsd`, whole contracts) and calling `placeOrder` with `maxSpendUsd`.                                                                                                                                                                                                                   |
| `src/lib/components/market/FlowMode.svelte`                                                                     | Restores `preferences.defaultAmount.flow` on entry and falls back to `VXP_MIN_CALL_SIZE` when the stored value is not a rung (`onMount`, the `isViciXp($balanceDomain)` branch). `MIN_CALL_MARGIN_USD` (out-of-funds takeover) and the `wont-finish` branch of `callSizeWarning` are both priced at `VXP_MIN_CALL_SIZE`. `handleAction` calls `assertViciXpHumanPremium` before `flowTradeService.executeTrade`. The guest branch records picks with no amount. |
| `src/lib/components/market/FlowCallSize.svelte`                                                                 | Snaps `tradeAmount` to a rung, maps rung to index and to a fill percentage, flags `atCap` on the last rung, previews both sides through `vxpNetWin`, and turns range-input indices back into rungs.                                                                                                                                                                                                                                                             |
| `src/lib/components/market/FlowCallSizeSlider.svelte`                                                           | Index-based `<input type="range">` (`max = ladder length - 1`) plus one radio peg button per rung (`role="radiogroup"`), peg positions computed from the rung index; label switches to `card.call_size_cap` at the cap.                                                                                                                                                                                                                                         |
| `src/lib/components/market/FlowCard.svelte`                                                                     | Front-face payout preview recomputes the formula inline with a hardcoded `0.05` instead of `VXP_P_WIN_FLOOR`, prices off the consensus probability (not the execution price `vxpNetWin` uses) and clamps to at least `+1`. `callSize = Math.max(VXP_DEFAULT_CALL_SIZE, amountNum)` feeds `FlowCardFooter`, so any call below the default would display as the default.                                                                                          |
| `src/lib/components/market/FlowCardFooter.svelte`, `FlowCardBack.svelte`                                        | Display and plumbing only (`callSize`, `tradeAmount`, `onCallSizeChange`, `callSizeWarning`).                                                                                                                                                                                                                                                                                                                                                                   |
| `src/lib/components/market/TradeModal.svelte` (market detail, via `src/routes/(app)/markets/[id]/+page.svelte`) | Index slider over the ladder (`sizeIndex`, starts at rung 0), `size = VXP_CALL_SIZE_LADDER[sizeIndex]`. Its doc comment justifies the index slider by the client guard. The "If right" preview is the **gross** return `Math.round(size / price)`, with no floor, unlike Flow's net `vxpNetWin`.                                                                                                                                                                |
| `src/lib/constants/landing-data.constants.ts`, `src/lib/components/landing/WelcomeHero.svelte`                  | `LANDING_HERO_CALL_SIZE` (equal to today's default) frames the signed-out hero's payoff math, which also skips the floor. `Welcome*` components are left untouched (a later PR removes them).                                                                                                                                                                                                                                                                   |
| Landing Markets detail control (`src/lib/components/landing/LandingMarkets*`, built in its own PR)              | A call-size slider over the full range with the default preselected, plus "earns N VXP" copy on the deck and Markets cards. Until this spec ships it must read the bounds and default from `vxp-economy.constants.ts`.                                                                                                                                                                                                                                          |

Persisted call size (the only stored copy of a size):

| Store                                   | Shape                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles` doc on the satellite         | `preferences.defaultAmount.flow` / `.manual`, strings, default `'0'` ("no stored size", `src/lib/constants/settings.constants.ts`). Schema `src/lib/schema/profile.schema.ts` (bundled into the satellite), hydration `withProfileDefaults` in `src/satellite/services/profile.services.ts` and `src/satellite/utils/wire-format.utils.ts`. |
| `profiles.preferences` on the web2 API  | Same shape, sanitized by `sanitizePreferences` in `backend/src/profiles/profile.ts` (`asString`, fallback `'0'`).                                                                                                                                                                                                                           |
| `vici.preferences.v1` in `localStorage` | The preferences store mirror (`src/lib/stores/preferences.store.ts`, `defaultAmount` is a store-owned leaf).                                                                                                                                                                                                                                |

No code path writes `defaultAmount.flow` today: the settings page has no control for it and Flow
only reads it. Any non-`'0'` value is a legacy write. The same field carries the playground domains'
fractional amounts (Flow's `FlowBottomBar` stepper), so it is not a VXP-only field.

### What the server sees

- **Satellite:** has no order path. On the web3 build the browser signs orders and sends them
  straight to the clearing canister (`submitLimitOrder` / `submitMarketOrder` in
  `src/lib/api/clearing.api.ts`, called from `placeOrder` in `src/lib/services/order.services.ts`).
  No satellite hook or assert sees a call or its size. The `activities` trade row (client-written)
  carries contract quantity in its title, not the call size.
- **Web2 API:** proxies orders in `backend/src/routes/engine.ts`. `POST /engine/orders/limit`
  receives `qty`, `priceValue`, `priceDecimals`, `side`, `seriesId`; `POST /engine/orders/market`
  receives one request **per book level** (`tradeId`, `matchingOrderId`, `qty`), because
  `walkMarketOrder` (`src/lib/utils/market-order.utils.ts`) walks the book client-side. No route
  knows the call size, and the API mirrors no call-size constant (`backend/src/vxp/constants.ts`,
  `backend/tests/shared-drift/vxp.test.ts`).
- **Engine (icdc-core):** `TradeError` in `src/declarations/clearing/clearing.did` has no size
  variant; it bounds an order only by margin (`InsufficientMargin`). Prices carry
  `PRICE_DECIMALS` (`src/lib/constants/app.constants.ts`), so settlement can pay a far larger
  multiple than the preview floor allows (the `vxpNetWin` doc comment states settlement applies no
  floor).

So today both the ladder and the `p_win` floor are **client-side only**, on both stacks. That
diverges from [`economy.md`](../../economy.md), which lists the call-size cap and the floor as the
bounds on the "Prediction win" surface. This spec closes the part of that gap the
web2 API can see (decision 1); the rest goes to the [icdc-core follow-up](#icdc-core-follow-up).

### Sizing arithmetic that depends on the minimum

`qty = floor(amountUsd / priceUsd)` in whole contracts, so the committed spend falls short of the
call size by less than one contract's price. At the current minimum that shortfall is under 2%; at
the new minimum it can approach 10% (a 10 VXP call at 0.97 commits 9.70). Quantity never rounds to
zero inside the range, since every price is below 1.

### Economy surfaces the bounds touch

- **Count-gated mints** read executed fills, not their size: Flow overtime (`VXP_FLOW_OVERTIME_*`),
  Flow volume milestones (`VXP_FLOW_MILESTONES`), streak days (an executed fill per UTC day,
  `VXP_STREAK_BONUSES`), achievements counted on fills (`first-call`, `oracle`, `on-fire`,
  `contrarian`), battle and tournament scoring (settled calls and wins,
  `backend/src/leagues/battles.ts` `deriveBattleWinner`), the Worlds podium (settled calls and wins).
  A lower minimum makes every one of those counts cheaper to reach in locked collateral.
- **Global leaderboard** ranks by a confidence-adjusted accuracy over settled call **counts**
  (`PRODUCT.md`, Global leaderboard): call size has no effect. The Dash "Top X%" tile reads the
  clearing net-P&L rank, which call size does move; a lower maximum compresses its spread.
- **Calibration and comeback** gate on balance floors, not on call size;
  `CALIBRATION_DEPLOY_FLOOR_BASE_UNITS` (deployed vs depleted) is independent of the minimum.
- **Battles** carry an optional displayed `amount` (`BATTLE_AMOUNT_*` in `src/lib/types/battle.ts`,
  validated in `src/satellite/services/battle.services.ts` and `backend/src/leagues/battles.ts`). It
  sizes no call and moves no VXP.

### Analytics already carrying the size

`placeOrder` tracks `position_taken` / `order_placed` with `value` = VXP actually committed and
`count` = contracts filled, without a `source`. `flow_swipe` (`FlowMode.svelte`, `handleAction`)
carries `source`, `marketId`, `label` (side) and no amount. Guest picks track `position_taken` with
`source: 'guest_flow'` and no amount.

## Scope

1. **Constants** (`vxp-economy.constants.ts`): replace `VXP_CALL_SIZE_LADDER` with
   `VXP_MIN_CALL_SIZE`, `VXP_MAX_CALL_SIZE`, `VXP_CALL_SIZE_STEP` and `VXP_DEFAULT_CALL_SIZE`, all in
   whole VXP. `VxpCallSize` becomes a branded `number` so `isVxpCallSize` still narrows.
   `isVxpCallSize(n)` is true when `n` is an integer, a multiple of `VXP_CALL_SIZE_STEP`, and inside
   `[VXP_MIN_CALL_SIZE, VXP_MAX_CALL_SIZE]`. A module-level check (or a unit test) pins that the
   minimum, the maximum and the default are themselves multiples of the step.
2. **Normalization util** (`vxp-economy.utils.ts`): `snapToCallSizeLadder` becomes
   `clampVxpCallSize({ value })`. Non-finite or not positive (including the `'0'` "no stored size")
   returns `VXP_DEFAULT_CALL_SIZE`. Otherwise it rounds to the nearest multiple of the step and
   clamps into `[VXP_MIN_CALL_SIZE, VXP_MAX_CALL_SIZE]`, so a stored 300 or 500 restores as the
   maximum.
3. **Client guard**: `assertViciXpHumanPremium` keeps its contract (throws on a value outside the
   set) with the new predicate; its message names the bounds and the step from the constants. It
   moves from `trade.utils.ts` to `vxp-economy.utils.ts` (see
   [Implementation notes](#implementation-notes)).
4. **Flow** (`FlowMode.svelte`): the restore uses `clampVxpCallSize` and falls back to
   `VXP_DEFAULT_CALL_SIZE` (not the minimum, which now differs from the default).
   `MIN_CALL_MARGIN_USD` and the `wont-finish` warning keep pricing at `VXP_MIN_CALL_SIZE`, which
   now means the true floor: a user with spendable VXP between the two minimums keeps calling
   instead of hitting the out-of-funds takeover.
5. **One call-size slider everywhere.** Flow (`FlowCallSize.svelte`, `FlowCallSizeSlider.svelte`),
   the market detail sheet (`TradeModal.svelte`) and the landing Markets control use the same
   control: a single value-based `<input type="range">` with `min` / `max` / `step` from the
   constants and `value` = the size itself (not an index). No preset or peg buttons: Flow's peg
   radio row (`flow-call-size-pegs`) and the index slider in `TradeModal` go. The control shows the
   size with its unit, sets `aria-valuetext` (`card.call_size_value`), works with the native range
   keys (arrows move one step, Home / End jump to the bounds) and flags `atCap` at
   `VXP_MAX_CALL_SIZE` (`card.call_size_cap` label). Flow keeps its `data-no-card-gesture` guard so
   a drag on the slider never swipes the card. Whether the three surfaces share one component or
   one set of constants plus styling is the implementer's call, per
   `docs/ai/frontend/reusability.md` (a shared component gets a row there).
6. **One payout preview everywhere: the net win through `vxpNetWin`**, floored by
   `VXP_P_WIN_FLOOR`, at the execution price (`resolveOutcomeExecutionPrice`), sub-1 shown as `<1`
   by `formatWholeVxpMagnitude`. The Flow card front (`FlowCard.svelte` `winYes` / `winNo`) drops
   its inline formula, hardcoded floor, consensus price and `+1` clamp. The market detail sheet's
   "If right" figure changes from the gross return to the net win. The landing Markets "earns N VXP"
   copy uses the same function.
7. **Flow card front** (`FlowCard.svelte`): `callSize` shows the actual size (drop the
   `Math.max(VXP_DEFAULT_CALL_SIZE, …)`).
8. **Market detail** (`TradeModal.svelte`): starts at `VXP_DEFAULT_CALL_SIZE` instead of the
   smallest size; doc comment rewritten for the range.
9. **Landing Markets control:** reads the constants, uses the slider of item 5 and previews with
   `vxpNetWin`. If the landing PR merges first it already reads them, and this PR only verifies it.
10. **Server-side bounds on the web2 API** (decision 1): see
    [Technical requirements](#technical-requirements-satellite--backend-mandatory) and
    [icdc-core follow-up](#icdc-core-follow-up).
11. **Analytics, all in this PR** (decision 7): see [Analytics](#analytics).
12. **Docs, same PR** (meta-update rule and `AGENTS.md` § 4 rule 10):
    - `economy.md`: the Prediction win row is backed by the call-size constants (no longer
      `VXP_CALL_SIZE_LADDER`). The caps section states plainly where the call-size bounds and the
      `p_win` floor are enforced and where they are not: the client guard on both builds and the
      web2 API's order routes enforce the call size; no satellite path and no engine rule does, so
      on the web3 build only the client enforces it; the floor is a preview only on both builds and
      settlement pays the raw cashflow; the icdc-core follow-up is the fix. Known farm vector 3 is
      extended: the lower minimum makes every count-gated mint (overtime, Flow milestones, streak
      days, fill-counted achievements, battle and tournament / podium tallies) cheaper in locked
      collateral, with the minimum qualifying call size spec as the recommendation. A bullet under
      "Design constraints" gives the range's rationale.
    - `PRODUCT.md`: the constants bullet under VXP economy says "call-size range"; a Behaviour index
      entry describes call sizing on every surface (one slider, the step, the default, the net-win
      preview, the stored-preference clamp), linking this spec.
    - `docs/ai/frontend/design.md` § 7.5: "call-size ladder" becomes the call-size slider.
    - `docs/ai/frontend/reusability.md`: rows for `vxp-economy.constants`, `vxp-economy.utils`, and
      the shared slider component if one is extracted.
    - `backend/README.md` "Mirrored constants": the API's `src/vxp/constants.ts` row names the
      call-size bounds and step.
13. **i18n**, in every catalog under `src/lib/constants/messages/`: `card.call_size_value`
    (`'{amount} VXP'`, the slider's `aria-valuetext`) and `trade.error.invalid_call_size` (the API
    refusal). No existing value names a size; `card.call_size_cap` keeps its meaning at the new
    maximum.

### Out of scope

- **The engine.** icdc-core gains no rule in this PR; see [icdc-core follow-up](#icdc-core-follow-up).
- **Open positions.** No migration: positions are engine state, sized in contracts, and stay valid.
- **Stored preferences.** No backfill or migration of stored profiles on either backend; a stored
  300 or 500 is clamped to the maximum when it is read (decision 4).
- **The playground domains** (USD / ICP): keep `FlowBottomBar`'s fractional stepper and their
  `defaultAmount.flow` values untouched.
- **Battle amount** (`BATTLE_AMOUNT_MIN` / `BATTLE_AMOUNT_MAX`): a displayed figure that sizes no
  call. Aligning its maximum to the call-size maximum is a separate product call.
- **`Welcome*` landing components** and `LANDING_HERO_CALL_SIZE`: removed by a later PR.
- **A minimum qualifying call size for awards**: a separate spec (see
  [Follow-ups](#follow-ups)); this PR adds no gate.

## Linked issues

Searching open issues was not possible from this session (no GitHub access). The implementer must
search the repository's open issues for "call size", "ladder", "premium" and "VXP_CALL_SIZE" before
flipping the status, and add `Closes #N` or `Part of #N` here and in the PR body. `economy.md`
tracks the related farm vectors under #543; this spec does not close it.

## Analytics

Instrument: the change exists to let players pick other sizes, and without the chosen size in the
data nobody can see whether they do. All of it ships in this PR (decision 7):

| Event (existing unless marked)   | Change                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow_swipe`                     | On a YES / NO swipe on the ViciXP domain, add `value` = the call size in whole VXP. Skips carry no `value`.                                                                                                                                                           |
| `position_taken`, `order_placed` | Add `source` (`flow` / `market_detail` / `landing`), threaded from the caller through `executeOutcomeTrade` into `placeOrder`. `value` keeps meaning "VXP committed" (after contract rounding), so `value / call size` exposes the rounding shortfall at small sizes. |
| `call_size_set` (**new**)        | Fired once per settled change of the slider (the range `change` event, not `input`), never on render or on restore. Props: `source` (`flow` / `market_detail` / `landing`), `value` (the size in whole VXP, inside the constants' range).                             |

The guest branch's `position_taken` keeps `source: 'guest_flow'` and carries no amount.

The new name lands in **both** halves of the dual-source pair, `src/lib/types/analytics-event.ts`
(TS union) and `src/lib/schema/analytics-event.schema.ts` (Zod enum), and in the API mirror
`ANALYTICS_EVENT_NAMES` in `backend/src/analytics/taxonomy.ts`
(`backend/tests/shared-drift/analytics.test.ts` pins all three). Capture goes through `track` in
`src/lib/services/analytics.services.ts`. The schema is bundled into the satellite
(`src/satellite/services/analytics.services.ts` imports `TrackEventInputSchema`), so the satellite
is regenerated: `npm run juno:functions:build`, `npm run quality`, the copy of
`src/declarations/satellite/{satellite.did.d.ts,satellite.factory.did.js}` into
`backend/src/declarations/satellite/`, and the output committed (`AGENTS.md` § 4 rule 9). `source`
values are a closed vocabulary and `value` a bounded number; no PII.

No event for the preference clamp: it fires at most once per legacy account and open question 1
answers the same question with one query.

## Technical requirements (satellite / backend: mandatory)

Values: every bound named here is a constant in
[`vxp-economy.constants.ts`](../../../../src/lib/constants/vxp-economy.constants.ts) (API mirror in
`backend/src/vxp/constants.ts`, pinned by `backend/tests/shared-drift/vxp.test.ts`); no number is
restated in code.

**Satellite.**

- Performance: no new hook, assert or endpoint; zero instruction-budget change. The satellite never
  sees an order, so it has nothing to validate a call against. The analytics write path validates
  one more enum member, which costs nothing measurable.
- Memory and storage: no new collection or doc shape. `profiles.preferences.defaultAmount.flow` stays
  a string; legacy 300 / 500 values stay stored and are clamped on read in the client. `events` docs
  gain no field (`value` and `source` already exist in the props vocabulary), so doc size and growth
  per event are unchanged; `call_size_set` adds at most one event per settled slider change.
- Why no assert on the preference: the field also holds the playground domains' fractional amounts,
  so a step-and-range assert on `profiles` would reject legitimate playground writes; and no code
  writes it for VXP today, so an assert would guard an unused path.
- Scalability: unaffected at 10× / 100× users, since nothing is added on-canister beyond one event
  name.
- Upgrade and compatibility: `juno:functions:build` reruns for the analytics enum. The build
  showed the event name **is** typed in Candid (a variant), so `satellite_extension.did` and the
  satellite declarations gain one `call_size_set` case in the track arguments and the two
  analytics read results. Additive: older clients still send valid arguments, and only the cockpit
  reads the results, which ships in the same build. No `juno.config.ts` rule change, not breaking.
- Security: no collection rule or caller permission touched.

**Web2 API (decision 1, option A).** The API rejects what it can see.

- Contract: `POST /engine/orders/limit` and `POST /engine/orders/market` gain an optional
  `callSize` body field (integer, whole VXP). For a ViciXp series (balance domain read with
  `registry.getSeries`) the API refuses with `invalid_call_size` (400) when `callSize` is not an
  integer, not a multiple of `VXP_CALL_SIZE_STEP`, or outside `[VXP_MIN_CALL_SIZE,
VXP_MAX_CALL_SIZE]`; when a limit order's notional (`qty` × the share cost: the price on a buy,
  its complement on a sell) exceeds `callSize` or falls short of it by a full share or more; and
  when a market leg's notional exceeds `callSize`. Without `callSize`, the limit notional and each
  market leg are checked against `VXP_MAX_CALL_SIZE` only; once the web app sends the field it
  becomes required for ViciXp series (see Rollout). Non-ViciXp series are untouched.
- Performance: per order, one `registry.getSeries` read (behind the shared TTL cache in
  `backend/src/engine/cache.ts`, so one canister query per series per TTL, usually zero) plus
  constant-time bigint arithmetic. Pricing a market leg needs the level price, so a market leg also
  reads `list_orders` for the series (a query, cacheable for the same TTL; the market body gains
  `seriesId` for it), because the clearing Candid has no get-order-by-id. A resting order's price
  never changes, so the cached book prices any order it holds; an order placed since is read
  fresh, and one still missing is looked up across every series, so a leg naming the wrong series
  is checked against the order it really takes. The ViciXp check reads the resting order's own
  series, never the client's `seriesId`. An order no book holds reaches the engine, which answers
  `order_not_found` as today. Order routes are
  user-paced (a Flow sitting is capped by the daily hard cap), so the added load is a few cached
  reads per call.
- Memory and storage: no migration, no table. Three mirrored integer constants.
- Scalability: the reads are cached per series, not per user, so 100× users on the same markets add
  no canister reads; no N+1 (one book read per leg at most, and a call has few legs).
- Compatibility: `invalid_call_size` joins the app's `ORDER_REJECTION_KEYS`
  (`src/lib/canisters/clearing.errors.ts`). `backend/tests/shared-drift/order-rejections.test.ts`
  compares that list against the engine-variant table `ORDER_REJECTIONS` only, so the API gains a
  named list of its own refusal codes that the drift test includes. The typed wrappers
  `submitEngineLimitOrder` / `submitEngineMarketOrder` in `src/lib/web2/client.ts` send `callSize`
  (and `seriesId` on the market leg).
- Security: value-moving routes (`docs/ai/governance.md` boundaries): the change only refuses, never
  widens; call it out in the PR body.

## icdc-core follow-up

GitHub is not reachable from this session, so the implementer files this issue on the icdc-core
repository and links it here and in the PR body. Proposed text:

> **Per-engine order size and payout floor for `eng_0`.** Vici's call size and `p_win` payout floor
> are enforced only by Vici's clients and, on the web2 build, by its API. A client talking to the
> clearing canister directly can open an order of any size, and settlement pays the raw
> `amount · (1/price − 1)` cashflow down to the smallest price `PRICE_DECIMALS` allows. Request: an
> engine-level rule, configurable per engine, that (1) refuses an opening order whose notional is
> outside a configured `[min, max]` or not a multiple of a configured step, with a new
> `TradeError` variant carrying the bounds, and (2) applies a configured floor on the price an
> opening order pays, or on the settlement multiple, so a long shot cannot pay more than the
> floored multiple. Vici's values live in its `vxp-economy.constants.ts`
> (`VXP_MIN_CALL_SIZE`, `VXP_MAX_CALL_SIZE`, `VXP_CALL_SIZE_STEP`, `VXP_P_WIN_FLOOR`).

Once it ships: bump `ICDC_CORE_VERSION`, `npm run did`, map the new variant in
`backend/src/engine/order-rejections.ts` and `src/lib/canisters/clearing.errors.ts`, and update the
enforcement statement in `economy.md` (`pr-and-ci.md` § 9). That is a separate Vici PR.

## Follow-ups

- **icdc-core issue** above.
- **Spec: minimum qualifying call size** (decision 5). A separate spec decides a minimum call size
  below which a fill does not count toward awards, streak days, Flow milestones, Flow overtime,
  achievements and the battle / tournament / podium tallies, on both stacks. It starts from the
  extended farm vector 3 in `economy.md`.

## Implementation outline

1. `vxp-economy.constants.ts`: min, max, step and default constants, branded `VxpCallSize`,
   step-and-range predicate `isVxpCallSize`; remove `VXP_CALL_SIZE_LADDER` and rewrite the doc
   comments (why a range with a step, why the default sits where it does).
2. `vxp-economy.utils.ts`: `clampVxpCallSize`; delete `snapToCallSizeLadder`.
3. `trade.utils.ts`: guard message from the constants; doc comment updated; `TradeParams` gains a
   `source` for analytics, passed to `placeOrder`.
4. Call-size slider (item 5 of Scope): value-based range, fill percentage
   `(size - min) / (max - min)`, `aria-valuetext`, `call_size_set` on `change`. Remove the peg row
   from `FlowCallSizeSlider.svelte` and the index slider from `TradeModal.svelte`.
5. `FlowMode.svelte`: restore through `clampVxpCallSize`, fallback to the default; `flow_swipe`
   carries `value`; update the comments of `MIN_CALL_MARGIN_USD` and the restore branch.
6. `FlowCard.svelte`: honest `callSize`; front preview through `vxpNetWin`.
7. `TradeModal.svelte`: shared slider, default start, net-win preview through `vxpNetWin`.
8. Landing Markets control: verify it uses the slider, the constants and `vxpNetWin` (or wire it, if
   this PR lands second), and passes `source: 'landing'`.
9. API (Technical requirements): mirror min, max and step in `backend/src/vxp/constants.ts` +
   `backend/tests/shared-drift/vxp.test.ts` (`extractIntConst`); validate in
   `backend/src/routes/engine.ts`; refusal code on both sides plus the drift test; `callSize` in
   `src/lib/web2/client.ts`; route tests in `backend/tests/engine.test.ts`.
10. Analytics: union, Zod enum, API taxonomy, `track` calls, satellite regeneration and declaration
    copy.
11. i18n keys in every catalog; `npm run check:i18n`.
12. Docs listed in Scope item 12; flip this spec to `In progress (#PR)` when the PR opens and to
    `Implemented (#PR)` in the final commit.

## Test plan

- **Unit (`npm test`)**, new `src/tests/lib/utils/vxp-economy.utils.spec.ts` (which also holds the
  guard's cases, see [Implementation notes](#implementation-notes)) and
  `src/tests/lib/constants/vxp-economy.constants.spec.ts`:
  `isVxpCallSize` accepts min, default, max and every multiple of the step between; rejects
  min − step, max + step, a value between two steps (min + 1), non-integers, `NaN`, `Infinity`,
  negatives, 300, 500. `clampVxpCallSize`: `'0'` and non-finite give the default; 300 and 500 give
  the max; a value below the minimum gives the min; a value between two steps rounds to the nearest
  step; the default round trips. `assertViciXpHumanPremium` throws outside the set and for a
  fractional string, passes inside. `vxpNetWin` at min and max sizes with a price under the floor.
  The constants test pins min, max and default as multiples of the step.
- **API (`cd backend && bun run typecheck && bun test`, real Postgres)**: on a ViciXp series a limit
  order is refused below min, above max, off the step, non-integer, and when the notional disagrees
  with the declared size; accepted at min, default and max; a market leg above `callSize` refused;
  a non-ViciXp series unaffected. Shared-drift: bounds mirror, refusal code list, analytics taxonomy.
- **Component / manual**: Flow on the ViciXP domain at 360x640 and 1440x900: the slider starts at
  the stored size (or the default), reaches min and max by drag and keyboard in steps, `atCap` label
  at max, warnings at the new floor, the card front shows a below-default size honestly and the
  same net win as the back. The market detail sheet starts at the default and shows the net win. A
  drag on Flow's slider never swipes the card. Under every `[data-theme]` and with reduced motion.
- **Stored preference**: a profile (satellite and web2) holding `defaultAmount.flow = '500'` opens
  Flow at the max; `'0'` at the default.
- **Analytics**: one `call_size_set` per slider release, none on open; `flow_swipe.value` on YES /
  NO only; `position_taken.source` per surface.
- **Gates**: `npm run quality`, `npm run check`, `npm run check:dashes`, `npm test`,
  `npm run juno:functions:build`, backend suite.

## Rollout and risks

- **Order of deploys.** Web app first (client guard, slider, `callSize` sent), then the API
  requiring `callSize` for ViciXp series: an API that requires the field before the web app sends
  it would refuse every web2 call. The field stays optional for one release for that reason.
- **Rounding shortfall at the minimum.** The "if wrong" row shows the call size, while the commit can
  be up to one contract price lower; already true today at a smaller ratio. Acceptable;
  `position_taken.value` makes it measurable.
- **Cheaper count farming.** The lower minimum cuts the collateral a farmer must lock to rack up
  counted calls. The rolling overtime cap and one-time milestone keys still bound the mints; the
  qualifying-size spec is the follow-up.
- **Web3 stays client-enforced** until the icdc-core follow-up ships: a modified client can still
  send any size to the clearing canister, as it can today. `economy.md` says so.
- **Mixed clients.** A cached older web app still offers the 300 and 500 sizes until reload; the
  web2 API refuses them (above the maximum even without `callSize`) and the client shows the
  refusal message. On web3 they would still place.
- **Market detail number changes.** The "If right" figure drops from the gross return to the net
  win; the PR body says so for reviewers.

## Acceptance criteria

- [ ] `VXP_CALL_SIZE_LADDER` and `snapToCallSizeLadder` no longer exist; no code outside
      `vxp-economy.constants.ts` and its pinned API mirror states a call-size number.
- [ ] Every multiple of `VXP_CALL_SIZE_STEP` from `VXP_MIN_CALL_SIZE` to `VXP_MAX_CALL_SIZE` can be
      placed from Flow, the market detail sheet and the landing Markets control on the ViciXP
      domain; nothing else can, through the client guard.
- [ ] Flow, market detail and the landing use one slider, with no preset or peg buttons.
- [ ] Flow and the market detail sheet open at `VXP_DEFAULT_CALL_SIZE` when no size is stored; a
      stored size above the maximum opens at the maximum.
- [ ] Every payout preview is the net win from `vxpNetWin`; the market detail sheet no longer shows
      the gross return.
- [ ] The Flow card front shows the actual call size, including sizes below the default.
- [ ] The out-of-funds takeover and the `wont-finish` warning price at the new minimum.
- [ ] The web2 API refuses, on ViciXp series, a `callSize` that is non-integer, off the step or
      outside the range, and an order whose notional does not match it, with `invalid_call_size`.
- [ ] `flow_swipe.value`, `position_taken.source` and `call_size_set` ship; `call_size_set` is in the
      union, the Zod enum and the API taxonomy; the satellite is regenerated; drift suite green.
- [ ] `economy.md` states where the call-size bounds and the floor are enforced and where they are
      not, and extends farm vector 3; `PRODUCT.md`, `design.md` § 7.5 and `reusability.md` are
      updated in the same PR.
- [ ] The icdc-core follow-up issue is filed and linked, or its text is in the PR body if GitHub is
      still unreachable.
- [ ] Every new key in every catalog; `npm run quality`, `npm run check`, `npm test`,
      `npm run check:dashes` and the backend suite pass.

## Open questions

1. **How many stored profiles hold a VXP `defaultAmount.flow` other than `'0'`, and how many above
   the maximum?** No current code writes the field. One `SELECT` over
   `profiles.preferences->'defaultAmount'->>'flow'` on the web2 database and one controller scan of
   the satellite `profiles` collection answer it. The decision is a clamp on read with no backfill
   either way; the count sizes the effect for the PR body.
2. **Does icdc-core bound an order's size or price for engine `eng_0` anywhere, or plan to?** The
   Candid `TradeError` has no such variant and the client comment says settlement applies no payout
   floor. The icdc-core owner can confirm; the answer shapes the follow-up issue (a new engine
   feature or a configuration).
3. **Does the landing Markets control carry the chosen size through sign-up into a real order?** If
   a signed-out pick survives sign-up and is placed afterwards, the guest pick record
   (`recordGuestPick`, today side only) must store the size and the placement path must validate it.
   The landing Markets brief owns the answer.

## Implementation notes

Divergences found against the code while building, fixed in this PR:

- **The guard moved to `vxp-economy.utils.ts`.** `trade.utils.ts` imports the order service,
  which the node test runner cannot load (it pulls in SvelteKit's `$app` modules), so a
  `trade.utils.spec.ts` could not run. `assertViciXpHumanPremium` is a pure economy check, so it
  now lives next to `clampVxpCallSize` and is tested there; `trade.utils.ts` and Flow import it.
- **A binary NO limit order was priced in the wrong frame.** `executeOutcomeTrade` passes the
  YES-framed price (`1 − NO price`) and `placeOrder` turned it back into the NO price before
  sending it as the price of a YES sell, so a NO call on a market with no bid rested as a YES ask
  at the NO price and blocked more than the call size in margin. The engine now receives the
  YES-framed price. Without this, the API rule on a limit order's notional would refuse every such
  NO call.
- **A limit order is sized on the price the engine receives.** Sizing divided the call size by
  the execution price at clearing USD precision, while the order went out rounded to
  `PRICE_DECIMALS`, so the notional could land above the call size or a whole share short of it,
  which the API rule refuses. A limit order is now sized on that exact price (`shareCostUsd` in
  `market-order.utils.ts`, the general form of `levelShareCostUsd`). Market orders are unchanged:
  `maxSpendUsd` already caps every level they take.
- **One shared control:** `CallSizeSlider` (`src/lib/components/market/`) carries the label (cap
  label at the maximum), the value with its unit and the range, and fires `call_size_set`. The
  market detail sheet shows the size in that control's readout instead of its own larger figure.
- **Landing Markets.** The landing Markets control on its own branch steps an index over the
  ladder through two helpers it adds to `vxp-economy.utils.ts` (`callSizeStops`,
  `callSizeStopIndex`). Whichever PR merges second mounts `CallSizeSlider` there with
  `source: 'landing'`, previews with `vxpNetWin` and drops those helpers; this PR does not touch
  landing files.
- **`flow_swipe.value`** is sent on every YES / NO on the ViciXP domain, as the Analytics table
  says, which includes a guest's swipe (at the size the guest's slider shows).
- **Linked issues** were still not searchable from this session (no GitHub access).

## Decisions

- **Range, step, default and floor** (owner): multiples of 10 from 10 to 200 VXP (20 positions),
  default 50, on every surface that sizes a call; the 300 and 500 sizes go for everyone;
  `VXP_P_WIN_FLOOR` stays; open positions stay valid. The values live in constants (min, max, step,
  default).
- **1. Enforcement** (owner): option A in this PR. The web2 API rejects what it can see: a call
  size off the step, outside the range or not an integer, and orders whose notional does not match
  it. The satellite has no order path, so it adds no check. A size rule plus payout floor in
  icdc-core (option C) is a follow-up, written above for the implementer to file. `economy.md`
  states plainly where the limit is enforced and where it is not. Rejected: B (the API owning the
  book walk, exact but a large duplicate of `walkMarketOrder`) and D (client-only).
- **2. One control everywhere** (owner): a slider only, in Flow, market detail and the landing; no
  preset buttons. It replaces Flow's ladder slider with its peg row and the market detail index
  slider.
- **3. Step** (owner): `VXP_CALL_SIZE_STEP` of 10, so 20 positions; the API validates the step too.
  Rejected: a step of 1 (literally any whole amount, imprecise to drag on a swipe card).
- **4. Stored preferences** (owner): a stored 300 or 500 is clamped to the maximum when read; no
  backfill or migration of stored profiles.
- **5. Anti-farming** (owner): no gate in this PR. Farm vector 3 in `economy.md` is extended, and a
  separate spec for a minimum qualifying call size is an explicit follow-up.
- **6. Payout preview** (owner): the net win through `vxpNetWin`, with the floor, on every surface;
  market detail changes from gross to net.
- **7. Analytics** (owner): all in this PR: `value` on `flow_swipe`, `source` on `position_taken`
  (`flow` / `market_detail` / `landing`), and the new `call_size_set` event, with the dual-source
  pair and the satellite regeneration.
