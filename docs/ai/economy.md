# VXP economy: governing rules

This is the **policy layer** for the VXP economy: the rules every mint
must respect, why the deliberate constraints exist, and how the code
stays in sync with them. It is the compulsory reference for any change
that mints, gates, caps, or recovers VXP.

Read alongside:

- [`PRODUCT.md` §VXP economy](./PRODUCT.md#vxp-economy): what the
  product does (shipped behaviour).
- [`satellite/economy.md`](./satellite/economy.md): how an award is
  implemented (invariants + new-award-type checklist).
- The three constants files, which are the **single source of truth
  for every value**:
  [`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts),
  [`referral.constants.ts`](../../src/lib/constants/referral.constants.ts),
  [`vxp-onboarding.constants.ts`](../../src/lib/constants/vxp-onboarding.constants.ts).

> This page states **rules and rationale only**. It never restates a
> numeric value: amounts, caps, and gates live in the constants files
> above. A number written here would be a second source that drifts
> silently (see
> [writing for agents](./governance.md#writing-for-agents-meta-rules-for-docsai)).

## Reconciliation protocol: the rules drive the code

The repository's default [truth hierarchy](./governance.md#truth-hierarchy)
puts code above docs: for _what the product currently does_, the code
wins. **Economy policy is the one scoped exception.** For the
_rules_ of the economy (which surfaces mint, what gates and caps bound
each, and the anti-farming posture), **this page is authoritative**:

- An agent that finds the code diverging from a rule stated here
  **reconciles the code to the rule** (it does not silently "fix" the
  doc to match a drifted implementation), and says so in its PR.
- While reconciling, or any time it is asked to touch an earn surface,
  the agent **proposes anti-farming improvements**. Minting VXP for
  near-zero cost is the standing threat; every change to a mint is an
  occasion to ask "how is this farmed, and what bounds it?"
- _Values_ remain owned by the constants files, and _shipped
  behaviour_ remains described by [`PRODUCT.md`](./PRODUCT.md). This
  exception covers economy **rules**, not numbers and not behaviour
  descriptions.
- If a rule here genuinely no longer fits the product, that is a
  **policy change**: update this page deliberately (with the
  rationale), then reconcile the code, never the reverse.

This is what "the economy is part of the product" means in practice:
the rules are governed, and the implementation follows them.

## Principles

1. **Earn-only: there are no VXP sinks.** Nothing charges VXP. The
   only VXP that leaves a user is the **amount** committed to a
   prediction, and that amount is on-chain **clearing collateral** held
   by the risk engine, not a fee or a forfeit: it returns on settlement (won, lost, or
   broken-even) as realized cashflow. League founding is free and
   _awards_ VXP. There is no burn.
2. **The closed loop lives in the clearing engine, not in VXP
   mint/burn.** Because committed amounts are collateral, the zero-sum
   player-vs-market dynamic is enforced by the engine's settlement, not
   by sinks on the VXP supply. VXP supply is therefore controlled by
   **bounding every mint** (next section), not by draining it.
3. **Client previews the expected payout; the server is authoritative
   for the actual credit.** The FE computes the expected return for UI
   (the payout formula in
   [`vxp-economy.utils.ts`](../../src/lib/utils/vxp-economy.utils.ts));
   the satellite computes and transfers the real amount. Where a reward
   amount could be inferred client-side it is **cosmetic**: the
   satellite recomputes it from its own authoritative state before
   paying.
4. **Two numbers share the name "VXP."** The ledger **token** balance
   (holdings = available + backed collateral) and the lifetime
   **points** score (drives level/rank, only grows) are different
   numbers; see [`PRODUCT.md`](./PRODUCT.md#vxp-two-different-numbers-share-the-name).
   This page governs the **token** economy.
5. **Every award is a real ICRC transfer**, recorded in `vxp_awards`
   with lifecycle `pending → paid | failed`, never a cosmetic
   counter. The implementation invariants for this are in
   [`satellite/economy.md`](./satellite/economy.md).

## Earn surfaces

The surfaces that mint VXP, the rule for each, and the constant that
backs it. Amounts are **not** repeated here; follow the link.

| Surface                    | Rule                                                                                                                                                                                                                | Backed by                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prediction win**         | Pays at the market probability: `amount / p_win − amount`, with a floor on `p_win` so a long shot cannot pay an unbounded multiple.                                                                                 | `VXP_P_WIN_FLOOR`, `VXP_CALL_SIZE_LADDER` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts))                                                                                       |
| **Onboarding grant**       | A single registration grant; no engagement-gated drip (the call-gated milestones are retained at zero).                                                                                                             | `NEW_USER_VXP_TOTAL_BASE_UNITS` ([`vxp-onboarding.constants.ts`](../../src/lib/constants/vxp-onboarding.constants.ts))                                                                                           |
| **Referral: referee**      | Flat, one-time, paid to a new user who redeems within the post-signup window and then makes a first prediction.                                                                                                     | `REFERRAL_VXP_BONUS_BASE_UNITS`, `REFERRAL_SIGNUP_WINDOW_MS` ([`referral.constants.ts`](../../src/lib/constants/referral.constants.ts))                                                                          |
| **Referral: referrer**     | **Diminishing** by lifetime conversions, then **hard-capped to zero**. Authoritative count is the satellite's own scan, never the client.                                                                           | `referrerRewardBaseUnits`, `REFERRAL_MAX_PAID` ([`referral.constants.ts`](../../src/lib/constants/referral.constants.ts))                                                                                        |
| **Daily-streak milestone** | Tiered, granted once when the daily streak hits a milestone, counted over server-recorded activity days (UTC days with an executed fill; a Flow swipe alone records none), never the client's `dailyStreak`.        | `VXP_STREAK_BONUSES`, `STREAK_MAX_CONTINUING_DAY_DELTA` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts), [`streak.utils.ts`](../../src/lib/utils/streak.utils.ts))               |
| **Flow volume milestone**  | One-time per lifetime call-count threshold reached, counted as the caller's executed predictions in the engine on each trade activity, never the client's `totalTrades`.                                            | `VXP_FLOW_MILESTONES` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts))                                                                                                           |
| **Flow overtime**          | Repeatable, once per day on an overtime finish (daily counter hits the hard cap), minted inline by the Flow swipe write; a rolling wall-clock cap, counted before each mint, limits it (the day key is client-set). | `VXP_FLOW_OVERTIME_BONUS`, `VXP_FLOW_OVERTIME_ROLLING_CAP`, `VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts))                               |
| **Calibration recovery**   | Pays for a correct call on a finalized market **only while the caller's balance is below the recovery floor**; bounded by a daily and an hourly cap. The skill-based way back from depletion.                       | `VXP_CALIBRATION_REWARD_BASE_UNITS`, `CALIBRATION_RECOVERY_FLOOR_BASE_UNITS`, `CALIBRATION_DAILY_CAP`, `CALIBRATION_HOURLY_CAP` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts)) |
| **Comeback restore**       | One-time top-up _to_ a target for a user returning after an absence (between two server-recorded activity days) with a depleted balance. The re-engagement nudge, triggered by absence, not skill.                  | `COMEBACK_RESTORE_TARGET_BASE_UNITS`, `COMEBACK_BALANCE_FLOOR_BASE_UNITS`, `COMEBACK_AWAY_DAYS` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts))                                 |
| **Achievement unlock**     | Catalog XP, once per achievement, only for an unlock the server evaluates from its own data, never the client's `unlockedAchievements`; three achievements mint nothing (see the caps section).                     | `ACHIEVEMENTS` ([`achievements.constants.ts`](../../src/lib/constants/achievements.constants.ts)), thresholds in [`achievements.utils.ts`](../../src/lib/utils/achievements.utils.ts)                            |
| **League founder**         | Awarded once per league founded, bounded by a lifetime per-account cap.                                                                                                                                             | `VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS`, `VXP_LEAGUE_FOUNDER_MAX_AWARDS` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts))                                                         |
| **Worlds podium**          | Tiered award for a top-three monthly finish.                                                                                                                                                                        | `VXP_WORLDS_PODIUM` ([`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts))                                                                                                             |
| **Tournament prize**       | Tiered award for a member of a monthly tournament's podium leagues (winner, other finalist, either semifinal loser), one per member per tournament whatever the place.                                              | `TOURNAMENT_PRIZE_TIERS` ([`tournament.ts`](../../src/lib/types/tournament.ts))                                                                                                                                  |

The authoritative list of award **types** is the `VxpAwardType` union
([`vxp-award.ts`](../../src/lib/types/vxp-award.ts)). The API books the
same set plus `onboarding` from `VXP_AWARD_TYPES`
([`backend/src/vxp/awards.ts`](../../backend/src/vxp/awards.ts)); its
tests pin that array to the union and to the `vxp_awards` check
constraint (see
[`satellite/economy.md`](./satellite/economy.md#invariants)).

## Caps and gates: the anti-farming spine

With no sinks, **the caps are the economy's stability mechanism.**
Every mint must be bounded so it cannot become an unbounded faucet.
The bound that protects each surface today:

- **Prediction win**: bounded by the `p_win` floor (caps the long-shot
  multiple) and the call-size ladder cap.
- **Referrer reward**: diminishing curve **and** a hard lifetime cap
  to zero; the count comes from the satellite's own scan, so the client
  cannot inflate it.
- **Referee reward**: one-time per account, only inside the
  post-signup redemption window.
- **Streak / flow-volume milestones**: one-time per milestone, per
  lifetime, counted from server-side truth only: the streak from the
  server-recorded activity days (the UTC days of executed fills, never a
  bare Flow swipe), the call count from the engine's executed fills.
- **Achievements**: one-time per achievement id, minted only for an
  unlock the server evaluates itself: `first-call`, `oracle`, `on-fire`
  and `contrarian` from the engine's fills and settlements, `marathon`
  from the server-derived streak, `league-founder` from the league
  rosters. `top-decile` (days held in the leaderboard's top decile),
  `sharpest-eye` and `bold-caller` (monthly accuracy awards) depend on
  figures only the client computes (the top-decile day counter and the
  monthly stats it writes), so the web2 API pays nothing for them.
  **Owner decision pending:** give them a server-side source (a daily
  leaderboard snapshot, server-computed monthly awards), or leave them
  unpaid.
- **Contrarian wins** are judged on the entry price, never on the
  `Settled` event's price: that is the settlement price (1 for YES, 0
  for NO), so it would make every NO win a long shot. The entry price
  is the average cost of the side held into settlement, rebuilt from
  the caller's `Executed` fills on that market: a buy takes YES at the
  fill price, a sell takes NO at one minus it; a fill that adds to the
  position folds in at its volume, one that reduces it leaves the
  average unchanged, one that flips the side restarts it. Self-matched
  trades (both rows of one event) are left out, since their price is
  free to choose. A win counts when the held side is the side the
  market paid and its entry price is at or below
  `CONTRARIAN_PRICE_THRESHOLD`. Only binary price settlements are
  judged: a categorical fill carries no outcome id, so the outcome held
  cannot be priced. Code: `heldBinaryPosition` in
  [`backend/src/vxp/predictions.ts`](../../backend/src/vxp/predictions.ts).
- **Flow overtime**: once per day key, plus a rolling wall-clock cap
  counted off server-stamped creation times, so forged day keys cannot
  farm it.
- **Calibration**: balance-gated (pays only below the recovery floor),
  plus a daily **and** an hourly burst cap. The first side called on a
  finalised market is the one judged: a miss is recorded, and a later
  call on the other side is refused, so a market cannot be called both
  ways until it pays.
- **Comeback**: balance-gated and absence-gated, the absence measured
  between server-recorded activity days (executed-fill days), so it
  cannot be declared and a bare Flow swipe cannot end it.
- **League founder**: lifetime per-account cap.
- **Worlds podium**: once per month and place, for a member at
  month-end whatever their join date, but only if the slot was joined
  before the month closed. A first join has no switch lock, so without
  this anyone could join last month's winner after close and collect its
  prize; a switch or a leave resets the join time, so a move after close
  never carries tenure. The join time is server-stamped on both backends
  (the API's `joined_at_ms`, the satellite doc's `created_at`), never a
  caller-written field.
- **Tournament prize**: once per member per tournament, whatever the
  place: a member of several podium leagues gets the highest tier, and a
  claim for a second place is refused. Only a membership that predates
  the draw counts: the draw seeds the bracket from that roster, so joining
  a placed league afterwards (including after the tournament concluded)
  earns nothing, and a member who left before claiming has no membership
  left to count. The satellite judges the join by the membership doc's
  stored creation time, never the client-written join field.

Every count-bounded cap (flow overtime, calibration, league founder) is
**strict**, never a soft limit: the count and the award insert run in one
transaction behind a per-user, per-award-type lock (`grantCappedAward` in
[`backend/src/vxp/awards.ts`](../../backend/src/vxp/awards.ts)), so
concurrent claims cannot slip past it. The lock is released before the
ledger transfer.

No profile field the client writes (`dailyStreak`, `lastActiveDay`,
`totalTrades`, `unlockedAchievements`) drives a mint on the web2 API:
those fields are the client's display copy. The profile write carries
only the registration grant.

Every server-fired award is also keyed for **idempotency** in
`vxp_awards` (`recipient/awardType/awardKey`), so a hook retry can
never double-pay; see
[`satellite/economy.md`](./satellite/economy.md#invariants).

## Known open farm vectors

Recorded deliberately so the next agent inherits them. These are
**recommendations**, not shipped guards; none is implemented yet.

1. **New-account mint (sybil).** The onboarding grant plus the referee
   bonus is the largest mint a brand-new account can collect, and it
   needs no prior activity. The current defense is the cost of a fresh
   sign-in identity per account: an Internet Identity on the satellite,
   a verified email address (one-time code) or a Google / Apple account
   on the web2 API. Harden further only if abuse appears. Tracking:
   **#543**.
2. **Satellite payouts trust the client-written activity log.** On the
   satellite, referral and onboarding payouts trigger off the user's
   `activities` collection (a client write), not an authoritative engine
   trade, so a spoofed activity could in principle trigger a payout. The
   web2 API already gates both on the caller's executed fills in the
   engine (`backend/src/vxp/predictions.ts`); the satellite still needs
   the same gate. Tracking: **#543**.
3. **Repeatable overtime mint.** The overtime bonus is gated on raw
   daily call count, and committed amounts are returnable collateral
   (not a cost), so it can be farmed with throwaway calls; the rolling
   cap bounds how often it mints, not what the calls are worth.
   Recommendation: gate it on **distinct markets** and a **minimum call
   size** before it mints.
4. **Low-cost founder mint.** Founding a league is a single free write,
   so the lifetime founder cap still permits a sizeable mint for
   near-zero effort. Recommendation: require a **membership / activity
   quality gate** before the founder award fires.

5. **Satellite profile-write awards.** On the satellite, the streak,
   flow-volume, achievement and comeback awards still fire off the
   client's `profiles` write (`dailyStreak`, `totalTrades`,
   `unlockedAchievements`, `lastActiveDay`). The web2 API derives them
   from server-side truth instead (`backend/src/vxp/triggers.ts`); the
   satellite needs the same.

When you implement any of these, move it out of this list and into the
caps section above, and update the constants, not this page, with the
new numbers.

## Design constraints and rejected alternatives

The non-obvious "why" behind the rules above.

- **Why earn-only, not a closed sink-based economy.** A self-contained
  model where lost amounts are forfeited and entries cost VXP only makes
  sense when the currency is purely cosmetic. Here committed amounts are
  real on-chain clearing collateral settled by the risk engine, so a
  "forfeit" would double-count the loss the engine already realizes.
  The closed loop is enforced in clearing; VXP supply is bounded by the
  caps instead. A sink-based design was therefore rejected.
- **Why the referrer reward diminishes and hard-caps, but the referee
  reward is flat.** The referee bonus lands in throwaway alt accounts
  at worst; the referrer bonus accumulates in a real, persistent,
  leaderboard-affecting account: that is the sybil-valuable mint, so
  it is the one that decays and is capped. A flat referrer reward with
  a periodic cap was rejected because the lifetime curve self-limits
  without a blunt wall, letting genuine super-connectors keep referring
  real friends at the floor.
- **Why both comeback restore and calibration recovery exist.** They
  serve different users: comeback is a one-time **re-engagement** nudge
  triggered by _absence_, calibration is an ongoing **skill-based**
  climb triggered by _depletion while present_. They are kept distinct
  rather than unified so a returning user is not forced into a grind to
  get unstuck, and an active depleted user still has a skill path.
- **Why the onboarding grant is a single up-front amount.** It is sized
  to carry a new user through their first predict → resolve → payout
  loop before any wall, so they experience the win loop before the
  scarcity loop. An engagement-gated drip was rejected as friction;
  gameplay payouts, the first-call achievement, and the referral bonus
  reward continued play instead.
- **Why a `p_win` floor.** Without it a near-certain-loser side would
  pay an enormous multiple of the amount, draining the economy through
  one surface. The floor caps the long-shot payout to a bounded multiple.
