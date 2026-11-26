# Spec: Landing calls become real predictions at sign-up

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

This is **part B of two**. Part A, [`2026-11-26-feat-challenge-links.md`](./2026-11-26-feat-challenge-links.md), defines verified challenge links (issuing, receiving end, link preview, inviter credit, the "friend answered" card). This part covers the second origin of a challenge: a visitor's Yes/No taps on the landing deck, which are not predictions, are turned into real predictions at sign-up after an explicit confirmation, and the new user can then challenge a friend with the action from part A. Each part has its own status and its own PR; both ship with the landing go-live.

## Goal

A visitor taps Yes or No on cards of the signed-out landing deck. Those taps move nothing: no account, no balance, no order. When the visitor signs up, onboarding shows the calls they tapped and asks them to confirm: each confirmed call is placed as a real prediction at the default call size from their starter VXP, at the price available at that moment, with the change since the tap shown next to it. Nothing is placed without the confirmation. After it, the user is offered "Challenge a friend" on a call they just made, which issues a verified link bound to that real prediction.

## Context

**Landing taps today.** The signed-out landing deck (components under `src/lib/components/landing/` with the `LandingDeck*` prefix, delivered by the landing PRs, not on `main` at authoring time) records a tap for display only. It is the same idea as guest picks in Flow: `recordGuestPick` in `src/lib/stores/guest.store.ts` stores `marketId` / `side` / `ts` in `localStorage`, "no entry price, no amount, because nothing is reconciled at convert", and `PRODUCT.md` ("Guest mode") states that guest picks are discarded at sign-up and that no conversion surface may imply they carry over.

**Sign-up and the handoff.** The pre-auth payload under `PENDING_ONBOARDING_STORAGE_KEY` (`PendingOnboarding` in `src/lib/services/onboarding-handoff.services.ts`) is stashed before any provider runs, so it survives a full-page OAuth redirect, and `drainPendingOnboarding` applies it after sign-in from `src/routes/(app)/+layout.svelte`. `wasBootstrappedThisSession` is how the drain tells a brand-new account from a returning one.

**Starter VXP.** The registration grant (`NEW_USER_VXP_TOTAL_BASE_UNITS` in `src/lib/constants/vxp-onboarding.constants.ts`) is a real ledger transfer fired by the profile write (`runOnboardingProfileTrigger` in `backend/src/vxp/onboarding.ts`), then swept into clearing where it becomes available balance ([`frontend/web2-backend-mode.md`](../../frontend/web2-backend-mode.md), "The custodial wallet"). It is therefore not spendable in the same instant the account is created.

**Placing a real prediction.** `executeOutcomeTrade` (`src/lib/utils/trade.utils.ts`) and `placeOrder` (`src/lib/services/order.services.ts`) are the one path every real call takes: the expiry gate (`MarketClosedError`), the zero-quantity guard, the book walk bounded by `maxSpendUsd`, the `position_taken` event, the trade activity and its award triggers. `flowTradeService` (`src/lib/services/flow.services.ts`) batches the refreshes of several calls made in a row. `calculateMarketStats` and `resolveOutcomeExecutionPrice` (`src/lib/utils/market.utils.ts`) give the price a side would execute at.

**Call size.** `VXP_DEFAULT_CALL_SIZE` and the bounds in `src/lib/constants/vxp-economy.constants.ts`. A separate spec changes the call size to a continuous range with a default; this spec reads the default and the bounds from that file and never states a number.

**Sheet hosts.** `src/lib/components/guest/GuestSaveHost.svelte` is the pattern for a conversion surface mounted once in the app shell that waits for a quiet moment (`flowBeatActiveStore`, `menagerieCelebrationStore`) before it shows.

**Backends.** Sign-up exists only on the web2 build (`areNewSignupsMoved` in `src/lib/services/new-app-redirect.services.ts`), and the landing is the web2 site's landing.

## Scope

### 1. Recording a tap

- Each Yes/No tap on a landing deck card is stored client-side as a **pending call**: `seriesId`, `side`, the side-framed price shown on the card at the tap (`priceAtTap`), and `tappedAt_ms`. One pending call per series: a later tap on the same series replaces the earlier one. The list is capped (`LANDING_CALLS_MAX`) and each entry expires after `LANDING_CALLS_TTL_MS`.
- A pending call is not a prediction and the landing copy must not say it is. It is shown to nobody else and sent to no server. `priceAtTap` is only ever used to tell this same user how the price moved; it is never an execution price and never appears on a challenge link (part A snapshots the real fill from the engine).
- The pending calls are copied into the pending-onboarding payload when the visitor starts sign-up, so they survive a provider redirect.

### 2. Confirmation in onboarding

After sign-up, once the profile exists and the handoff has drained, a confirmation sheet opens for an account with at least one pending call. It lists each one:

- market title, the side tapped, "38% when you tapped, 44% now" (the current executable price for that side), and the call size (the default from the constants);
- a checkbox per row, and a footer with the total against the available VXP: "Confirm 3 calls, 150 of 1,500 VXP" (figures from the constants and the live balance, never literals);
- two actions: confirm the checked rows, or "Not now".

Row states, computed by one pure function from the pending calls, the live markets and the balance:

| State        | When                                                                                                              | Row                                                                        | Checked by default |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| `ready`      | market open, price within `LANDING_CALL_DRIFT_POINTS` of `priceAtTap`, funds cover it                             | both prices and the difference                                             | yes                |
| `drifted`    | market open, price moved by more than the threshold in either direction                                           | both prices, the difference emphasised, "The price moved since you tapped" | no                 |
| `closed`     | series past expiry, settled, no longer listed, or not yet revealed                                                | "This market has closed. No call made."                                    | disabled           |
| `unfillable` | no executable price for that side (empty book), or the default size rounds to zero contracts at the current price | "No call possible at this price right now."                                | disabled           |
| `held`       | the account already holds a position on that series (a returning account)                                         | "You already called this."                                                 | disabled           |
| `unfunded`   | the available VXP does not cover this row after the rows above it                                                 | "Not enough VXP for this one."                                             | disabled           |

- **Order and funding.** Rows are ordered oldest tap first, and funds are allotted in that order over the checked rows: when the available VXP cannot cover every checked call at the default size, the earliest are kept and the rest become `unfunded`. Unchecking a row frees its allotment for the next. The size is never shrunk to make a call fit.
- **Price at confirmation.** Each confirmed call is a market order through `executeOutcomeTrade` with the default size as its spend ceiling, so it executes at the book as it stands when the user confirms, never at `priceAtTap`. There is no retroactive price: a remembered price would be a free option on every market move between tap and sign-up.
- **Between sheet and fill.** The sheet's "now" price is a quote. If the market closes or the book empties between rendering and execution, that row reports the existing typed failure (`MarketClosedError`, a zero fill) inline and the others proceed. A partial fill is reported as what it filled.
- **Result.** The sheet ends on a summary: each call with its real entry price ("Yes at 44%"), each failure with its reason, and the VXP committed. Pending calls are then cleared whatever the outcome of each row.
- **"Not now"** closes the sheet and keeps the pending calls until they expire; the sheet is offered once more on the next session, then the calls are discarded. Nothing is ever placed without the confirm tap.

### 3. When the starter VXP is not there yet

The grant is a ledger transfer and a sweep, so the sheet opens in a waiting state ("Getting your starter VXP ready") and enables the confirm action when the available balance covers at least one call. After `LANDING_CALLS_FUNDING_TIMEOUT_MS` it offers "Try again" and "Not now". A grant that never arrives (a failed award is retried by the existing reconciliation) leaves the pending calls to the "once more on the next session" rule above.

### 4. Then: challenge a friend

- The result summary offers "Challenge a friend" on the most recent call that filled. It calls the create action of part A (`POST /api/v1/challenges` with the series id), so the link is bound to the real fill the engine recorded seconds earlier, with `source: 'onboarding'`.
- If the visitor tapped "Challenge a friend" on the landing before signing up, that intent (`challengeIntentSeriesId`) rides the pending-onboarding payload: the landing first asks for a handle (the real sign-up), and after the confirmation the share sheet for that series opens directly. If that call was not confirmed or did not fill, there is no real prediction to bind to: the summary says "Make this call to challenge a friend" and no link is created.

### 5. What does not change

- Guest picks made in the Flow preview stay discarded at sign-up, exactly as `PRODUCT.md` describes. Only landing deck taps are offered for confirmation.
- The registration grant, its amount and its trigger. Confirming calls spends the grant on real predictions; it mints nothing.
- The Flow daily swipe counter (`recordFlowSwipe`): a confirmed landing call is not a Flow swipe and does not count toward the daily goal or cap. It is a real fill, so it records an activity day, counts as an executed prediction for the onboarding and Flow milestones, and settles a pending referral (including one credited through a challenge link) like any first prediction.

### Out of scope

- Challenge links themselves: part A.
- The landing deck, its cards, its tap interaction and its copy: the landing PRs. This spec adds the persistence of a tap and the hand-off into sign-up.
- The call-size range change: separate spec. A per-call size picker on the confirmation sheet is not included (pending decision 4).
- Converting Flow guest picks.
- Any server endpoint: confirmed calls use the existing session-gated order routes. No new route, table, migration or Turnstile check is added by this part (sign-up is Turnstile-gated by the dependency PR).
- The web3 build: it has no sign-up, so it has no confirmation step.

## Linked issues

GitHub issue search was not possible from the authoring session (no access to the repository's issues). No issue is linked. The implementer searches open issues for "guest", "onboarding", "starter" and "landing" before flipping the status and records the result here. `PRODUCT.md` references #543 (anti-farm hardening of the new-account mint surface); see "Risks".

## Analytics

Instrument, with existing names only (no taxonomy change, so no satellite schema regeneration):

- `onboarding_step` with `source: 'landing_calls'` and `label`: `shown` (`count` = pending calls, `value` = rows not `ready`), `confirmed` (`count` = calls filled, `value` = whole VXP committed), `skipped`, `funding_timeout`.
- `position_taken`: already emitted by `placeOrder` for every real fill; the confirmed calls are counted there like any other. To separate them, `placeOrder` gains an optional `source` passed through to the event (`'landing_convert'`); every existing caller is unchanged.
- `challenge_created` with `source: 'onboarding'` is part A's event.
- Landing-side tap events belong to the landing analytics PR, not here.

All props are closed vocabularies and counts. No market title, handle or price-at-tap is sent.

## Implementation outline

1. **Constants** `src/lib/constants/landing-calls.constants.ts`: `LANDING_CALLS_STORAGE_KEY`, `LANDING_CALLS_MAX`, `LANDING_CALLS_TTL_MS`, `LANDING_CALL_DRIFT_POINTS`, `LANDING_CALLS_FUNDING_TIMEOUT_MS`. The call size is imported from `vxp-economy.constants.ts`.
2. **Store** `src/lib/stores/landing-calls.store.ts`, modelled on `guest.store.ts` (validated read, best-effort persist, bounded list): `recordLandingCall`, `clearLandingCalls`, expiry on read. If the landing deck PR already persists taps, extend that store instead of adding a second one (open question 1).
3. **Pure logic** `src/lib/utils/landing-calls.utils.ts`: `planLandingCalls({ calls, markets, prices, heldSeriesIds, availableVxp, callSize, checked, now_ms })` returning the rows and states of the table above, and the allotment. No store or network access, so it is unit-testable.
4. **Handoff.** Add `landingCalls` and `challengeIntentSeriesId` to `PendingOnboarding` with strict parsing in `parsePendingOnboarding`; the drain moves them back into the store and never places anything itself.
5. **Sheet** `src/lib/components/onboarding/LandingCallsHost.svelte` (mounted once in `src/routes/(app)/+layout.svelte`, with the collision gate `GuestSaveHost` uses) and `LandingCallsSheet.svelte`. Execution goes through `flowTradeService.startSession()` / `executeTrade` / `endSession()` so balances and positions refresh once.
6. **Order source.** Optional `source` on `placeOrder` / `TradeParams`, forwarded to the `position_taken` event only.
7. **Challenge hand-off.** The summary's action calls part A's `ChallengeShareButton` logic through `src/lib/services/challenge.services.ts`.
8. **Landing.** The deck calls `recordLandingCall` on a tap and stashes the calls (and the challenge intent) when sign-up starts.
9. **i18n** keys in every catalog (`onboarding.landing_calls.*`).
10. **Docs in the same PR:** `PRODUCT.md` (a "Landing calls" entry; the "Guest mode" entry gains one sentence saying landing taps are the exception and why), `economy.md` (confirmed landing calls are ordinary predictions funded by the grant; no new earn surface), `frontend/reusability.md` for the store and the util.

**Tests**

- **Pure logic** (`src/tests/lib/utils/landing-calls.utils.spec.ts`): every row state; the drift threshold on both sides and at the boundary; allotment in tap order when the balance covers some but not all; unchecking frees funds; expired and duplicate taps; a size that rounds to zero contracts; a held series.
- **Store and handoff** specs: malformed storage reads as empty; the cap; one call per series; the payload survives a parse round trip and an unknown field is dropped.
- **E2E** (`e2e-web2/landing-calls.spec.ts`, fake engine): tap two cards signed-out, sign up, see both rows with both prices, confirm, see two positions and the reduced balance; a market closed between tap and sign-up shows `closed` and places nothing; "Not now" places nothing; a price moved beyond the threshold arrives unchecked; the summary's challenge action yields a `/c/<id>` link whose public read matches the fill.
- **API:** none added. `backend/tests/vxp-referral.test.ts` already covers settlement on a first executed prediction, which is what a confirmed call is.

**Rollout**

Web build only, in the same release as the landing go-live and part A. No migration. Rollback is the previous web image; pending calls left in a browser expire on their own.

**Risks**

- **Guest-mode promise.** The product has said, in copy and in `PRODUCT.md`, that preview picks never become positions. This spec makes landing taps the stated exception, and only through an explicit confirmation at the current price; the copy on both surfaces must stay truthful about which is which.
- **Faster first prediction.** A new account can now hold real positions within its first minute, so a referral (including one through a challenge link) can settle at sign-up. The gate is unchanged (one executed prediction, which was always reachable seconds after sign-up), and the referrer curve and cap still bound the payout; the sybil surface tracked in #543 is not widened, but it is exercised sooner.
- **Thin books.** A new user's first experience depends on the curated series having liquidity at the default size at go-live. An `unfillable` first call is a poor welcome; the curated series' books are a launch checklist item, not something this spec can guarantee.
- **Funding latency.** If the grant routinely takes longer than the timeout, most users meet the waiting state. Measure with the `funding_timeout` label and tune the constant.

## Acceptance criteria

- [ ] A tap on the landing deck places no order and sends nothing to a server.
- [ ] After sign-up with pending calls, the confirmation sheet lists each with the price at the tap, the current price and the default call size read from the constants.
- [ ] Nothing is placed until the user confirms; "Not now" places nothing.
- [ ] A confirmed call executes at the current book, never at the price of the tap, and the summary shows the real entry price.
- [ ] A market that closed since the tap is shown as closed and cannot be confirmed.
- [ ] A price that moved beyond the threshold arrives unchecked with the movement shown; the user can still check it.
- [ ] When the available VXP cannot cover every checked call, the earliest taps are funded and the rest are disabled; no call is placed at a reduced size.
- [ ] While the starter VXP is not yet available the sheet waits, then offers retry or "Not now".
- [ ] Pending calls are cleared after a confirmation and expire on their own otherwise.
- [ ] "Challenge a friend" on the summary produces a part A link bound to the real fill; with no filled call it produces none.
- [ ] Flow guest picks are still discarded at sign-up.
- [ ] No literal call size, grant amount or threshold appears outside the constants files.
- [ ] `PRODUCT.md` and `economy.md` describe the shipped behaviour.
- [ ] `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Does the landing deck already persist taps**, and under which module and shape? If so this spec extends it (adding `priceAtTap` and the expiry) rather than adding a store.
2. **Can a signed-out visitor tap on the landing's Markets view** as well as on the deck, and does that view carry its own call size? If it does, the confirmation still uses the default size (owner decision), and the sheet must say so.
3. **How long does the registration grant take to become available balance in production** (award transfer plus sweep)? This sets `LANDING_CALLS_FUNDING_TIMEOUT_MS` and decides whether the waiting state is an edge case or the norm.
4. **Do the three curated series have resting liquidity on both sides at the default size**, and who keeps it there at go-live?
5. **Open issues.** Run the issue search that was not possible at authoring time.

## Pending decisions

Each needs the owner; the recommendation is the author's.

1. **Drift threshold.** The value of `LANDING_CALL_DRIFT_POINTS` and what crossing it does. _Recommendation: 10 percentage points in either direction, and the row arrives unchecked (the user can check it). A favourable move is treated the same as an adverse one: the point is that the call is no longer the one they tapped._
2. **Returning accounts.** A visitor who taps on the landing and then signs in to an existing account: offer the same confirmation, or discard the taps. _Recommendation: offer it. The confirmation is explicit, it spends their own balance, and the `held` state already covers markets they hold._
3. **"Not now".** Keep the pending calls for one more session, or discard at once. _Recommendation: one more session, then discard, so a user interrupted by the funding wait is not punished, and stale taps do not follow anyone around._
4. **Call size on the sheet.** Fixed at the default, or adjustable per call within the bounds. _Recommendation: fixed at the default for go-live, as decided for the conversion; the app's own call-size control takes over from the first call made in Flow._
5. **Cap and lifetime of pending calls.** `LANDING_CALLS_MAX` and `LANDING_CALLS_TTL_MS`. _Recommendation: 10 calls and 7 days. Ten default-size calls fit inside the starter grant with room left, and a week covers "tapped on the phone, signed up at the weekend" without resurrecting calls on markets the visitor has forgotten._
6. **Which call the challenge action targets.** The most recent filled call, or a choice. _Recommendation: the most recent filled call, or the one the visitor asked to challenge on before signing up; one button, no picker._
7. **Naming on the landing.** Whether the landing may call a tap a "call" before sign-up. _Recommendation: yes, with the confirmation sheet titled so the difference is plain ("Make your calls real"); the landing must not say "prediction placed" or show VXP committed._

## Decisions

- **Explicit confirmation, at the current price.** Fixed by the owner. The spec adds the reason it is also the safe design: executing at the remembered price would hand every visitor a free look-back option, and executing silently would spend a new user's grant without consent.
- **Earliest taps first, never a smaller size.** Shrinking sizes to fit makes every call fall under the default and complicates the copy; dropping the latest taps keeps each placed call a normal one.
- **No new server surface.** The API already refuses what must be refused (closed market, insufficient balance, self-trade) on the order routes; a "convert" endpoint would duplicate that and add a second way to place an order.
- **A client-held `priceAtTap` is acceptable** because it only informs the user who tapped. Nothing trusts it.
- **Split from part A.** One spec covering both would have spanned a migration, an API domain, the web image, three app surfaces and onboarding in a single PR. This part depends on part A only for its last step, so it can be built and reviewed on its own.
