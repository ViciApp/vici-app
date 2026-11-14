# Spec: VXP transaction history page

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#847)

## Amendment (2026-06-13): running balance tracks total holdings

The original build anchored the running balance on **spendable** VXP
(see the "Running balance = available (spendable) VXP" and
"Available-balance anchor" decisions below). That choice had a latent
defect: spendable carves out margin reserved for open positions **and
resting orders**, but the per-row deltas only represent filled/settled
trades. Any margin reserved without a matching realized delta,
chiefly resting limit orders, has nothing to give back as the walk
goes into the past, so the entire historical balance ladder shifts
down by that reserved amount and the oldest rows read **negative**
(e.g. a first `+1,000` welcome bonus showing `−6,640`). It also never
actually matched the Dash hero, which shows **total** holdings, not
spendable.

The running balance now anchors on **total holdings** and the headline
surfaces the reconciling triple **total = available + in play**:

- A prediction fill (`Executed`) is wealth-neutral: VXP moves into
  play, total is unchanged, so it carries delta `0`, renders amount
  `–`, and shows the committed stake as "… in play" in the subtitle.
- A settlement's signed `qty` (realized cashflow) **is** the total
  delta: a win credits the profit, a full loss debits the stake, a
  break-even nets zero. No margin-release term, no per-series stake
  accumulation.
- Resting orders contribute no delta (as before), but now their
  reservation is correctly absent from a total-based walk, so the
  column reconciles to a clean zero genesis regardless of open
  exposure.

This also resolves the long-standing "lost prediction shows `0`"
confusion: a loss now shows the staked amount as a real negative at
settlement. Current behaviour lives in `docs/ai/PRODUCT.md` §
"Transaction history (Dash)"; the sections below are retained as the
history of the original #847 build.

## Goal

From the holdings bottom sheet on `/dash`, the user can open a
dedicated **transaction history** page: a paginated, filterable,
chronological list of every event that changed their VXP: bonuses
received, predictions placed, wins, losses, cancellations, and
external transfers, each row showing the signed amount and, as the
last column, the **running available-VXP balance** after that event.

## Context

### Entry point

- `src/lib/components/dash/DashStackCard.svelte`: holdings card on
  `/dash`; opens the sheet.
- `src/lib/components/dash/DashStackSheet.svelte`: the bottom sheet
  (built on `src/lib/components/ui/BottomSheet.svelte`). Gains a new
  link row at the bottom navigating to the history page.

### Why this is not "just read the ledger"

Predictions do **not** produce per-stake ledger transfers:

- `src/lib/components/wallet/PlaygroundVxpAutoDeposit.svelte` sweeps
  free wallet VXP into the clearing canister's collateral account on a
  poller: ledger transfers are batched sweeps, not stakes.
- Orders lock margin from already-deposited collateral
  (`src/lib/api/clearing.api.ts`: `submitLimitOrder` /
  `submitMarketOrder`); settlements credit clearing equity. Neither
  touches the ledger.
- Bonuses **are** ledger transfers: every satellite payout goes
  through `transferWithBadFeeRetry`
  (`src/satellite/utils/vxp-payout.utils.ts`) with a
  `vxp:<awardType>:<key>` memo. Confirmed memo tags:
  `achievement`, `calibration`, `comeback`, `league_founder`,
  `new-user`, `referral`, `streak`, `tournament_prize`,
  `worlds_podium`.

So the page merges **two streams** into one feed:

1. **Clearing events**: `getTradeHistory`
   (`src/lib/api/clearing.api.ts`) returns all of the caller's
   `OrderPlaced` / `Executed` / `Settled` / `Liquidated` events in one
   unpaginated query call.
2. **VXP ledger transactions**: `getTransactions`
   (`src/lib/api/icrc-index-ng.api.ts`) pages through the ICRC index
   (`VXP_INDEX_CANISTER_ID_DEFAULT` in
   `src/lib/constants/canisters.constants.ts`).

### Existing plumbing to reuse

- `src/lib/types/wallet.ts`: the unified `Transaction` type already
  models both sources (`source: 'ledger' | 'clearing'`), including
  `CollateralDeposit`/`CollateralWithdraw` (sweeps, derived from
  counterparty = clearing canister) and a **reserved `Reward` type
  explicitly waiting for satellite payouts to be relabelled**; this
  spec cashes that in.
- `src/lib/utils/transactions.utils.ts`:
  `mapClearingEventToTransaction` and the ledger mappers; extend with
  memo parsing (`vxp:<type>:<key>` → `Reward` + award type).
- `src/lib/services/wallet.service.ts`: `getTransactionsPage`
  (multi-ledger merge for the wallet page; the new page needs a
  VXP-only variant that walks pages to exhaustion).
- UI: `src/lib/components/ui/Pagination.svelte` (numbered pages with
  ellipsis, used by the portfolio table),
  `src/lib/components/ui/EmptyState.svelte`,
  `src/lib/components/layout/ScreenHeader.svelte` (back affordance),
  `src/lib/components/wallet/WalletHistory.svelte` (reference table,
  stays untouched).
- Formatting: `formatToken`, `formatNanosecondsToDate` /
  `formatRelativeAgoFromNs` (`src/lib/utils/format.utils.ts`);
  VXP display helpers in `src/lib/utils/playground-display.utils.ts`.
- Current available balance anchor:
  `src/lib/derived/vxp-holdings.derived.ts`.

## Ledger model: row semantics and the running balance

The running balance column tracks **available (spendable) VXP** =
wallet ledger balance + free clearing margin. This matches the user's
mental model: placing a prediction visibly moves VXP out, a win brings
back stake + profit, a loss returns nothing.

| Event                            | Row label               | Available-VXP delta                          |
| -------------------------------- | ----------------------- | -------------------------------------------- |
| Ledger receive with `vxp:` memo  | Bonus · `<award type>`  | + amount                                     |
| Clearing `Executed` (fill)       | Prediction · `<market>` | − fill cost (`qty × price`)                  |
| Clearing `OrderPlaced`           | **no row**              | 0 (see decision: deltas bind to fills)       |
| Clearing `Settled`, cashflow > 0 | Won · `<market>`        | + released stake + cashflow                  |
| Clearing `Settled`, cashflow < 0 | Lost · `<market>`       | ~0 (subtitle: "stake of `<n>` not returned") |
| Clearing `Settled`, cashflow = 0 | Break-even · `<market>` | + released stake                             |
| Clearing `Liquidated`            | Liquidated · `<market>` | + released stake + signed cashflow           |
| Other ledger send/receive/mint   | Sent / Received / …     | ± amount (sends also debit the fee)          |
| Wallet↔clearing sweeps           | **hidden row**          | − transfer fee only (silently applied)       |

- Losses render **0**, not −stake: the stake already left available
  balance at the fill; showing −stake again would double-count. The
  released stake for a settlement is reconstructed by accumulating the
  per-series fill costs (`Executed` events) between settlements.
- Sweeps (`CollateralDeposit`/`CollateralWithdraw`) don't change
  available balance and are pure noise, hidden, **but** their ledger
  fee still debits the running balance, so the hidden rows participate
  in the balance computation.
- The balance column is computed **newest-first**: anchor on
  `vxpSpendable` from `vxp-holdings.derived.ts`, then walk backwards
  subtracting each row's delta. Integer math in clearing-margin base
  units only, formatted at render time with the `USD_DECIMALS`-scaled
  VXP helpers. Unit handling reuses the existing decoders rather than
  assuming a scale: event prices decode via `eventExecutionPrice`
  (decimals carried by the event itself), ledger amounts convert
  native → margin scale via `nativeToClearingMarginUnits`, and a
  `Settled` event's signed `qty` is already the margin-scale cashflow:
  never ad-hoc `/ 1e8` math.
- Win/loss colours: `--yes` / `--no` signals; bonuses use the accent;
  neutral rows muted.

## Scope

1. **Route**: `/dash/transactions`:
   `src/routes/(app)/dash/transactions/+page.svelte` importing a page
   shell per `docs/ai/frontend/structure.md`, a new `AppPath` entry
   in `src/lib/constants/routes.constants.ts`, page shell
   `src/lib/components/pages/DashTransactionsPage.svelte`.
   `ScreenHeader` with back to `/dash`; header shows current
   available VXP and an "in play" chip.
2. **Sheet link**: a real `<a>`/`<button>` row in
   `DashStackSheet.svelte` ("Transaction history" + chevron, accent
   tint), a11y-labelled per `docs/ai/frontend/a11y.md`.
3. **Data service**: a new service (per
   `docs/ai/frontend/workflows/new-service.md`) that fetches the full
   clearing history + walks the VXP index to exhaustion (capped),
   normalizes both streams into `Transaction[]`, labels `Reward` rows
   from memos, sorts newest-first, and computes running balances.
4. **Memo parsing**: extend `transactions.utils.ts` to decode the
   `vxp:<type>:<key>` memo bytes into an award type; unknown/absent
   memos from the satellite/minter principal fall back to a generic
   "Bonus" label.
5. **UI**: table/list with columns: activity (icon + label + market
   title), date/time, signed amount, running balance. Filter chips:
   All / Predictions / Results / Bonuses (client-side). Numbered
   pagination via `Pagination.svelte` (page size 10, via a named
   constant).
   `EmptyState` for zero transactions; a quiet footer line when the
   ledger walk hit the page cap ("older history not shown").
6. **i18n**: new `transactions.*` keys in **every** catalog under
   `src/lib/constants/messages/` (all supported locales in
   `SUPPORTED_LOCALES`).
7. **PRODUCT.md**: updated in the same PR.

### Out of scope

- No satellite endpoints, hooks, or collection changes: the
  `vxp_awards` collection stays `read: 'controllers'`; bonus labeling
  comes from ledger memos. (The new analytics event names do flow into
  the satellite's `track` validation enum via the shared Zod schema,
  so `npm run juno:functions:build` regenerates
  `satellite_extension.did` + declarations, committed with this PR,
  no behavioural satellite change.)
- Flow-session grants (`flow_milestone`, `flow_overtime`) have **no
  real VXP credit path yet** (deferred: issue #350); they cannot and
  will not appear. When #350 lands with the established memo format,
  they appear automatically.
- CSV export, per-row drill-down sheets, ICP/ckUSDC tokens (the wallet
  page already covers multi-token history).
- Changing `WalletHistory.svelte` or the wallet page.

## Linked issues

- Part of nothing / closes nothing: searched open issues (#810,
  #759, #543, #350): none is fixed by this spec. #350 is referenced
  above as a data-coverage caveat only.

## Analytics

Instrument (default yes):

- `transactions_viewed`: fired on page open. Props: `source`
  (`'dash_sheet' | 'direct'`), `count` (rows loaded).
- `transactions_filtered`: fired on filter-chip change. Props:
  `label` (`'all' | 'predictions' | 'results' | 'bonuses'`).

Both names land in **both** halves of the dual-source pair:
`src/lib/types/analytics-event.ts` (TS union) and
`src/lib/schema/analytics-event.schema.ts` (Zod mirror); capture via
`track` in `src/lib/services/analytics.services.ts`. Bounded
vocabularies only; no market ids beyond the existing `marketId` prop,
no amounts (economic values stay out of analytics).

Pagination clicks are not instrumented: page depth adds no decision
value beyond `count`.

## Design artifacts (frontend, optional)

- [`./2026-06-12-feat-transaction-history/mock.html`](./2026-06-12-feat-transaction-history/mock.html):
  interactive mock of the sheet link row and the history page, with
  the mandatory theme switcher (`data-theme`: dark / light / peach)
  and a "copy instructions" button that serializes every chosen
  variant. Deleted post-merge.

## Technical requirements

Pure-frontend spec: no `src/satellite/**`, collection, or
icdc-core-facing changes. Client-side load characteristics, for the
record:

- **Calls per page open**: 1 × `getTradeHistory` (query, unpaginated
  by design of the clearing canister) + ⌈N/page⌉ × ICRC index
  `get_account_transactions` (query), N = user's lifetime VXP ledger
  txs. Cap the index walk with a constant (e.g.
  `TRANSACTION_HISTORY_MAX_LEDGER_PAGES`) so a pathological account
  cannot fan out unbounded; surface the truncation footer when hit.
- **Scalability**: at 10×–100× event volume the fetch-all approach
  degrades; the cap bounds it. Server-side pagination of
  `getTradeHistory` would be an icdc-core change, explicitly
  deferred until real users approach the cap.
- **No new storage**; everything is derived at view time.

## Implementation outline

1. Add the `AppPath` entry + route folder + page shell
   (`+page.svelte` → `DashTransactionsPage.svelte`).
2. Add memo decoding + delta/balance assembly in a dedicated
   `src/lib/utils/transaction-history.utils.ts` (the parser tolerates
   all nine tags, unknown tags, absent memos, and non-UTF8 bytes; the
   repo has no unit-test harness, only Playwright e2e, so the
   guarantees are typed exhaustively and verified via `svelte-check`).
3. New `transaction-history.services.ts`: walk the VXP index, merge
   with the already-loaded `tradeHistory` store, hide sweep rows (keep
   fee deltas), compute running balances anchored on `vxpSpendable`.
4. Build the page UI: `ScreenHeader`, filter chips, list rows, signed
   amounts (`--yes`/`--no`/accent), `Pagination.svelte`,
   `EmptyState`, truncation footer.
5. Add the `DashStackSheet` link row.
6. Add `transactions.*` i18n keys to every locale catalog.
7. Wire `transactions_viewed` / `transactions_filtered` (union + Zod
   - `track`).
8. Update `PRODUCT.md`; run `npm run quality` and `npm run check`.

## Acceptance criteria

- [ ] Tapping the new row in the holdings sheet on `/dash` opens the
      history page; back returns to `/dash`.
- [ ] The page lists bonuses (labelled by award type from the ledger
      memo), prediction fills, wins, losses, break-evens, and external
      transfers, newest first.
- [ ] Wallet↔clearing collateral sweeps do not appear as rows.
- [ ] The last column shows the running available-VXP balance; the
      top row's balance equals the currently displayed available VXP,
      and consecutive rows differ exactly by the row delta (fees of
      hidden sweeps accounted).
- [ ] Lost predictions show amount 0 with the stake noted in the
      subtitle, never a second −stake.
- [ ] Filter chips restrict the list client-side without refetching.
- [ ] Numbered pagination via `Pagination.svelte`; empty state when
      no transactions; truncation footer when the ledger-walk cap is
      hit.
- [ ] All user-visible strings go through `t(...)` with keys present
      in every locale catalog (`npm run check:i18n` clean).
- [ ] Both analytics events fire and exist in the TS union **and**
      the Zod schema.
- [ ] Works in all three themes (dark / light / peach); win/loss use
      `--yes`/`--no` tokens, no hardcoded colours.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- **Memo coverage on mainnet**: do all historical bonus transfers
  carry the `vxp:` memo (early payouts may predate the format)?
  Verify against a real account; absent memos fall back to the
  generic "Bonus" label, so this only affects label quality.
- ~~ICRC index memo availability~~: answered during the build: the
  raw `IcrcIndexDid.Transaction` ops expose `memo` (and `fee`); the
  service extracts them before the shared mapper drops them.
- ~~Clearing event amount semantics~~: answered during the build: a
  `Settled` event's signed `qty` is the realized cashflow
  (`settledEventToResolvedPosition`), an `Executed` fill's cost is
  `qty × price` (same notional as the wallet table); led to the
  fills-not-placements decision below.

## Decisions

- **Route: `/dash/transactions`** (owner decision, 2026-06-12):
  nested under its entry point, back returns to `/dash`; page shell
  `DashTransactionsPage.svelte`. Top-level `/transactions` rejected:
  its only entry point is the dash sheet.
- **Page size: 10** (owner decision, 2026-06-12): matches the
  portfolio tables and the wallet history default batch.

- **Running balance = available (spendable) VXP**, not total
  holdings: stakes visibly debit, wins credit stake + profit, losses
  are 0-rows. Total-holdings semantics would render stake rows as
  zero-delta, which contradicts the approved mockup and user
  intuition.
- **Bonus labels from ledger memos, not a new satellite endpoint**:
  `vxp_awards` stays controllers-only; every payout already writes a
  parseable `vxp:<type>:<key>` memo, so the FE can label rewards with
  zero backend surface. A satellite query would add an endpoint, an
  instruction budget, and a second source of truth for no extra data.
- **Fetch-all + client-side numbered pagination** over lazy
  load-more: the user explicitly asked for a numbered, paginated
  table with a running balance; numbered pages need a total count,
  and the clearing call is all-or-nothing anyway. The ledger-walk cap
  bounds the cost.
- **Stake deltas bind to `Executed` fills, not `OrderPlaced`** (build
  discovery, 2026-06-12): the clearing canister emits **no
  cancellation event**, so debiting at placement could never be
  credited back for a cancelled resting order and would permanently
  skew every older balance. A resting order's locked margin is already
  reflected in the live spendable anchor; fills are the honest commit
  point. `OrderPlaced` therefore renders no row, and a settlement's
  released stake is reconstructed from the accumulated per-series fill
  costs.
- **Available-balance anchor** (build discovery, 2026-06-12):
  `vxpSpendable` in `vxp-holdings.derived.ts` (wallet VXP + free
  clearing margin, with a stale-while-revalidate snapshot) is the
  anchor; the walk recomputes whenever it refreshes, so the top row
  tracks the live figure by construction.
