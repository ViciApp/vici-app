# Spec: Free VXP call size from 10 to 200

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

## Goal

On the ViciXP balance domain, a prediction's call size is no longer a pick from a fixed ladder: it is
any whole amount from 10 to 200 VXP, defaulting to 50, on every surface that sizes a call (the Flow
card back, the market detail confirmation sheet, the landing Markets detail control). The 300 and 500
sizes disappear for everyone; a stored preference that holds one of them restores as 200. Positions
already open at any size stay as they are: nothing on the engine side is touched or migrated. The
payout floor on `p_win` (`VXP_P_WIN_FLOOR`) is unchanged.

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
bounds on the "Prediction win" surface. [Pending decision 1](#pending-decisions) settles how far
this spec closes that gap.

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
   `VXP_MIN_CALL_SIZE`, `VXP_MAX_CALL_SIZE`, `VXP_DEFAULT_CALL_SIZE` (whole VXP), plus the step and
   presets constants that [pending decisions](#pending-decisions) 2 to 4 settle. `VxpCallSize`
   becomes a branded `number` so `isVxpCallSize` still narrows. `isVxpCallSize(n)` is
   `Number.isInteger(n) && n >= VXP_MIN_CALL_SIZE && n <= VXP_MAX_CALL_SIZE`.
2. **Normalization util** (`vxp-economy.utils.ts`): `snapToCallSizeLadder` becomes
   `clampVxpCallSize({ value })`: non-finite or not positive (including the `'0'` "no stored size")
   returns `VXP_DEFAULT_CALL_SIZE`; otherwise round to the nearest integer and clamp into
   `[VXP_MIN_CALL_SIZE, VXP_MAX_CALL_SIZE]`. A stored 300 or 500 therefore restores as the maximum.
3. **Client guard** (`trade.utils.ts`): `assertViciXpHumanPremium` keeps its contract (throws on a
   non-member) with the new predicate; its message names the bounds from the constants.
4. **Flow** (`FlowMode.svelte`): the restore uses `clampVxpCallSize` and falls back to
   `VXP_DEFAULT_CALL_SIZE` (not the minimum, which now differs from the default).
   `MIN_CALL_MARGIN_USD` and the `wont-finish` warning keep pricing at `VXP_MIN_CALL_SIZE`, which
   now means the true floor: a user with spendable VXP between the two minimums keeps
   calling instead of hitting the out-of-funds takeover.
5. **Flow call-size control** (`FlowCallSize.svelte`, `FlowCallSizeSlider.svelte`): value-based
   range input (`min`/`max`/`step` from the constants, `value` = the size itself, not an index),
   `aria-valuetext` with the unit, `atCap` at `VXP_MAX_CALL_SIZE`. Presets per pending decision 2.
6. **Flow card front** (`FlowCard.svelte`): `callSize` shows the actual size (drop the
   `Math.max(VXP_DEFAULT_CALL_SIZE, …)`), and the front-face preview uses `VXP_P_WIN_FLOOR` instead
   of the hardcoded floor; the full unification is pending decision 6.
7. **Market detail** (`TradeModal.svelte`): the same control as Flow (pending decision 2), starting
   at `VXP_DEFAULT_CALL_SIZE` instead of the smallest size; doc comment rewritten for the range.
8. **Landing Markets control:** reads the three constants and previews with `vxpNetWin`; if the
   landing PR merges first it already reads them, and this PR only verifies it.
9. **Server-side bounds** per pending decision 1 (recommended option below).
10. **Docs, same PR** (meta-update rule and `AGENTS.md` § 4 rule 10): `economy.md` (Prediction win
    row backed by the new constants; the caps section states the range and, honestly, where it is
    enforced; known farm vector 3 updated for the lower minimum; a rationale bullet for the range
    under "Design constraints"); `PRODUCT.md` (the constants bullet under VXP economy says "call-size
    range"; a Behaviour index entry for call sizing on every surface, linking this spec);
    `docs/ai/frontend/design.md` § 7.5 ("call-size ladder" becomes the range control);
    `docs/ai/frontend/reusability.md` rows for `vxp-economy.constants` and `vxp-economy.utils`;
    `backend/README.md` "Mirrored constants" row if the API mirrors the bounds.
11. **i18n:** no existing value names a size. New keys only if the control needs them (a preset
    group label, a call-size `aria-valuetext` such as `card.call_size_value: '{amount} VXP'`, and the
    API refusal message under pending decision 1), added to every catalog under
    `src/lib/constants/messages/`. `card.call_size_cap` keeps its meaning at the new maximum.
12. **Analytics** per [Analytics](#analytics) and pending decision 7.

### Out of scope

- **The engine.** icdc-core gains no size rule in this PR; if pending decision 1 picks the engine
  option it is a separate icdc-core PR first, then the wiring here (`pr-and-ci.md` § 9).
- **Open positions.** No migration: positions are engine state, sized in contracts, and stay valid.
- **The playground domains** (USD / ICP): keep `FlowBottomBar`'s fractional stepper and their
  `defaultAmount.flow` values untouched.
- **Battle amount** (`BATTLE_AMOUNT_MIN` / `BATTLE_AMOUNT_MAX`): a displayed figure that sizes no
  call. Aligning its maximum to the call-size maximum is a separate product call.
- **`Welcome*` landing components** and `LANDING_HERO_CALL_SIZE`: removed by a later PR.
- **A qualifying call size for count-gated mints**: proposed under pending decision 5; if adopted it
  is its own spec, since it changes several award paths on both stacks.
- **Engine-side `p_win` floor enforcement**: recorded under open question 2, not changed here.

## Linked issues

Searching open issues was not possible from this session (no GitHub access). The implementer must
search the repository's open issues for "call size", "ladder", "premium" and "VXP_CALL_SIZE" before
flipping the status, and add `Closes #N` or `Part of #N` here and in the PR body. `economy.md`
tracks the related farm vectors under #543; this spec does not close it.

## Analytics

Instrument: the change exists to let players pick finer sizes, and without the chosen size in the
data nobody can see whether they do. Reuse first:

| Event (existing unless marked)   | Change                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flow_swipe`                     | On a YES / NO swipe on the ViciXP domain, add `value` = the call size in whole VXP. Skips carry no `value`.                                                                                                                                                        |
| `position_taken`, `order_placed` | Add `source` (`flow` / `market_detail`), threaded from the caller through `executeOutcomeTrade` into `placeOrder`. `value` keeps meaning "VXP committed" (after contract rounding), so `value / call size` exposes the rounding shortfall at small sizes.          |
| `call_size_set` (**new**)        | Fired once per settled change of the control (range `change`, not `input`; a preset tap), never on render. Props: `source` (`flow` / `market_detail` / `landing_markets`), `value` (the size, whole VXP, bounded by the constants), `label` (`slider` / `preset`). |

A new name lands in `src/lib/types/analytics-event.ts`, `src/lib/schema/analytics-event.schema.ts`
and the API mirror `ANALYTICS_EVENT_NAMES` in `backend/src/analytics/taxonomy.ts`
(`backend/tests/shared-drift/analytics.test.ts` pins them); capture goes through `track` in
`src/lib/services/analytics.services.ts`. The schema is bundled into the satellite
(`src/satellite/services/analytics.services.ts` imports `TrackEventInputSchema`), so a new name also
means `npm run juno:functions:build` and the declaration copy of `AGENTS.md` § 4 rule 9. All props
are bounded numbers or closed vocabularies; no PII.

No event for the preference clamp: it fires at most once per legacy account and open question 1
answers the same question with one query.

## Technical requirements (satellite / backend: mandatory)

Values: every bound named here is a constant in
[`vxp-economy.constants.ts`](../../../../src/lib/constants/vxp-economy.constants.ts) (API mirror in
`backend/src/vxp/constants.ts`, pinned by `backend/tests/shared-drift/vxp.test.ts`); no number is
restated in code.

**Satellite (recommended option: no satellite code change).**

- Performance: no new hook, assert or endpoint; zero instruction-budget change. The satellite never
  sees an order, so it has nothing to validate a call against.
- Memory and storage: no new collection or doc shape. `profiles.preferences.defaultAmount.flow` stays
  a string; legacy 300 / 500 values stay stored and are clamped on read in the client.
- Why no assert on the preference: the field also holds the playground domains' fractional amounts,
  so an integer-in-range assert on `profiles` would reject legitimate playground writes; and no code
  writes it for VXP today, so an assert would guard an unused path. A profile-level migration
  (rewrite every `profiles` doc) would cost a full keyset walk of the collection
  (`keyset-walk.services.ts`) for at most a handful of legacy rows (open question 1).
- Scalability: unaffected at 10× / 100× users, since nothing is added on-canister.
- Upgrade and compatibility: no `.did` change, no `juno.config.ts` rule change, not breaking. Only if
  the new analytics name ships does `juno:functions:build` rerun; its `.did` output should be byte
  identical (event names are validated by the Zod enum, not typed in Candid), to confirm at build.
- Security: no collection rule or caller permission touched.

**Web2 API (recommended option A of pending decision 1).**

- Performance: per limit order, one `registry.getSeries` read (already behind the shared TTL cache in
  `backend/src/engine/cache.ts`, so one canister query per series per TTL, usually zero) to learn the
  series' balance domain, plus constant-time bigint arithmetic. Per market-order leg, one capped
  per-leg check needs the level price: `list_orders` for the series (a query, cacheable for the
  same TTL) because the clearing Candid has no get-order-by-id. Order routes are user-paced (a
  Flow sitting is capped by the daily hard cap), so the added load is a few cached reads per call.
- Memory and storage: no migration, no table. Two mirrored integer constants.
- Scalability: the reads are cached per series, not per user, so 100× users on the same markets add
  no canister reads; no N+1 (one book read per leg at most, and a call has few legs).
- Upgrade and compatibility: the request bodies gain an optional `callSize` field (whole VXP); a
  client without it is still accepted (limit notional and each market leg checked against
  `VXP_MAX_CALL_SIZE` only) until the web app ships the field, then it becomes required for ViciXp
  series. A new refusal code
  (`invalid_call_size`, status 400) joins the app's `ORDER_REJECTION_KEYS`
  (`src/lib/canisters/clearing.errors.ts`); `backend/tests/shared-drift/order-rejections.test.ts`
  compares that list against the engine-variant table `ORDER_REJECTIONS` only, so the API needs a
  named list of its own refusal codes that the drift test includes.
- Security: value-moving routes (`docs/ai/governance.md` boundaries): the change only refuses, never
  widens; call it out in the PR body.

## Implementation outline

1. `vxp-economy.constants.ts`: new constants (min, max, default, step, presets per decisions 2 to 4),
   branded `VxpCallSize`, range predicate `isVxpCallSize`; remove `VXP_CALL_SIZE_LADDER` and rewrite
   the doc comments (why a range, why the default sits where it does).
2. `vxp-economy.utils.ts`: `clampVxpCallSize`; delete `snapToCallSizeLadder`.
3. `trade.utils.ts`: guard message from the constants; doc comment updated.
4. `FlowCallSize.svelte` + `FlowCallSizeSlider.svelte`: value-based range, presets (decision 2),
   fill percentage `(size - min) / (max - min)`, keyboard support (native range arrows plus
   preset buttons), `aria-valuetext`.
5. `FlowMode.svelte`: restore through `clampVxpCallSize`, fallback to the default; update the
   comments of `MIN_CALL_MARGIN_USD` and the restore branch.
6. `FlowCard.svelte`: honest `callSize`; floor from `VXP_P_WIN_FLOOR`; preview per decision 6.
7. `TradeModal.svelte`: shared control, default start, preview per decision 6.
8. Landing Markets control: verify it reads the constants and `vxpNetWin` (or wire it, if this PR
   lands second).
9. Server-side bounds per decision 1. For option A: mirror the min and max in
   `backend/src/vxp/constants.ts` + `backend/tests/shared-drift/vxp.test.ts`
   (`extractIntConst`); validate in `backend/src/routes/engine.ts` for ViciXp series: integer
   `callSize` in range, limit notional `qty × share cost` at most `callSize` and within one share of
   it, each market leg's notional at most `callSize`; refusal code wired on both sides plus the drift
   test; route tests in `backend/tests/engine.test.ts`.
10. Analytics per the table above (decision 7).
11. i18n keys in every catalog; `npm run check:i18n`.
12. Docs listed in Scope item 10; flip this spec to `In progress (#PR)` once the pending decisions are
    recorded under Decisions, and to `Implemented (#PR)` in the final commit.

## Test plan

- **Unit (`npm test`)**, new `src/tests/lib/utils/vxp-economy.utils.spec.ts` and
  `src/tests/lib/utils/trade.utils.spec.ts` (neither helper has a spec today):
  `isVxpCallSize` accepts min, default, max and every integer between; rejects min - 1, max + 1,
  non-integers, `NaN`, `Infinity`, negatives, 300, 500. `clampVxpCallSize`: `'0'` and non-finite
  give the default; 300 and 500 give the max; 3 gives the min; 12.6 gives 13; the default round
  trips. `assertViciXpHumanPremium` throws outside the range and for `'12.5'`, passes inside.
  `vxpNetWin` at min and max sizes with a price under the floor.
- **API (`cd backend && bun run typecheck && bun test`, real Postgres)**: limit order on a ViciXp
  series refused below min, above max, non-integer, and when `qty × share cost` disagrees with the
  declared size; accepted at min, default and max; a non-ViciXp series unaffected; a market leg above
  max refused. Shared-drift: bounds mirror and refusal code list.
- **Component / manual**: Flow on the ViciXP domain at 360x640 and 1440x900: the control starts at
  the stored size (or the default), reaches min and max by drag, keyboard and presets, `atCap` label
  at max, warnings at the new floor, front footer shows a below-default size honestly. Market detail
  sheet starts at the default. Under every `[data-theme]` and with reduced motion.
- **Migration**: a profile (satellite and web2) holding `defaultAmount.flow = '500'` opens Flow at
  the max; `'0'` at the default; `'75'` at 75 (today it falls to the smallest rung).
- **Gates**: `npm run quality`, `npm run check`, `npm run check:dashes`, `npm test`, backend suite.

## Rollout and risks

- **Order of deploys.** Web app first (client guard and controls), then the API's required
  `callSize`: an API that requires the field before the web app sends it would refuse every web2
  call. Option A keeps the field optional for one release for that reason.
- **Rounding shortfall at the minimum.** The "if wrong" row shows the call size, while the commit can
  be up to one contract price lower; already true today at a smaller ratio. Acceptable; `value` on
  `position_taken` makes it measurable.
- **Cheaper count farming.** The lower minimum cuts the collateral a farmer must lock to rack up
  counted calls. The rolling overtime cap and one-time milestone keys still bound the mints; pending
  decision 5 decides whether to add a qualifying size.
- **Web3 stays client-enforced** unless the engine option is taken: a modified client can still send
  any size to the clearing canister, as it can today.
- **Mixed clients.** A cached older web app still offers the 300 and 500 sizes until reload; under
  option A the web2 API refuses them once `callSize` is required, and the client shows the refusal
  message. On web3 they would still place.

## Acceptance criteria

- [ ] `VXP_CALL_SIZE_LADDER` and `snapToCallSizeLadder` no longer exist; no code outside
      `vxp-economy.constants.ts` and its pinned API mirror states a call-size number.
- [ ] Every whole amount between `VXP_MIN_CALL_SIZE` and `VXP_MAX_CALL_SIZE` can be placed from Flow
      and from the market detail sheet on the ViciXP domain; nothing outside the range can.
- [ ] Flow and the market detail sheet open at `VXP_DEFAULT_CALL_SIZE` when no size is stored; a
      stored size above the maximum opens at the maximum.
- [ ] The Flow card front shows the actual call size, including sizes below the default.
- [ ] The out-of-funds takeover and the `wont-finish` warning price at the new minimum.
- [ ] The landing Markets control reads its bounds and default from the constants and previews with
      `vxpNetWin`.
- [ ] Server-side bounds as decided under pending decision 1, with tests on the API side.
- [ ] Analytics as decided under pending decision 7; any new event name in the union, the Zod enum
      and the API taxonomy, drift suite green.
- [ ] `economy.md`, `PRODUCT.md`, `design.md` § 7.5 and `reusability.md` updated in the same PR.
- [ ] Every new key in every catalog; `npm run quality`, `npm run check`, `npm test`,
      `npm run check:dashes` and the backend suite pass.

## Open questions

1. **How many stored profiles hold a VXP `defaultAmount.flow` other than `'0'`, and how many above
   the new maximum?** No current code writes the field. One `SELECT` over
   `profiles.preferences->'defaultAmount'->>'flow'` on the web2 database and one controller scan of
   the satellite `profiles` collection answer it. A zero count confirms the read-time clamp is enough;
   a real population makes pending decision 4's backfill option worth weighing.
2. **Does icdc-core bound an order's size or price for engine `eng_0` anywhere, or plan to?** The
   Candid `TradeError` has no such variant and the client comment says settlement applies no payout
   floor, so `economy.md`'s "bounded by the floor and the cap" holds only for clients that run this
   repo's guard. The icdc-core owner can confirm; the answer decides whether option C of pending
   decision 1 is a new engine feature or a configuration.
3. **Does the landing Markets control carry the chosen size through sign-up into a real order?** If
   a signed-out pick survives sign-up and is placed afterwards, the guest pick record
   (`recordGuestPick`, today side only) must store the size and the placement path must validate it.
   The landing Markets brief owns the answer.

## Pending decisions

1. **How far server-side enforcement goes.** Facts: the satellite has no order path, so it cannot
   reject a call on either build; the web2 API sees limit orders (notional computable) and market
   orders one book level at a time (aggregate unknown); the engine has no size rule. Options:
   - **A. API checks what it can see** (as detailed under Technical requirements): declared integer
     `callSize` in range, limit notional consistent with it, each market leg capped at it. Web3 stays
     client-enforced. Moderate change, web2 only.
   - **B. API owns the book walk**: a `POST /engine/calls` endpoint takes the series, the outcome
     and `callSize`, walks the book server-side and enforces the range exactly; `walkMarketOrder`
     moves behind it for web2. Exact, but duplicates the walk in the backend and is a larger PR.
   - **C. Engine rule in icdc-core**: per-engine order notional bounds on `eng_0`, enforced for both
     builds. The only real bound for web3; cross-repo, lands first.
   - **D. Client-only**, as today, and say so in `economy.md`.

   Recommendation: **A in this PR, C as a follow-up icdc-core issue**, and `economy.md` states the
   enforcement honestly in the meantime. A per-call bound limits a single order, not exposure (a
   player can repeat calls), so exact enforcement (B) buys little over A for its cost.

2. **Flow and market detail control: slider only, or slider plus quick presets?** Facts: the landing
   control is a slider over the full range; Flow today pairs its slider with tappable pegs on a
   card that is also a swipe surface, where small drags are imprecise. Recommendation: **one shared
   control for Flow and market detail: the range slider plus a row of presets inside the range**
   (keeps the peg affordance the card back is designed around, gives one-tap round sizes), while
   the landing keeps slider only as designed. All three read the same constants.

3. **Slider step.** Options: 1 (literally "any whole amount"; arrow keys move by one; drag lands on
   any integer), 5, or 10 (twenty stops, coarser drag, matches the landing control as designed).
   Validation accepts any integer either way. Recommendation: **one shared `VXP_CALL_SIZE_STEP`
   of 1** used by all three controls, with presets covering round sizes; take 10 instead if the
   landing control must stay on twenty stops.

4. **Preset values and the legacy preference.** Presets (if decision 2 adopts them): recommendation
   **min, 25, default, 100, max** (five targets, like today's peg count, all inside the range).
   Legacy preference: **clamp on read only** (`clampVxpCallSize` in the Flow restore), no backfill of
   stored rows on either backend, unless open question 1 finds a real population.

5. **Anti-farming for count-gated mints** (required by `economy.md`'s reconciliation protocol).
   Facts: overtime, Flow milestones, streak days, fill-counted achievements, battle tie-breaks and
   tournament / podium tallies count calls regardless of size; the lower minimum makes each count
   cheaper in locked collateral. Options: add a qualifying size (say, the default) below which a
   fill counts for no award; or keep counting every call and rely on the existing one-time keys and
   the rolling overtime cap. Recommendation: **no gate in this PR**; extend known farm vector 3 in
   `economy.md` (already proposing a minimum call size for overtime) to cover the other count-gated
   surfaces, and decide the gate in its own spec.

6. **One payout preview everywhere.** Facts: Flow's back face shows the net win via `vxpNetWin`
   (execution price, `VXP_P_WIN_FLOOR`, sub-1 shown as `<1`); the Flow front recomputes it with a
   hardcoded floor, the consensus price and a `+1` minimum; the market detail sheet shows the gross
   return with no floor. At the new minimum the `+1` clamp over-promises more often. Recommendation:
   **route every preview through `vxpNetWin` and show the net win**, which changes the number the
   market detail sheet shows today (gross to net).

7. **Analytics in this PR or in the dedicated analytics PR.** The landing work defers its events to
   one analytics PR. Recommendation: **ship the `flow_swipe.value` and `position_taken.source`
   enrichments here** (they touch only props) and **the new `call_size_set` event with the analytics
   PR**, so the taxonomy and satellite regeneration happen once.

## Decisions

- **Range, default and floor** (owner): whole amounts from 10 to 200 VXP, default 50, on every
  surface that sizes a call; the 300 and 500 sizes go for everyone; `VXP_P_WIN_FLOOR` stays; open
  positions stay valid. Stored sizes above the maximum restore as the maximum.
