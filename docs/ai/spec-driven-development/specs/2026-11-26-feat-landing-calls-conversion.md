# Spec: Landing calls become real predictions at sign-up

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **B** of the challenge links work; the parts and how they stack are listed in [`2026-11-26-feat-challenge-links-api.md`](./2026-11-26-feat-challenge-links-api.md). **Stacks on A1 for its last step only** (creating a challenge link after the confirmation); everything before that step needs only the landing page PR. Buildable in parallel with A2, A3 and A4. Ships with the landing go-live.

## Goal

A visitor taps Yes or No on the signed-out landing. Those taps move nothing: no account, no balance, no order. When the visitor signs up, or signs in to an existing account, a sheet lists the calls they tapped and asks them to confirm: each confirmed call is placed as a real prediction at its call size, at the price available at that moment, with the change since the tap shown next to it. Nothing is placed without the confirmation. After it, the user is offered "Challenge a friend" on a call they just made, which issues a verified link bound to that real prediction.

## Context

**Landing taps.** The signed-out landing (deck and Markets view, components under `src/lib/components/landing/`, delivered by the landing page PR, not on `main` at authoring time) lets a visitor tap Yes or No. A deck tap uses the default call size; a tap in the Markets view carries the size chosen on its slider. After a tap the landing says, exactly: "You called Yes with 50 VXP. If you're right, you earn N VXP." (side, size and payout from the tap), followed by a line inviting the visitor to sign up.

**Guest picks, for contrast.** `recordGuestPick` in `src/lib/stores/guest.store.ts` stores a Flow preview pick as `marketId` / `side` / `ts`, "no entry price, no amount, because nothing is reconciled at convert", and `PRODUCT.md` ("Guest mode") states that guest picks are discarded at sign-up and that no conversion surface may imply they carry over.

**Sign-up and the handoff.** The pre-auth payload under `PENDING_ONBOARDING_STORAGE_KEY` (`PendingOnboarding` in `src/lib/services/onboarding-handoff.services.ts`) is stashed before any provider runs, so it survives a full-page OAuth redirect, and `drainPendingOnboarding` applies it after sign-in from `src/routes/(app)/+layout.svelte`. `wasBootstrappedThisSession` is how the drain tells a brand-new account from a returning one.

**Starter VXP.** The registration grant (`NEW_USER_VXP_TOTAL_BASE_UNITS` in `src/lib/constants/vxp-onboarding.constants.ts`) is a real ledger transfer fired by the profile write (`runOnboardingProfileTrigger` in `backend/src/vxp/onboarding.ts`), then swept into clearing where it becomes available balance ([`frontend/web2-backend-mode.md`](../../frontend/web2-backend-mode.md), "The custodial wallet"). It is not spendable in the instant the account is created.

**Placing a real prediction.** `executeOutcomeTrade` (`src/lib/utils/trade.utils.ts`) and `placeOrder` (`src/lib/services/order.services.ts`) are the one path every real call takes: the expiry gate (`MarketClosedError`), the zero-quantity guard, the book walk bounded by `maxSpendUsd`, the `position_taken` event, the trade activity and its award triggers. `flowTradeService` (`src/lib/services/flow.services.ts`) batches the refreshes of several calls in a row. `calculateMarketStats` and `resolveOutcomeExecutionPrice` (`src/lib/utils/market.utils.ts`) give the price a side would execute at.

**Call size.** The default, the bounds and the step live in `src/lib/constants/vxp-economy.constants.ts`. A separate spec changes the call size to a continuous range with a default and a step; this spec reads all of them from that file and states no number of its own.

**Sheet hosts.** `src/lib/components/guest/GuestSaveHost.svelte` is the pattern for a conversion surface mounted once in the app shell that waits for a quiet moment (`flowBeatActiveStore`, `menagerieCelebrationStore`).

**From A1.** `createChallenge` in `src/lib/services/challenge.services.ts`: needs a real engine position, returns one link per (user, series), takes the consent flag.

## Scope

### 1. Recording a tap

- Each Yes/No tap on the landing is stored client-side as a **pending call**: `seriesId`, `side`, `size` (the tap's own size: the default for a deck tap, the slider's value for a Markets tap), the side-framed price shown at the tap (`priceAtTap`), and `tappedAt_ms`. One pending call per series: a later tap on the same series replaces the earlier one.
- **Limits:** at most 10 pending calls (`LANDING_CALLS_MAX`; beyond it the oldest is dropped), each kept for 7 days (`LANDING_CALLS_TTL_MS`).
- A pending call is shown to nobody else and sent to no server. `priceAtTap` is only ever used to tell this same user how the price moved; it is never an execution price and never appears on a challenge link (A1 reads the real fill from the engine).
- The pending calls are copied into the pending-onboarding payload when the visitor starts sign-up or sign-in, so they survive a provider redirect.

### 2. Landing copy after a tap

The landing's line after a tap is the design's, word for word: **"You called Yes with 50 VXP. If you're right, you earn N VXP."**, with the line under it inviting the visitor to sign up. Nothing is committed at that point: the visitor has no account and no VXP. That tension is an accepted owner decision (see "Decisions"). The confirmation sheet below is where the commitment is made explicit, and it must not soften that: its title and its primary action say that the calls become real now, at today's price.

### 3. Confirmation sheet

After sign-up, once the profile exists and the handoff has drained, a sheet opens for an account with at least one pending call. **A returning account that signs in with pending calls gets the same sheet, paid from its own balance.** It lists each call:

- market title, the side tapped, "38% when you tapped, 44% now" (the current executable price for that side), and what it would earn at that price;
- **the call size, editable per row** within the bounds and step of the call-size constants, starting at the tap's own size;
- a checkbox per row, and a footer with the total against the available VXP ("Confirm 3 calls, 150 of 1,500 VXP": figures from the rows and the live balance, never literals);
- two actions: confirm the checked rows, or "Not now".

Row states, computed by one pure function from the pending calls, the live markets and the balance:

| State        | When                                                                                                      | Row                                                                        | Checked by default |
| ------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| `ready`      | market open, price moved by less than `LANDING_CALL_DRIFT_POINTS` since the tap, funds cover it           | both prices and the difference                                             | yes                |
| `drifted`    | market open, price moved by **5 percentage points or more**, in either direction                          | both prices, the difference emphasised, "The price moved since you tapped" | no (re-checkable)  |
| `closed`     | series past expiry, settled, no longer listed, or not yet revealed                                        | "This market has closed. No call made."                                    | disabled           |
| `unfillable` | no executable price for that side (empty book), or the size rounds to zero contracts at the current price | "No call possible at this price right now."                                | disabled           |
| `held`       | the account already holds a position on that series (a returning account)                                 | "You already called this."                                                 | disabled           |
| `unfunded`   | the available VXP does not cover this row after the checked rows above it                                 | "Not enough VXP for this one." (lowering its size can bring it back)       | unchecked          |

- **Order and funding.** Rows are ordered oldest tap first, and funds are allotted in that order over the checked rows. When the available VXP cannot cover every checked call at its size, the earliest are kept and the rest become `unfunded`. The sheet never shrinks a size on its own; the user can lower a row's size, or uncheck one, to free funds for the next.
- **Price at confirmation.** Each confirmed call is a market order through `executeOutcomeTrade` with its size as the spend ceiling, so it executes at the book as it stands when the user confirms, never at `priceAtTap`. A remembered price would be a free option on every market move between tap and sign-up.
- **Between sheet and fill.** The "now" price is a quote. If the market closes or the book empties between rendering and execution, that row reports the existing typed failure (`MarketClosedError`, a zero fill) inline and the others proceed. A partial fill is reported as what it filled.
- **Result.** The sheet ends on a summary: each call with its real entry price ("Yes at 44%"), each failure with its reason, and the VXP committed. Pending calls are then cleared, whatever the outcome of each row.
- **"Not now"** closes the sheet and keeps the pending calls for one more session: the sheet is offered once more on the next session, then the calls are discarded. Nothing is ever placed without the confirm tap.

### 4. When the starter VXP is not there yet

For a new account the grant is a ledger transfer and a sweep, so the sheet opens in a waiting state ("Getting your starter VXP ready") and enables the confirm action when the available balance covers at least one row. After `LANDING_CALLS_FUNDING_TIMEOUT_MS` it offers "Try again" and "Not now". A grant that never arrives (a failed award is retried by the existing reconciliation) leaves the pending calls to the "one more session" rule. A returning account never waits: its balance is what it is, and rows it cannot cover are `unfunded`.

### 5. Then: challenge a friend

- **Target.** The market the visitor asked to challenge before signing up (`challengeIntentSeriesId`, carried in the pending-onboarding payload), if they confirmed that call and it filled; otherwise the most recent confirmed call that filled. **If no call was confirmed, there is no challenge action:** the summary nudges the user to make a call first, because a link needs a real prediction.
- The action opens the challenge share sheet for that market: the consent toggle (show my @handle and my call on this link, on by default), the preview of what recipients will see, and the send options. Creation goes through A1 (`createChallenge`), so the link is bound to the fill the engine recorded seconds earlier.
- On the landing, tapping "Challenge a friend" while signed out first asks for a handle (the real sign-up), then follows the path above.

### 6. What does not change

- Guest picks made in the Flow preview stay discarded at sign-up, as `PRODUCT.md` describes. Only landing taps are offered for confirmation.
- The registration grant, its amount and its trigger. Confirming calls spends VXP on real predictions; it mints nothing.
- The Flow daily swipe counter (`recordFlowSwipe`): a confirmed landing call is not a Flow swipe. It is a real fill, so it records an activity day, counts as an executed prediction for the milestones, and settles a pending referral (including one credited through a challenge link) like any first prediction.

### Out of scope

- Challenge links themselves: A1 to A4.
- The landing, its cards, its Markets view, its tap interaction and its copy: the landing page PR. This spec adds the persistence of a tap and the hand-off into sign-up.
- The call-size range change: separate spec.
- Converting Flow guest picks.
- Any server endpoint beyond A1's create: confirmed calls use the existing session-gated order routes. No route, table, migration or Turnstile check is added here (the public sign-up surface is protected by the separate Turnstile PR).
- The web3 build: it has no sign-up and no landing of this kind.

## Linked issues

GitHub issue search was not possible from the authoring session (no access to the repository's issues). No issue is linked. The implementer searches open issues for "guest", "onboarding", "starter" and "landing" before flipping the status and records the result here. `PRODUCT.md` references #543 (anti-farm hardening of the new-account mint surface); see "Risks".

## Analytics

Instrument, with existing names only (no taxonomy change):

- `onboarding_step` with `source: 'landing_calls'` (a new account) or `'landing_calls_returning'` (an existing one) and `label`: `shown` (`count` = pending calls, `value` = rows not `ready`), `confirmed` (`count` = calls filled, `value` = whole VXP committed, `ok` = any size was edited), `skipped`, `funding_timeout`.
- `position_taken`: already emitted by `placeOrder` for every real fill. To separate these, `placeOrder` gains an optional `source` passed through to the event (`'landing_convert'`); every existing caller is unchanged.
- `challenge_created` is recorded by the server (A1); the share is `market_shared` with `source: 'challenge'` from the shared sheet.
- Landing-side tap events belong to the landing analytics PR.

All props are closed vocabularies and counts. No market title, handle or price-at-tap is sent.

## Implementation outline

1. **Constants** `src/lib/constants/landing-calls.constants.ts`: `LANDING_CALLS_STORAGE_KEY`, `LANDING_CALLS_MAX`, `LANDING_CALLS_TTL_MS`, `LANDING_CALL_DRIFT_POINTS`, `LANDING_CALLS_FUNDING_TIMEOUT_MS`. Call-size default, bounds and step are imported from `vxp-economy.constants.ts`.
2. **Store** `src/lib/stores/landing-calls.store.ts`, modelled on `guest.store.ts` (validated read, best-effort persist, bounded list): `recordLandingCall`, `clearLandingCalls`, expiry on read, a size outside the current bounds clamped on read. If the landing page PR already persists taps, extend that store instead of adding a second one (open question 1).
3. **Pure logic** `src/lib/utils/landing-calls.utils.ts`: `planLandingCalls({ calls, markets, prices, heldSeriesIds, availableVxp, sizes, checked, now_ms })` returning the rows, states and allotment of the table above, and `challengeTarget({ intentSeriesId, filled })`.
4. **Handoff.** `landingCalls` and `challengeIntentSeriesId` in `PendingOnboarding` with strict parsing in `parsePendingOnboarding`; the drain moves them back into the store on both its new-account and returning-account branches and never places anything itself.
5. **Sheet** `src/lib/components/onboarding/LandingCallsHost.svelte` (mounted once in `src/routes/(app)/+layout.svelte`, with the collision gate `GuestSaveHost` uses) and `LandingCallsSheet.svelte`; the per-row size control reuses the app's call-size control (`src/lib/components/market/FlowCallSizeSlider.svelte`) rather than a second one. Execution goes through `flowTradeService.startSession()` / `executeTrade` / `endSession()` so balances and positions refresh once.
6. **Order source.** Optional `source` on `placeOrder` / `TradeParams`, forwarded to the `position_taken` event only.
7. **Challenge hand-off.** The summary mounts the challenge share sheet (`src/lib/components/market/ChallengeShareSheet.svelte`) on the target market. That component is also A3's: whichever of the two PRs merges second reuses the one the first added (see "Risks").
8. **Landing.** `recordLandingCall` on a tap; the stash of calls and challenge intent when sign-up or sign-in starts.
9. **i18n** keys in every catalog (`onboarding.landing_calls.*`).
10. **Docs in the same PR:** `PRODUCT.md` (a "Landing calls" entry; one sentence in "Guest mode" saying landing taps are the exception and why), `economy.md` (confirmed landing calls are ordinary predictions; no new earn surface), `frontend/reusability.md` for the store and the util.

**Tests**

- **Pure logic** (`src/tests/lib/utils/landing-calls.utils.spec.ts`): every row state; drift just under, exactly at and over the threshold, both directions; allotment in tap order when the balance covers some but not all; lowering a size or unchecking frees funds; a size outside the bounds; expired, duplicate and over-the-cap taps; a size that rounds to zero contracts; a held series; `challengeTarget` for intent confirmed, intent not confirmed, and nothing confirmed.
- **Store and handoff** specs: malformed storage reads as empty; the cap drops the oldest; one call per series; the payload survives a parse round trip and an unknown field is dropped.
- **E2E** (`e2e-web2/landing-calls.spec.ts`, fake engine): tap two cards signed-out, sign up, see both rows with both prices and their sizes, confirm, see two positions and the reduced balance; a Markets tap arrives with its slider size; editing a size changes the total and the fill; a market closed between tap and sign-up shows `closed` and places nothing; a price moved by the threshold arrives unchecked and can be re-checked; "Not now" places nothing and the sheet returns once; a returning account signing in gets the sheet and pays from its own balance; the summary's challenge action yields a `/c/<id>` link whose public read matches the fill; with nothing confirmed there is no challenge action.
- **API:** none added.

**Rollout.** Web build only, in the same release as the landing go-live. No migration. Rollback is the previous web image; pending calls left in a browser expire on their own.

**Risks**

- **Landing copy says "You called" before anything is committed** (accepted owner decision). The sheet carries the whole burden of making the commitment explicit; a sheet that reads like a formality would turn that copy into a false statement. Its title, the per-row "now" price and the confirm label are review-critical.
- **Guest-mode promise.** `PRODUCT.md` says preview picks never become positions. Landing taps become the stated exception, only through the explicit confirmation at the current price; the two surfaces' copy must stay truthful about which is which.
- **Shared share sheet.** This part stacks on A1 only, but its last step needs the challenge share sheet with the consent toggle, which A3 also builds. The component's props must be agreed before either starts; the PR that merges second reuses it.
- **Faster first prediction.** A new account can hold real positions within its first minute, so a referral can settle at sign-up. The gate is unchanged (one executed prediction, always reachable seconds after sign-up) and the referrer curve and cap still bound the payout; the surface tracked in #543 is not widened, but it is exercised sooner.
- **Thin books.** An `unfillable` first call is a poor welcome; liquidity on the curated series at go-live is a launch checklist item this spec cannot guarantee.
- **Funding latency.** If the grant routinely takes longer than the timeout, most new users meet the waiting state. Measure with the `funding_timeout` label and tune the constant.

## Acceptance criteria

- [ ] A tap on the landing places no order and sends nothing to a server; at most 10 are kept, for 7 days.
- [ ] After a tap the landing shows the line "You called Yes with 50 VXP. If you're right, you earn N VXP." with the tap's side, size and payout.
- [ ] After sign-up with pending calls, the sheet lists each with the price at the tap, the current price and the tap's own size.
- [ ] A returning account that signs in with pending calls gets the same sheet and pays from its own balance.
- [ ] Each row's size is editable within the call-size constants.
- [ ] Nothing is placed until the user confirms; "Not now" places nothing, and the sheet returns once on the next session, then the calls are gone.
- [ ] A confirmed call executes at the current book, never at the price of the tap, and the summary shows the real entry price.
- [ ] A market that closed since the tap is shown as closed and cannot be confirmed.
- [ ] A price that moved 5 points or more, either way, arrives unchecked with the movement shown, and can be re-checked.
- [ ] When the available VXP cannot cover every checked call, the earliest taps are funded and the rest are not; no size is reduced without the user doing it.
- [ ] For a new account, while the starter VXP is not yet available the sheet waits, then offers retry or "Not now".
- [ ] The challenge action targets the market the visitor asked to challenge if they confirmed it, otherwise the most recent confirmed call; with none confirmed it is absent and the user is nudged to make a call.
- [ ] Flow guest picks are still discarded at sign-up.
- [ ] No literal call size or grant amount appears outside the constants files.
- [ ] `PRODUCT.md` and `economy.md` describe the shipped behaviour; `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Does the landing page PR already persist taps**, and under which module and shape? If so this spec extends it (size, `priceAtTap`, expiry) rather than adding a store.
2. **How long does the registration grant take to become available balance in production** (award transfer plus sweep)? This sets `LANDING_CALLS_FUNDING_TIMEOUT_MS`.
3. **Do the curated series have resting liquidity on both sides at the default size**, and who keeps it there at go-live?
4. **Call-size constants.** The names of the bounds and step exported by the call-size spec, so the sheet and the store's clamp import them.
5. **Open issues.** Run the issue search that was not possible at authoring time.

## Decisions

Owner decisions are marked as such.

- **Explicit confirmation, at the price at confirmation time** (owner). Executing at the remembered price would hand every visitor a free look-back option, and executing silently would spend VXP without consent.
- **Drift threshold: 5 percentage points, either way** (owner). A row that moved at least that much arrives unchecked; the user can re-check it. A favourable move is treated like an adverse one: the call is no longer the one they tapped.
- **Returning accounts get the same confirmation, paid from their own balance** (owner).
- **"Not now" keeps the taps for one more session, then discards them** (owner).
- **Call size is the tap's own** (owner): the default for deck taps, the slider's value for Markets taps, editable per row in the sheet within the call-size constants.
- **At most 10 pending taps, kept for 7 days** (owner).
- **Challenge target after sign-up** (owner): the market the visitor asked to challenge before signing up, if they confirmed it; otherwise the most recent confirmed call; with none confirmed, no challenge and a nudge to make a call.
- **Landing copy after a tap is exactly the design's** (owner): "You called Yes with 50 VXP. If you're right, you earn N VXP.", with the line under it inviting sign-up. The tension with "nothing is committed until confirmation" is accepted; the confirmation sheet is the place where the commitment is explicit.
- **Earliest taps first; a size is never reduced automatically.** Silently shrinking a call would place something the user did not choose; the row says it is not covered and the user decides.
- **No new server surface.** The API already refuses what must be refused (closed market, insufficient balance, self-trade) on the order routes; a "convert" endpoint would be a second way to place an order.
- **A client-held `priceAtTap` and `size` are acceptable** because they only inform, or are confirmed by, the user who tapped. Nothing trusts them: the size is re-validated against the constants and the balance, and the price is replaced by the book.
