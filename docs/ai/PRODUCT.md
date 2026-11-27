# Vici: Product Description

Living description of Vici's shipped product behaviour. Read this for
**what the product does**; the sibling `docs/ai/**` pages cover **how
to build it**. Implementing agents read it before building a spec (see
[`spec-driven-development/workflow.md`](./spec-driven-development/workflow.md)).

**Maintenance:** update this page in the **same PR** as any behaviour
change, written by the implementer while the context is fresh.
Statements here describe `main`. If this page and the code disagree,
the code wins; fix the page in your PR (see the
[truth hierarchy](./governance.md#truth-hierarchy)).

## What is Vici

Vici is a social prediction-market platform on the Internet Computer.
Users make predictions on binary markets by staking VXP (Vici's ICRC
ledger token), and compete through leagues, leaderboards, and arena
battles. The SvelteKit frontend and its TypeScript serverless
functions run on a Juno satellite; order matching, clearing, and
settlement run on the on-chain risk engine in the separate `icdc-core`
repo, consumed here via generated Candid bindings (Vici is registered
there as engine `eng_0`; see
[`docs/engine-integration.md`](../engine-integration.md)).

Terminology: always **"prediction"**, never "bet".

## VXP: two different numbers share the name

- **Wallet / dash "VXP"** is the ICRC ledger token balance. Holdings =
  available (in the wallet) + backed (reserved as clearing collateral
  for open predictions). Committed amounts are not subtracted from holdings:
  they move from available to backed. On the web2 stack the ledger token
  sits on the account's custodial principal: the wallet reads that live
  balance, and the same auto-sweep moves it into clearing, where it stays
  available until a prediction backs it.
- **Profile / leaderboard "VXP"** is the lifetime points score that
  drives level. It only ever grows and is **not** the token balance.
  The client writes it, so it is display copy: on the web2 API no rank
  reads it (see
  [Global leaderboard](#global-leaderboard-qualify-gate--confidence-adjusted-ranking));
  the satellite still ranks its points leaderboard by it.

VXP has 4 decimals: compare and transfer in base units
(`vxpBaseUnits`), display in whole VXP.

## VXP economy

The compulsory rules of the economy (earn surfaces, caps, gates, the
anti-farming posture, and the doc-drives-code reconciliation protocol)
live in [`economy.md`](./economy.md). This section is the shipped-behaviour
summary; `economy.md` is the governing policy.

Earn-only, by design: there are **no VXP sinks**. Nothing charges VXP:
league creation is free (founding _awards_ VXP), and the only
outflow is the amount committed to predictions, which is clearing collateral, not a
fee.

Earn surfaces: onboarding grant, referrals (referee + referrer),
daily-streak milestones, calibration recovery, comeback restore,
achievement unlocks, league founding, worlds podium, tournament
prizes.

Every award is a **real ICRC ledger transfer**, recorded in the
`vxp_awards` collection with lifecycle `pending → paid | failed`, not
a cosmetic counter (the lifetime `points` score above is the separate
number). A payout the ledger refused (`failed`) is sent again the next
time its claim, settle or trigger runs for the same award.

All amounts, caps, and gates live in three canonical constants files:
never restate the numbers anywhere else (docs, specs, comments):

- [`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts):
  master parameter file (call-size range, streaks, calibration,
  comeback, podium, league founder, …)
- [`referral.constants.ts`](../../src/lib/constants/referral.constants.ts):
  referral bonuses, tier curve, caps, signup window
- [`vxp-onboarding.constants.ts`](../../src/lib/constants/vxp-onboarding.constants.ts):
  registration grant

Implementation invariants and the new-award-type checklist live in
[`satellite/economy.md`](./satellite/economy.md).

## Behaviour index

Grow this list one entry per behaviour-changing PR: a short
subsection or a link to the governing spec / doc. Do not bulk-generate
it from the code.

### Friend activity: tap to "like" a friend's call

Historical: the Arena → Friends section once rendered a per-call activity
feed where each row carried a single tap-to-react "like" (a `Zap` glyph)
with a brief tilt + laurel particle burst on commit (suppressed under
reduced-motion). That like was **persisted**: it survived a refresh, each
row showed an aggregate count, and liking someone's call sent them an
in-app inbox notification that deep-linked to the market (own-call likes
never notified; an unlike withdrew the card; multiple likes collapsed into
one "{user} and N more liked your call" card). The Friends section now
renders the per-friend **results digest** above instead of the per-call
feed, so the persisted like + count no longer appears there (the digest
keeps the `Zap` glyph as a transient reaction). The persisted-reaction +
like-received-notification machinery is unchanged for the surfaces that
still use the `Activity` model. See
[`specs/2026-06-12-feat-friend-feed-reaction-redesign.md`](./spec-driven-development/specs/2026-06-12-feat-friend-feed-reaction-redesign.md)
(the reaction redesign),
[`specs/2026-06-14-feat-friend-feed-like-persistence.md`](./spec-driven-development/specs/2026-06-14-feat-friend-feed-like-persistence.md)
(persistence + counts), and
[`specs/2026-06-14-feat-like-received-notifications.md`](./spec-driven-development/specs/2026-06-14-feat-like-received-notifications.md)
(the like-received notification).

### Friend-readable resolved results: the per-participant outcome feed

When a market resolves, the satellite records one **per-participant**
result row in the `resolved_results` collection: that participant's
outcome (win / loss), the side they held, their signed net VXP, and the
resolution time, keyed `${owner}#${marketId}`. The rows are written
server-side from the clearing settlement plan at resolution time
(controllers-write, mirroring `activity_reaction_counts`), so a user
cannot forge a win for themselves or a friend. Only a role that can
settle (or a controller) may post the settlement activity that triggers
the write, on both stacks, and posting it again keeps every row's first
resolution time. The collection is
controllers-read: on the satellite a client reads it only through `listFriendResolvedResults`, which answers the caller's own rows and those of their active friends whose account is neither deleted nor hibernated, any other requested principal reading as having no results (a single owner-prefix scan over
a caller's friend set, never one call per friend) and is the data source
for the friend results digest. The web2 API answers only the rows of the
caller's active friends whose account is neither deleted nor hibernated;
any other requested id reads as having no results. There is **no source for a friend's
per-call outcome otherwise**: clearing trade-history is caller-scoped, and
the single settlement activity row is the resolver's market-level result,
not a per-participant one. Rows past the retention horizon
(`RESOLVED_RESULTS_RETENTION_MS`, a calendar month plus a grace margin)
are pruned by a controllers-only cleanup. The collection has no
user-visible surface on its own; the digest that renders it ships
separately. See
[`specs/2026-06-25-feat-resolved-results-collection.md`](./spec-driven-development/specs/2026-06-25-feat-resolved-results-collection.md).

### Arena Friends: the "Ranked" list

Above the results digest, Arena → Friends ranks your friends by all-time
prediction **accuracy** (win rate) descending, the same accuracy-first
metric as league rank. Each row shows accuracy, daily streak, and a
head-to-head delta chip (your accuracy minus theirs, green when you
lead). Your own row carries your **rank within the group** (one above
every friend with strictly higher accuracy), a "You" badge by your
handle, and your VXP balance in place of a head-to-head chip. It sits
inline at that real position, not pinned last, and stays visible while
scrolling by sticking to whichever edge of the card its slot has passed,
settling back inline when the slot is on screen. See
[`specs/2026-06-26-feat-friends-you-row-sticky.md`](./spec-driven-development/specs/2026-06-26-feat-friends-you-row-sticky.md).

### Arena Friends: the "Recent results" digest

The Arena → Friends section shows a per-friend **results** digest, not a
per-call activity stream. Each row summarises one friend's resolved
record over a recent window (a calendar month): their win/loss tally and
signed net VXP (win/loss coloured), sourced from the friend-scoped league
standings aggregate in one bulk read, plus a **standout** line (`incl.
"{market}"`) naming the friend's resolved prediction with the largest
absolute net VXP (tie-broken to the most recent), read from the
`resolved_results` collection. A relative time window ("2h ago") comes
from that standout's resolution time. Friends with no resolved prediction
in the window do **not** appear (open / unresolved calls carry no
outcome and are excluded), so the section reads as a quiet scoreboard of
how your friends are actually doing rather than a feed of every move.
Tapping a row opens the standout market (or, when a friend has no retained
standout, their mini-profile sheet). The `Zap` reaction is kept as a
transient acknowledgement on the row (visual + motion, no persistence:
a digest row has no `Activity` doc identity to bind a persisted like to).
The eyebrow reads "Recent results". See
[`specs/2026-06-25-feat-arena-results-digest.md`](./spec-driven-development/specs/2026-06-25-feat-arena-results-digest.md).

### Streak and level milestones in the inbox

When your daily flame reaches a new stage (3 / 7 / 15 / 30 days) or your
profile level goes up, an unread inbox card tells you: the flame card
deep-links to Flow, the level card to your profile. Both are derived live
from your own profile, gated by a high-water marker so a returning user
never sees a retroactive backlog (only a genuine new milestone fires) and
re-climbing a broken streak re-notifies. The streak card respects your
streak-reminder preference. See
[`specs/2026-06-23-feat-streak-level-inbox-notifications.md`](./spec-driven-development/specs/2026-06-23-feat-streak-level-inbox-notifications.md).

### Market probability: skeleton while the book loads

A market's YES/NO probability is the live order-book mid. Until that book has
been read the probability is **unknown, not 50%**: the card shows a loading
skeleton (a repeat visit seeds the last-known probability from a local cache
for an instant paint, then upgrades in place). A market whose book is
read but empty shows a neutral dash, never a fabricated coin-flip;
resolved markets show 100% / 0%. The detail page first-paints from a
fast query, then upgrades to the certified read. See
[`specs/2026-06-14-fix-market-odds-skeletons.md`](./spec-driven-development/specs/2026-06-14-fix-market-odds-skeletons.md).

### Flow cards and market charts: real numbers only

A Flow card and the market chart never show an invented number. The
"+N today" line counts the trades really made on the market over about
the last day (whole hours, never more than really happened) and stays hidden until that count has loaded (or when it is
zero); a friends split shows only when both counts are known; the back of a
card shows how many are predicting only when that count is known (not
yet available, so it is hidden), and
"Who's calling what" lists only the live price and the people you follow
(no top-accuracy row until a real accuracy figure exists); the "this
week" move shows only when the market has price history; and a market
with no trades draws a flat line at its live price instead of a made-up
curve. See [`design.md` § 7.11](./frontend/design.md#711-card-numbers-real-or-hidden).

### Market pricing: maker-liquidity disclosure

The market detail page states, in plain language, where the line comes
from: a live order book that VICI's market maker seeds with resting
liquidity, so the price can move from the first call without implying a
crowd of phantom predictors. The disclosure is a quiet caption under the
stats grid and is mutually exclusive with the cold-start cue: an empty
market shows "your prediction sets the first read"; a market with a line
shows the maker disclosure. See
[`specs/2026-06-20-feat-maker-liquidity-disclosure.md`](./spec-driven-development/specs/2026-06-20-feat-maker-liquidity-disclosure.md).

### Market close: no predictions after kickoff

A market's expiry is the kickoff of the earliest relevant match, and the
rule is "no predictions after kickoff". Enforcement was UI-only (the Flow
deck and catalog are fetched already filtered to unexpired markets), so a
reader who opened Flow just before kickoff could still swipe a stale card
through afterward, because the clearing engine has no expiry gate (it only
rejects an already-**settled** series, which is a later, distinct state).
Placing a prediction now re-checks the market's expiry client-side at
submit time and rejects it if the market has closed, with a distinct
"market closed" message on both the Flow swipe and the trade modal. This
is a stopgap ahead of an engine-side expiry gate in icdc-core.

### Market metadata: translated everywhere, with a global preference and a per-item toggle

When a market has a creator/admin-authored translation for the reader's
locale (resolved through the locale fallback chain), its title, description,
resolution clause, and categorical outcome labels render in that language
**everywhere**: list rows, market cards, the Flow deck (front + back), the
trade modal, share text, the detail page, and every surface that names a
market the reader has predicted on: the portfolio (active calls, history,
open orders), the dashboard (open + resolved call rows and the Day-0 starter
list), the away-resolution digest, the settled-market notifications, the
wallet transaction history + recent activity, and the calibration deck.
The only place a market deliberately keeps its on-chain original is the
admin resolution surface, where operators read canonical text.
A single global preference governs the default ("Show markets in your
language" in Settings → Preferences): on (the default) shows translations
where they exist; off always shows the on-chain original. The preference is
client-persisted in `localStorage` (identity-agnostic, like the theme), so
cross-device sync is deferred. On top of that default, every card and the
detail page carry a small quick switch, shown only when a translation
exists, that flips that one item between translated and original without
changing the global preference; the flip is ephemeral and resets on
navigation. A market with no translation for the reader's locale shows the
original and renders no toggle. Rendering a list/deck issues one bulk
translation read for all visible markets (not one per card); changing the
app locale re-resolves every visible translation. Market **search** still
matches against the original text (a follow-up). See
[`specs/2026-06-15-feat-market-translations-everywhere.md`](./spec-driven-development/specs/2026-06-15-feat-market-translations-everywhere.md)
(fast-follow to
[`specs/2026-06-14-feat-market-translation-display.md`](./spec-driven-development/specs/2026-06-14-feat-market-translation-display.md)).

### Friendship rules

The product rules for the friend graph. Surfaces: Arena → Friends
(add-friend sheet, incoming/outgoing request lists) and the
leaderboard mini-profile sheet; both route through the same relation
service.

- **Adding.** A friend is added by `@handle` or raw principal. On
  vici.app a typed handle resolves to the account holding exactly that
  handle, otherwise to the one whose handle is the same once case, accents
  and `.` `_` `-` are ignored, so `@Antonio.Ventilii` finds
  `antonioventilii` (vici.market keeps the exact, case-insensitive match);
  no match → a "not found" notice suggesting an invite link; resolving to
  yourself is blocked.
- **One relation per pair.** A friendship between two users is a
  single record in one of three states: pending, active, or rejected.
- **Duplicate sends.** Sending while your own request is still pending
  → "request already sent" notice, no duplicate. Sending to an
  existing friend → "you're already friends" notice.
- **Mutual requests auto-friend.** If the other user already sent you
  a pending request, your "add" counts as accepting it; you become
  friends immediately (no second accept step).
- **Reject and retry.** The recipient of a request may reject it. The
  **rejecter** may re-initiate a friendship at any time. The
  **rejected sender** must wait out a cooldown
  (`FRIEND_REQUEST_REJECTED_COOLDOWN_MS` in
  [`relation.constants.ts`](../../src/lib/constants/relation.constants.ts))
  before retrying, and is told the remaining wait ("you can try again
  in …", scaled days → hours → minutes → seconds, rounded up).
- **Cancel.** The sender may cancel a pending request. The cancel is
  version-locked: if the recipient accepts/rejects first, the cancel
  fails instead of racing.
- **Unfriend.** Either side may unfriend at any time; the relation is
  deleted (and league-group admin pairs rebalanced), and re-adding is
  allowed immediately.
- **Follow is separate.** Following someone is a one-way relation that
  never interacts with friendship state.
- **Invites.** Inviting by link rewards both sides via the referral
  bonuses in
  [`referral.constants.ts`](../../src/lib/constants/referral.constants.ts).
  A referral code is private to the satellite: the app resolves one code
  at a time (the invite landing, the redeem, the friendship claim) and
  reads the user's own code, but no one can list the codes or who owns
  them.
- **A league invite implies a friend invite.** Sharing a league invite
  link also carries the sharer's referral code (`?ref=`), so joining the
  league auto-friends the person whose link was used: a brand-new
  sign-up redeems it (friendship + new-user bonus) through the signup
  drain, an existing signed-in user is friended on join (no bonus). A
  plain link with no `?ref=` (sharer has no code yet) just joins the
  league. No opt-out: the friendship is implicit. Decision record:
  [`specs/2026-06-14-feat-league-invite-implies-friendship.md`](./spec-driven-development/specs/2026-06-14-feat-league-invite-implies-friendship.md).
- **A challenge link befriends on an answer, never on an open.** On the
  web2 API a sign-up through a challenge link is a referral redemption
  (friendship included), and a friend who answers it with their own call
  is befriended; reading a link writes nothing (see
  [Challenge links](#challenge-links-a-verified-link-for-one-of-your-calls)).
- **Errors.** Known outcomes surface as the specific messages above;
  an unexpected failure shows friendly copy carrying a short technical
  detail so a user screenshot is enough to diagnose.

Decision record:
[`specs/2026-06-12-fix-friend-request-errors-and-reject-policy.md`](./spec-driven-development/specs/2026-06-12-fix-friend-request-errors-and-reject-policy.md).

### Challenge links: a verified link for one of your calls

On the web2 API (vici.app) a signed-in user can issue a challenge link for any market on which they hold a binary position: a short random id behind `/api/v1/challenges`. No screen issues or opens one yet; the share sheet, the link preview and the receiving page build on this API. What a link says comes from the engine, never from a request:

- **One link per user and market**, showing the challenger's position there now: side, average entry price and when the held position was opened. Every trade refreshes it: a flipped side shows as the new side and is marked as changed, a fully closed position shows no position, and whether the market is still open for predictions (not past expiry, not settled) is read live. Asking again for the same market returns the same link.
- **Consent per link.** The challenger chooses whether the link shows their handle and avatar with the call. With consent it shows them even when the profile is private or calls are not public; without it the link shows no identity. The owner can change that at any time, or turn the link off: it then reads as not found, and asking again issues a new link.
- **The public read** carries the market, the position, whether the side changed, the consented identity and whether the market is open. Never the account id, an email, a balance or a call size. An unknown or turned-off link, one past retention, and one whose owner is deleted (inside the recovery window) or hibernated all read the same "not found"; a recovered account's links work again.
- **Inviter credit.** A challenge link is a referral channel: a new sign-up redeeming it credits the challenger exactly as an invite link does (the same bonuses in [`referral.constants.ts`](../../src/lib/constants/referral.constants.ts), paid on the referee's first prediction, under the same curve and cap) and makes them friends. A person is credited to one inviter ever, whichever link or code came first. An account past the signup window or already referred is credited to nobody and befriended by nobody; redeeming one's own link is refused.
- **Answers.** A friend answers a link by making their own call on its market. The server checks the call in the engine (the client sends no side and no price), records one answer per person and link, and makes the two friends. Opening or reading a link never befriends anyone. The challenger can list the answers to their links, the source of an inbox card that is not shown yet.
- **Limits and retention.** The public read is limited per network address and every write per account; no challenge step asks for a Turnstile check (the sign-up a link leads to is where that sits). A link and its answers are deleted 90 days after its market closed or it was turned off.
- **Analytics.** The server records `challenge_created` and `challenge_answered`.

Decision record: [`specs/2026-11-26-feat-challenge-links-api.md`](./spec-driven-development/specs/2026-11-26-feat-challenge-links-api.md).

### Holdings sheet (Dash): Your VXP, two buckets

Tapping the holdings card on `/dash` opens a sheet that answers a single
question: every VXP the user holds is either **Available** ("Ready to
spend on calls") or **In play** ("Committed to N open calls"). It leads
with a "Your VXP" hero equal to total holdings, then a two-segment split
bar whose widths are proportional to the available / in-play magnitudes
(Available = accent, In play = the muted faint token; a zero segment is
omitted, the whole bar hidden when both are zero), then two colour-keyed
bucket rows that sum back to the hero. The in-play sub-label pluralises
on the live open-call count ("Committed to 1 open call" / "… N open
calls" / "No open calls"). Below the buckets sit the transaction-history
link and an invite CTA; the CTA opens a native share sheet over the
viewer's canonical `/i/{code}` referral link (clipboard-copy fallback
with a brief "copied" state) rather than routing into Arena. The Dash
holdings card itself is unchanged: its "Available + Today" stats stay,
with the full split one tap away. Decision record:
[`specs/2026-06-25-impr-holdings-two-bucket-sheet.md`](./spec-driven-development/specs/2026-06-25-impr-holdings-two-bucket-sheet.md).

### Transaction history (Dash)

The holdings sheet on `/dash` links to `/dash/transactions`: a
paginated, filterable feed of every event that changed what the user
owns: bonuses (labelled from the `vxp:<type>:<key>` ledger memo),
prediction fills (amount committed), wins/losses/break-evens (realized
cashflow), and external transfers. The header shows the dummy-safe
triple that reconciles by construction, **total = available + in
play**, and the last column is the running **total** balance after
each event, anchored on the live total-holdings figure so the top row
always matches the Dash hero. Placing a prediction is wealth-neutral
(VXP moves into play, total is unchanged), so it carries no signed
amount (`–`); the committed amount shows as "… in play" in the
subtitle. Wins credit the profit, losses debit the committed amount, break-evens
net zero. Because total never moves on margin shifting in or out of
play, the column reconciles to a clean zero genesis no matter how much
is currently reserved; anchoring on spendable instead drifted the
oldest balances negative by the reserved amount. Wallet ↔ clearing
collateral sweeps never render; only their ledger fee feeds the
balance math. When the full history is loaded (the walk reached the
beginning), a synthetic "Joined Vici" genesis row closes the feed (no
amount, zero balance), marking the account's zero-VXP origin. The
ledger walk is capped (`TRANSACTION_HISTORY_MAX_LEDGER_PAGES`); when
hit, the genesis row is suppressed and a quiet "older history not
shown" footer appears instead. When the ledger cannot be read at all
(the first index page fails, or the web2 build, which has no ledger
feed), the page shows "transaction history isn't available" instead of
a feed whose balances would be missing every bonus and transfer.
Decision record:
[`specs/2026-06-12-feat-transaction-history.md`](./spec-driven-development/specs/2026-06-12-feat-transaction-history.md).

### League rank: one accuracy-first ranking everywhere

A member's rank within a league is the same number wherever it is shown:
the leagues-list card badge, the league detail hero (`#N` + the `N°NN`
corner badge), and the detail-page leaderboard list. All three derive
from a single ranking: **prediction accuracy** (win rate) descending,
tie-broken on the longer active streak, then on join order (oldest
first), defined once in
[`league-rank.utils.ts`](../../src/lib/utils/league-rank.utils.ts). It is
window-independent: the figure is a single lifetime value, so the THIS
WEEK and ALL TIME tabs show the same order (the tabs and the weekly
▲/▼ rank-trend flourish are presentational and do not change the
ranking). A member with no settled prediction sits at 0% and sinks to
the foot rather than riding join order or role to the top. Decision
record:
[`specs/2026-06-15-fix-league-rank-consistency.md`](./spec-driven-development/specs/2026-06-15-fix-league-rank-consistency.md).

### Global leaderboard: qualify gate + confidence-adjusted ranking

The global leaderboard (Arena → Leaderboard) does not rank on raw
accuracy, which would let a one-and-done predictor (100% on a single
call) sit above a proven 90%-of-50 record. Two guards apply, both over
the same per-window slice the board already reads from the clearing
canister:

- **Qualify gate.** A predictor must have at least a minimum number of
  **settled calls** to be ranked. Below it they are **provisional**:
  excluded from the ranked podium/list and shown instead in a separate
  **Provisional** section with `{done}/{min} to qualify` progress, so a
  newcomer sees a path rather than a phantom #1. The threshold is a
  named parameter (default 10, in
  [`standings.constants.ts`](../../src/lib/constants/standings.constants.ts))
  and is exposed live in the dev Tweaks panel so it can be tuned without
  a deploy.
- **Confidence-adjusted ranking.** Qualified predictors are ordered by a
  **Bayesian-shrinkage score**, not raw accuracy: a win rate is blended
  with a population prior weighted by sample size, so a thin-but-qualified
  record decays toward the mean instead of topping the board. A 10/11
  (≈91%) record therefore ranks below a 45/50 (90%) record.

Every leaderboard row, podium tile and list row, shows the predictor's
**call count** as the trust signal behind the score. Ranks are the
1-based position in the shrinkage order, not the clearing canister's
net-P&L rank (the Dash "Top X%" rank tile still reads the P&L rank: a
known, deliberate inconsistency until accuracy ranking moves into the
canister). The Arena Friends "Global ranking" card reads the viewer's own
all-time position from this same partition (`ownGlobalStanding`), so it
shows the shrinkage rank, or **Provisional** when the viewer is below the
gate, and can never disagree with the board it links into (it previously
showed the satellite points rank, which could read a phantom #1). Decision
record:
[`specs/2026-06-25-impr-leaderboard-integrity.md`](./spec-driven-development/specs/2026-06-25-impr-leaderboard-integrity.md).

The server-side ranking behind the market's "Top predictors here"
candidates (`GET /api/v1/leaderboard`), the viewer's rank and ranked
population (`/leaderboard/rank/:userId`: the profile's "Top X%" line and
the Goat trophy) use the same two guards on the web2 API: every visible
profile with at least the qualify minimum of settled calls, ordered by
the same shrinkage score over its all-time settled history read from the
clearing canister (more settled calls, then the account id, break a
tie). A profile below the gate is unranked there too, so the "Top X%"
line is the viewer's place among
ranked predictors. The client-written `points` never decides a rank.
The ranking is read at most once per public read window
(`rankedUserIds` in
[`backend/src/profiles/leaderboard.ts`](../../backend/src/profiles/leaderboard.ts)).

### Privacy: leaderboard & Worlds sharing opt-outs

Two Settings → Privacy toggles let a user remove themselves from public
ranking surfaces. Both default **on** (legacy / unset reads as on).

- **Show on global leaderboard** off → the user is dropped from the
  ranked and provisional lists **other people** see; ranks below them
  compress with no gap. They keep their own rank: their `You` row and
  the Arena "Global ranking" card (`ownGlobalStanding`) still resolve,
  and their top-decile achievement (the satellite's stored ranking,
  next section) is unaffected. Enforced FE-side by one predicate,
  `isShownOnGlobalLeaderboard` (`visibility.utils`), applied to the
  global leaderboard (`globalStandingsRows`) and to the market detail's
  "Top predictors here" candidates (`visibleLeaderboard`), **failing
  closed**: a non-self row appears only once its profile is loaded and
  not opted out, so an opted-out predictor never flashes onto a list
  before their preference is known. The preference is always read from
  the hydrated profile cache (`profilesStore`), never from a leaderboard
  row: the satellite's leaderboard wire carries no sharing preferences.
  Both surfaces hydrate every raw principal (not just visible rows), so
  opted-in rows fill in as profiles land rather than starving; the
  market detail waits for that hydration before it probes, and
  re-probes whenever the candidate set changes (sign-in, sign-out, an
  opt-out). The clearing canister
  still publishes raw P&L + principals, so this is a display opt-out,
  not a data-hiding guarantee (canister-level hiding is a tracked
  fast-follow).
- **Show in Worlds Universities** off → the user drops out of their
  school / country standings. Enforced at read time in the Worlds
  aggregators (`cohort.services`), which recompute every window over the
  current opted-in roster; so, unlike the leaderboard's display filter,
  this retracts **past** contribution too, not just future. See
  _Worlds Universities: standings reflect the current opted-in roster_
  below for the full behaviour.

Each toggle emits `privacy_sharing_toggled` (`source: leaderboard |
worlds`, `label: on | off`). Decision record:
[`specs/2026-06-28-feat-sharing-opt-out-enforcement.md`](./spec-driven-development/specs/2026-06-28-feat-sharing-opt-out-enforcement.md).

### Satellite: stored global ranking

On the satellite, the market's "Top predictors here" candidates
(`listLeaderboard`), the viewer's rank and ranked population
(`getUserRankAndCount`: the profile's "Top X%" line, the Goat trophy and
the top-decile streak) and the rival (`getMyRival`) read one stored
ranking, never the client-written `points`: every visible profile with at
least the qualify minimum of settled calls, ordered by the board's
shrinkage score over its all-time settled history (`compareRankScore` in
[`leaderboard-score.utils.ts`](../../src/lib/utils/leaderboard-score.utils.ts)),
then by principal. A query cannot call the clearing canister, so
`refreshLeaderboardRanking` computes it in an update and stores it in the
controllers-only `leaderboard_ranking` collection. The app asks for a
refresh, fire-and-forget, on every leaderboard and rank load; a ranking
younger than its TTL is served as is, so a new settlement moves a rank
within minutes, not at once. Before the first refresh nobody is ranked.

### Privacy: what survives an account's deletion

Deleting an account (after the 30-day recovery window, or at once on a
too-late recovery) removes the profile, the private email, the sign-in
identities and sessions, the VXP award history and onboarding ladder,
calibration attempts, the stats and monthly stats, resolved results, the
likes it gave (each liked activity's count goes down), school-email
submissions, referral code, challenge links (with their answers) and the
answers it gave to other people's links, the waitlist reservation its handle
came from, affiliations, relations and league
memberships; owned leagues are disbanded or handed to a member. On the
web2 API an account that still holds funds (in its wallet, as real-money
collateral or trading gains, or in a withdrawal in progress) cannot be deleted: the app
asks the user to withdraw first. An account that receives funds during the
recovery window is not purged while it holds them, and signing back in
after the window restores it so the funds can be withdrawn. Like the
global leaderboard, the monthly awards board lists no soft-deleted,
hibernated or deleted account. What stays, by design:

- **One anonymous marker per one-time VXP award the account was paid**
  (onboarding grant, referee bonus, milestones, achievements, founder
  awards and the others in
  [`economy.md`](./economy.md#caps-and-gates-the-anti-farming-spine)):
  a one-way digest of the sign-in identity (on the web2 API each provider
  subject and verified address, keyed with a server secret; on the
  satellite the principal) plus the award type and key. No name, email,
  user id or principal is stored. Signing up again with the same
  identity is a fresh account in every other way, but it cannot collect
  those awards a second time, and the league-founder and referrer
  lifetime counts carry over.
- **Referral history the referrer's lifetime count needs**: on the
  satellite a referral record that has started paying (keyed by the
  referee principal); on the web2 API the rows naming the deleted account
  as referrer (with the id of the challenge link a redemption came
  through, if any, as plain text), and a referrer's award for a deleted
  referee.
- **Shared audit rows** the account took part in (activities, battles,
  analytics), orphaned and immutable.
- **The anonymous exit signal**: the reason and optional note picked at
  deletion, under a random key, dated only by the UTC day the account
  left, with no reference to the account. Only satellite controllers and
  the API's database read it.

### Worlds Universities: standings reflect the current opted-in roster

A school's / country's Worlds standing is its **current members'** record,
not a running tally that outlives them. The live windows, the all-time
board and the current-month column, are recomputed on read over the
affiliation's present roster: the all-time accuracy sums each member's
lifetime, the month sums each member's `USER_MONTHLY_STATS` for the current
month on the satellite, and each member's settled calls so far this month on
the web2 API (refreshed every few minutes). So the instant a member leaves (allowed after the 90-day affiliation
lock) or turns off the **Worlds** sharing toggle
(`preferences.sharing.worldsOptIn`), their contribution drops out of the
next read: a member can no longer pump a school and keep crediting it after
leaving. A member holds **one** school and **one** country at a time: a
second one of a kind is refused until they leave the first (so the lock
also bounds switching), and every standing, roster, count and the podium
credit a member's earliest slot of a kind if older data holds two.

A **closed** month is different: it is **frozen at close**. The first time
anyone claims that month's podium, the ranking is computed from **settled
history**, each opted-in member's settled calls and wins over the month as
recorded by the clearing engine (the same source league battles are scored
from), counting only members whose slot was joined before the month closed,
and captured as an immutable snapshot; the podium payout and the champion
cup read from it thereafter. The live month column is a view (the members'
own synced monthly stats on the satellite, their settled history so far on
the web2 API) and never decides a payout. A later leave does not rewrite
a month that has already ended, so awards and cups stay stable and can't
drift between two people claiming the same month. The podium award goes
to a member at month-end whatever their join date, but only for a slot
joined before the month closed: joining or switching to a winner after the
fact earns nothing. A month confers a cup only once it has been frozen
(claimed). The snapshot is written out over the first few claims of the
month, a bounded batch per call, and nothing is paid or shown as frozen
until it is complete; the app claims again until then. Decision record:
[`specs/2026-06-28-impr-worlds-standings-current-members.md`](./spec-driven-development/specs/2026-06-28-impr-worlds-standings-current-members.md).

**A member's school verification never rewrites the school registry.** A
school email on a directory domain verifies that directory school; on an
unknown domain it adds the school the member typed, keyed by the
normalized name. That name may not be a directory school's id, and an id
the registry already holds answers only to an address on one of that
row's domains, checked when the code is sent and again when it is
verified. A verification creates a missing registry row and otherwise
only recounts its verified members: the row's name, country, domains
and status stay as they are, and it turns public only when the count
first crosses `SCHOOL_VERIFIED_PUBLIC_THRESHOLD`, so a school an admin
held back stays held back. A typed name is capped at
`SCHOOL_NAME_MAX_LENGTH` and the country is a two-letter code.

### Battles: accuracy face-offs that resolve themselves

A **battle** is a time-bound accuracy face-off between two leagues. A
league **owner or admin** proposes; an **owner or admin** of the
challenged league **accepts or declines**, and an unanswered proposal
**expires** after a fixed respond-by window (3 days). The `admin` role is
a delegated battle authority: it can initiate and respond exactly as the
owner does; a plain member sees "Only a league owner or admin can start a
battle." and has no battle controls. An **owner** grants the role from
the member sheet on the league page ("Make admin" / "Remove admin");
promotion only toggles `member ↔ admin` and is owner-only, enforced
server-side. For a league battle, **accepting starts the
clock**: the proposer picks only a duration (7 / 14 / 30 days), and the
N-day window runs from the moment of acceptance (accept fuses the old
separate kickoff). The forward-only lifecycle is therefore **proposed →
in_flight → resolved**, with **declined** and **expired** as terminal
ends of an unaccepted proposal. A league may run **any number of battles
at once** (a far client-side rail of 100 simultaneous live battles
guards against abuse); incoming challenges surface as a "Battle requests"
list on the league page even while other battles are live, so a busy
league can still accept or decline. Because Juno docs aren't pushed live
across users, both sides of the battle are told what they'd otherwise miss
via inbox notifications derived from the battle's own state: the challenged
league's owner gets an **incoming-challenge** card ("{opponent} challenged
your league to a {days}-day accuracy face-off") that deep-links to the
league page where the Accept / Decline CTA lives, and the proposer is told
their challenge was accepted or declined. The cards appear the next time
the recipient's client reads their leagues' battles and age out of a 3-day
window. (Duels, principal-vs-principal, keep the older **proposed → accepted →
in_flight → resolved** manual-score path and aren't user-creatable yet.)

**Live battles are discoverable, and you can see who's winning before
they resolve.** Every battle under way across your leagues appears in a
**Live battles** list in the Arena → Battles tab, and the live cards on a
league's page link there too; each row opens the battle detail page. That
page shows **provisional standings** while a battle is `in_flight`: each
side's members' settled-call win rate so far over `[kickoff, now)`, read
from clearing settlement history, with the current leader highlighted,
counting only members who joined before kickoff (the resolved score
counts the same roster, so joining mid-battle never carries a side),
computed read-only on the same data resolution uses, so it never alters
the battle or triggers an early resolve. It's labelled provisional and
keeps moving as each side predicts, until the window closes and the
write-once resolved score takes over.

**Who can challenge whom is governed by league privacy.** A league is
either **Open** or **Private** (the two-tier model; there is no separate
invite tier). Only **Open** leagues are discoverable in challenge search
and challengeable by outsiders; a league you are **already a member of**
is always challengeable regardless of its privacy. **Private** leagues
never surface as opponents to non-members. You must own or admin the side
you challenge from. Privacy is **discovery-only**: changing a league's
privacy after a battle exists never retracts or alters it: a battle's
identity freezes at proposal and it runs to resolution; tightening
privacy just removes the league from future challenge search.

**The invite code is the only way into a league, Open or Private.** No
read returns a league's code except to its own members (`listMyLeagues`),
who share it: the satellite keeps codes in the controllers-only
`league_invites` collection, never on the public league doc, and adds a
member only through `joinLeagueByInvite` once the code checks out. A new
league gets a ten-character code on both stacks; a league founded with
the older six-character code keeps it and stays joinable. Looking a code up and
joining with one need a signed-in account, and on the satellite an
account that has tried `LEAGUE_INVITE_MISSES_PER_HOUR` codes within the
hour that opened no league is refused every code, a right one included,
until its oldest miss is an hour old (the web2 API bounds the same calls
with its own per-account rate limit).

**The score is each league's prediction accuracy over the window, and
nobody types it.** Each side's score is its **current members'**
settled-call win rate inside the battle window, read from the clearing
canister's settlement history: every settled position a side's members
held in `[kickoff, settle)`, scoped to the battle's category (`'all'`, or
a single **macro** category whose series the satellite resolves from
market metadata): `accuracy = wins / settled`, as a percentage, where a **win**
is a net-positive settlement. Higher accuracy wins; an equal-accuracy tie
breaks toward the side with **more** settled calls; a remaining tie, or
both sides settling nothing in the window (a **void** face-off), is a
draw. This is the same win/total metric the leaderboard uses, so a battle
and the leaderboard tell the same story. Because Juno has no scheduler, a
settled battle resolves **lazily**: the first time a member of either
side opens the battle after the window closes. Reading from real
settlement history means a battle accepted before kickoff baselines
existed resolves exactly like any other; there is **no separate
legacy-restart path**, and a long-overdue battle no longer hangs in
`Finalizing…`. Resolution is **controller-trusted**: an assert cannot make
the inter-canister call to re-derive the figure, so a controller-only
satellite endpoint reads clearing, computes the scoreline, and writes the
resolved doc as a controller: the `battles` assert accepts an
`in_flight → resolved` league write **only from a controller** and checks
it is internally consistent, so no client can post a fabricated result.
**Known limitations (by design):** membership is read at resolve time, so
a member who joined or left mid-window is scored by their current
membership rather than their membership when each call settled; and the
optional VXP **amount** is displayed only, not yet moved between
leagues on resolution. Decision records:
[`specs/2026-06-15-feat-battle-auto-resolution.md`](./spec-driven-development/specs/2026-06-15-feat-battle-auto-resolution.md),
[`specs/2026-06-26-impr-battle-resolution-from-settled-history.md`](./spec-driven-development/specs/2026-06-26-impr-battle-resolution-from-settled-history.md).

### Flow daily swipe cap: server-authoritative

The Flow daily cap (15 swipes/day, the daily-ten goal plus the +5
Push-to-15 overtime) is counted on the **satellite**, not the client. A
committed swipe calls `recordFlowSwipe`, sending only the client's local
day key (`YYYY-MM-DD`); the server reads the caller's own profile, rolls
over by that key, and writes the capped increment **itself**: the client
never sends a count, so it can't reset or inflate the total. The count
is server-owned outright: on the satellite `recordFlowSwipe` writes it
signing as a controller, and the `profiles` assert rejects any client write
that changes the stored count or day; on the web2 API a profile write keeps
the stored count and day, and only `POST /profiles/flow-swipe` moves them.
The result: the "come back tomorrow" takeover holds across reloads, cleared
storage, sign-outs, and device switches, losing the localStorage mirror
(now only an offline hint that can never raise the count above the server
value) no longer hands a fresh allotment. **Known limitation (by
design):** Flow orders go from the client straight to the agnostic
clearing engine, so this fixes the reported honest-client reset leak, not
adversarial bypass: a crafted client that skips the satellite call (or
forges a different day key) could still place an order. Closing that would
require routing orders through the satellite or an engine-side limit, a
separate larger change. Decision record:
[`specs/2026-06-15-fix-flow-daily-cap-server-authoritative.md`](./spec-driven-development/specs/2026-06-15-fix-flow-daily-cap-server-authoritative.md).

### Flow earn surfaces: milestone and overtime VXP are credited for real

Two Flow grants now credit real VXP, not just a display number. Crossing a
lifetime call-count milestone (10 / 100 / 500 / 1000 → 50 / 100 / 250 / 500
VXP) pays once each ever; reaching the daily hard cap ("overtime") pays 25
VXP once per local day. Both mint through the existing `vxp_awards`
pending→paid path: the milestone from a `profiles` hook off the lifetime
call count, the overtime inline in `recordFlowSwipe` (its counter write
fires no hook). The lifetime call count is client-trusted, the same model
as the streak and Worlds-podium awards; the daily count behind the overtime
is the satellite's own (only recorded swipes move it), and the day key is
client-set, so the overtime mint carries a rolling-window cap to bound
farming. Earlier these grants were display-only by design (the
"deflation-safe economy pass" deliberately withheld the credit); this is the
deferred real-credit path. Decision record:
[`specs/2026-06-20-feat-flow-milestone-overtime-vxp-credit.md`](./spec-driven-development/specs/2026-06-20-feat-flow-milestone-overtime-vxp-credit.md).

### Signed-out landing: the deck, Markets and the handle claim

A signed-out visitor on `/` gets the landing page; a signed-in session is
sent on to Flow, and `/about` and `/welcome` redirect to `/`. The first
view is a deck of up to three curated markets as fullscreen film cards
(Yes / No / Pass, tap for the rule); a `/?m=` link opens it on the market
the link names. After three calls the last card floats into **Markets**,
every open market at its live price, also one tap away on the top bar's
switch. A call on the landing places no order: it is kept on the device
(the latest ten, a week at most) for the handle claim. "Claim your
@handle" lives in the top bar only and opens the capsule (handle, email, code); a Yes /
No in Markets opens it too, with a line naming the call. **The waitlist
behind the email and code steps does not exist yet: the capsule checks
the handle for real and then refuses to send a code**, so no handle is
ever shown as held. When no curated market is open and priced the landing
opens on Markets alone. An existing account signs in through the "Sign in" link (top bar on wide
screens, footer everywhere). In Markets the curated markets keep their
film stills. Design contract:
[`design.md` § 6](./frontend/design.md#6-landing-page).

### Handle waitlist: reserve a handle with a verified email

Spec: [`2026-11-27-feat-handle-waitlist.md`](./spec-driven-development/specs/2026-11-27-feat-handle-waitlist.md) (W1).

A signed-out visitor reserves a handle by giving it, an email, and the
6-digit code sent to that email. From the confirmation the handle is held
for that mailbox: nobody else can reserve it or take it in the app (both
handle probes, onboarding, the handle editor and the profile write read it
as taken), and it is also held for the ten minutes a code is live. No
account, session, profile or VXP is created, and nobody plays before
admission. One handle per mailbox: confirming another one releases the
first. `name+tag@` and dotted Gmail variants are one mailbox, and known
disposable-mail domains are refused with their own answer.

Every address gets the same answer. A mailbox that already signs in to a
vici.app account, or belongs to a legacy vici.market account, gets no code
and no reservation, only a private email (sign in here; your account moves
on its own). The code, the receipt ("@handle is yours, you're on the
waitlist"), those two notices and the removal confirmation are written in
the language the visitor used. Every email to a reservation carries a link
that removes it without signing in; the link opens a page, and only its
button deletes. A reservation stores the address, the handle, the
language, when the consent sentence was accepted and which privacy policy
version it linked; never an IP or the code. An unconfirmed one is deleted
a day after its last code request, a confirmed one is held twelve months.
A returning visitor's handle is read back from the server with a private
token the browser keeps.

### Legacy app: new accounts move to vici.app

The legacy build (vici.market) no longer creates accounts. Every sign-up
entry ("Create account" on the sign-in screen, invite and
league links, `?ref=` share links) lands on `/signup`, which shows "VICI has
moved to vici.app" with a link to the new app that keeps any invite or
referral code, plus a "Sign in" link for existing accounts. A sign-in that
resolves to an identity with no profile is signed straight back out and shown
the same message; nothing is written for it. The satellite refuses to create
a profile too (switchable, see the satellite patterns page). Existing
accounts sign in and play exactly as before, and the "move your account"
banner and Settings row stay hidden until the cutover switch
(`CLAIM_HANDOFF_ENABLED`) is flipped. Until that flip, signed-in users see a
dismissible notice instead: VICI is moving to vici.app, their account,
predictions and VXP will be moved for them, keep playing here, and vici.market
stays available until the end of September 2027. It has no move action and
gives way to the "move your account" banner at cutover. The new app's own
sign-up is unchanged.

At the cutover the legacy build is replaced by its shut-down form: every
vici.market route shows "VICI has moved to vici.app" (the site is closed,
the account, predictions and VXP are on vici.app) and sends the visitor to
the same page there, with a link as a fallback. The satellite accepts no
user write from then on. How and when:
[`cutover.md`](../../.agents/workflows/cutover.md).

### Handles: one rule

Every handle picked or changed on vici.app (onboarding, the handle editor,
the landing claim, the API) is lowercase `a` to `z` and `0` to `9`, 3 to 15
characters. The field cleans the input as it is typed: capitals become
lowercase, accents drop to the base letter, a few letters with no accent are
spelled plainly (`ß` as `ss`, `ø` as `o`, `þ` as `th`), anything else
disappears, and a line under the field says "Lowercase letters and numbers".

A handle is "taken" when another account holds the same letters and digits
once case, accents and `.` `_` `-` are ignored, so `antonio.ventilii` and a
new `antonioventilii` can never coexist. The handles only VICI may use
(`RESERVED_HANDLES`) are refused by the server too. An account that signs in
without picking a handle gets its display name cleaned to the rule, or a
Roman suggestion plus two digits (`seneca42`), never its account id.

A handle that predates the rule keeps saving as long as it is left as it is.
Tidying it to the rule (`José` to `jose`) is free: it does not use the one
change every 30 days. vici.market (the satellite) keeps its own wider rule.

### Onboarding: one screen, claim a handle and sign up

The new-user flow is a single screen (`Onboarding`, in
`src/lib/components/onboarding/`): the user claims a handle (live
availability check with a Roman-pool suggestion as the empty-field
placeholder) and signs up with any enabled provider on one surface,
anchored by the "1,500 VXP starter pack" reward chip. Team selection is
deferred to the post-signup Profile, so the onboarding handoff always
carries a `null` team/side; the first prediction now happens free in the
app. The screen also links to `/signin` ("Already a member?") and offers a
"Skip · preview first, sign up later" escape into the signed-out Flow
preview. This is the only onboarding flow: there is no flag and no
earlier variant to fall back to. A handle held on the waitlist, or pending
behind another visitor's live code, reads as taken here like any other.

The screen reuses, rather than re-implements, the handle machinery (live
availability probe, session-taken cache, claim-time re-check), the
provider stack, and the starter-VXP source; analytics reuse the existing
taxonomy: `onboarding_started` fires, `handle_checked` carries the
refusal reason (`taken`, `reserved`, ...) in `label` when `ok` is false,
and `onboarding_completed` still fires once via the drain
with `ok` (team-picked) `false`.

### Guest mode: preview Flow free, convert with a starter grant

A visitor who takes the "Skip · preview first, sign up later" path out of
onboarding becomes a **guest**: they reach Flow and predict immediately
with no account, no balance, and no wall, and they keep previewing freely;
there is no hard block at the second pick or ever. Guest picks are a
throwaway, in-session preview: a guest pick never reaches the engine
(`placeOrder` and the identity call are bypassed entirely), so free guest
play can't move market prices. Each pick is recorded only as a client-side
preview entry (`marketId` / `side` / `ts`, no amount) in `localStorage`,
purely to power the conversion nudges.

Conversion is driven by loss-aversion, not a gate: a soft sheet on the
first pick and a remind sheet every fifth pick after offer to **create an
account, claim the 1,500 VXP starter grant, and start predicting for
real**, never to "save your pick". A standing inline pill on Flow opens
the same ask whenever the guest has at least one pick. The remind nudge
references the in-session count as social proof only ("you've made N
predictions"), pluralised, and never implies those picks carry over. Every
surface is dismissible and none blocks a card; the sheet waits until no
menagerie reveal or Flow beat is on screen before it renders, the same
collision gate the achievement host uses. The 1,500 VXP figure comes from
the registration milestone grant, not a literal.

On sign-up from the funnel the guest becomes a member through the **normal
new-member path**: the existing `onProfileSetForVxpOnboarding` grant fires
(no new mint, no retroactive call, no new economic action), the in-session
preview picks are **discarded**, the portfolio starts empty, and the
guest session and preview `localStorage` are cleared. The sign-up CTAs
reuse the real provider stack (redirect-safe) labelled with the claimed
guest handle, and the pre-auth handoff carries only the handle/identity,
never picks or commits VXP. A "1,500 VXP added" toast confirms the grant.
Because guest picks are client-only, a cleared browser simply loses the
preview, which is harmless: nothing was ever a position. Analytics reuse
existing names: a guest pick emits `position_taken` with
`source: 'guest_flow'`, each conversion ask emits `onboarding_step` with
`source: 'guest_flow'` and the surface as `label`, and conversion emits
`signed_up` with `source: 'guest_convert'`. Conversion widens the
new-account mint surface (a brand-new account can be created after a
frictionless preview) but keeps it no wider than the existing grant; the
anti-farm hardening tracked in #543 bounds that surface and is not changed
here. Decision record:
[`specs/2026-06-25-feat-guest-mode.md`](./spec-driven-development/specs/2026-06-25-feat-guest-mode.md).

### Onboarding: picks persist across every sign-in provider

A new user's onboarding picks, handle and the completion flag (plus
backed team/side when an older multi-beat path supplies them), land on
the new profile no matter which sign-in provider finishes the flow. The
picks are stashed to local storage the moment an available handle is
claimed (the auth gate), **before** any provider runs, so a full-page
OAuth redirect (Google) can't carry off the volatile in-flight state:
the post-sign-in drain reads the stash and applies it. The "is this a
brand-new account?" decision the drain uses to
avoid overwriting a returning user's saved profile is anchored to whether
this browser session bootstrapped the profile, not a reactive flag a
second auth pass could flip, so a genuine new user's picks are never
dropped, and a genuine returning user's profile is never clobbered. The
flow emits the `onboarding_completed` analytics event with the finishing
provider and whether a team was persisted. Decision record:
[`specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md`](./spec-driven-development/specs/2026-06-18-fix-onboarding-picks-persist-across-providers.md).

### Onboarding: in-flow gesture coach

The first time an early user meets the prediction card on the Flow deck, a
non-blocking gesture map overlays the live card: a centered cross showing
YES (right) / NO (left) / SKIP (up) / tap (detail), with YES-NO weighted as
the primary actions. It does not hijack the card: the card underneath stays
fully readable and swipeable, and only the "Got it" opt-out captures pointer
events. The coach teaches by doing: it dismisses on the user's first real
call (a committed YES or NO) with a brief confirmation, or immediately via
the "Got it" opt-out. It is shown at most once per device
(`vici.coach-flow-seen`), identity-scoped like the other onboarding flags so
a new account on the device re-sees it. This is layer 1 of the first-run
tutorial system, distinct from the layer-2 surface tips below. Decision
record:
[`specs/2026-06-28-impr-flow-coach-learn-by-doing.md`](./spec-driven-development/specs/2026-06-28-impr-flow-coach-learn-by-doing.md).

### Onboarding: first-visit surface tips

The first time an early user lands on Dash, Arena, or Profile, a single
small, non-blocking tip slides in just above the floating tab bar
explaining what that surface is for, then dismisses with its `X` button.
Nothing fires up front: a tip only appears when the user actually
navigates to that surface (progressive disclosure, not an up-front tour),
one tip is ever on screen at a time, and each surface shows its tip at most
once per device. The Profile tip does double duty: it nudges picking a
team for the Worlds race. This is layer 2 of the first-run tutorial system,
distinct from the in-flow gesture coach (`FlowCoach`, layer 1). Only early
users see tips: an established user (`totalTrades >= 5`) is never
interrupted. Seen-state is per-surface local storage (`vici.tip-*-seen`),
identity-scoped like the coach flags, so a new account on the device
re-sees the tips. Shown and dismissed both emit `onboarding_step`
(`source: 'surface_tip' | 'surface_tip_dismiss'`, `label` = the surface).
Decision record:
[`specs/2026-06-25-feat-onboarding-surface-tips.md`](./spec-driven-development/specs/2026-06-25-feat-onboarding-surface-tips.md).

### Sign-in: one V3 visual family, Google + passkey-backed email

The returning-user sign-in (`/signin` and every "sign in to continue"
modal) shares the V3 onboarding visual system: brand pinned top, a
`Welcome back.` hero (sans phrase + one serif-italic accent word, mirroring
the sign-up `Claim your handle.` headline), the auth cluster directly
below, and the "create account" cross-link + legal anchored to the bottom
of the frame behind a hairline divider. The only primary providers are a
**dark Google pill** and a lighter **email pill**; the email path opens an
inline input and runs a device-passkey (WebAuthn) ceremony; there is no
magic link and no "we sent you a link" state. **Apple is no longer
offered**: returning V3 users never created an account with it, so it was
removed from the provider stack (the code stays dormant behind a flag).
Internet Identity, standalone passkey, and the dev shortcut remain
production-/dev-gated as before. A successful sign-in emits the `signed_in`
analytics event with `source = signin_screen` and a `label` of the chosen
provider (`google | email | passkey | ii | dev`); the email address is
never sent. Decision record:
[`specs/2026-06-25-impr-signin-v3-reskin.md`](./spec-driven-development/specs/2026-06-25-impr-signin-v3-reskin.md).

### Add to Home Screen: install VICI as an app

A mobile user can add VICI to their home screen so it launches
full-screen, like a native app. The ask appears in two calm,
non-interruptive places and **never** as an auto-popup over Flow: a
permanent **Settings → Preferences** row and a contextual **install row on
the end-of-session summary** (`FlowEnd`). The install sheet adapts to the
platform: on Android/Chrome it captures the browser's `beforeinstallprompt`
(suppressing the mini-infobar) and a single CTA replays it as the native
one-tap install dialog; on iOS, where no install API exists, it shows the
two manual steps (tap Share, then choose Add to Home Screen). Once
installed (the native accept, the `appinstalled` event, or a later launch
detected as standalone) every prompt is suppressed.

Both surfaces are gated on `canInstall` (mobile, not already installed, not
already running standalone), so they are hidden on desktop and inside an
installed PWA. The Settings row is always available when `canInstall`
holds; the FlowEnd row additionally honours trigger thresholds: it appears
at a lifetime call count of 15 or more, or 10 or more on a second-or-later
visit, and respects a 14-day cool-off after a dismissal plus a
once-per-session guard. The install funnel is instrumented with
`pwa_install_prompted` / `_accepted` / `_dismissed`, carrying the
originating surface and the platform. The manifest, icons, iOS meta, and
the pre-paint standalone/iOS detection in `app.html` were already shipped;
this layer adds only the install behaviour. Decision record:
[`specs/2026-06-25-feat-pwa-install.md`](./spec-driven-development/specs/2026-06-25-feat-pwa-install.md).

### Discoverability: search snippets & the guest Flow funnel

VICI is a static SPA, so its search presence is generated **at deploy
time** (see [`frontend/seo.md`](./frontend/seo.md)). Search intent lands on
**existing pages, not new ones**: a specific market → its detail page
(`/m/{slug}` resolves there), category browsing → the in-app `/app` board.
On top of one crawlable page per market, the deploy emits schema.org
**JSON-LD** (site-wide `Organization` + `WebSite`, plus a per-market
`WebPage` + `BreadcrumbList`) and a **live-probability sentence** baked into each
market's meta description ("Community odds: Yes 41%", a deploy-time
snapshot of the order book). The phrase "prediction market" appears **only**
in this crawler-facing metadata (titles, descriptions, structured data),
never in the rendered product UI, which continues to say "Social Markets".

A signed-out visitor who lands on a **live** market page gets a **"Try Flow
free"** CTA (predictions are placed in Flow, not on the detail page): it
starts a free guest session and drops them into the Flow swipe deck with no
account, the same guest preview the onboarding Skip path uses. Signed-in
members see "Predict in Flow" instead. Decision record:
[`specs/2026-07-14-impr-seo-rich-snippets-topic-pages.md`](./spec-driven-development/specs/2026-07-14-impr-seo-rich-snippets-topic-pages.md).

### Market categories: three-layer taxonomy

Markets are classified in three layers: a **macro** category (7: Politics,
World, Economy, Crypto, Tech, Culture, Sports), a **micro** subcategory (127,
each belonging to one macro, e.g. Crypto → Bitcoin, Sports → Soccer), and
optional free **tags** (event/entity level, e.g. `world-cup`, `bitcoin-etf`).
A market carries one or more micros: the first is its **primary** (driving
card accent, artwork, detail chip, and category stats); its macros are
derived. The markets board shows a macro bar with micro sub-chips, and a chip
appears **only** when at least one live market populates it, so the taxonomy
can define categories long before markets grow into them. Category accents
come from the macro; per-user "category" accuracy stats and battle scopes are
keyed by macro. Decision record:
[`specs/2026-07-22-feat-market-taxonomy.md`](./spec-driven-development/specs/2026-07-22-feat-market-taxonomy.md).

### Call sizing: one slider, a range in steps, the net win everywhere

On the ViciXP domain a call is sized with **one slider** on every surface that
sizes one (the Flow card back, the market detail sheet): any multiple of `VXP_CALL_SIZE_STEP` from `VXP_MIN_CALL_SIZE` to
`VXP_MAX_CALL_SIZE` (values in
[`vxp-economy.constants.ts`](../../src/lib/constants/vxp-economy.constants.ts)),
with no preset buttons. Arrow keys move one step and Home / End jump to the
bounds; at the maximum the control turns to its cap state. Flow opens at the
stored size, the market detail sheet at `VXP_DEFAULT_CALL_SIZE`; a size stored
under the earlier, wider sizes is clamped into the range when it is read (a
size above the maximum opens at the maximum; nothing is migrated). Every payout
preview, the Flow card front included, is the **net win** from `vxpNetWin` at
the execution price, floored by `VXP_P_WIN_FLOOR` and shown as `<1` below one
VXP; the market detail sheet's "If right" figure is that net win, not the gross
return. Open positions at any earlier size stay as they are. The client refuses
a size outside the set on both builds; the web2 API also refuses one, and an
order whose notional disagrees with its declared size, with
`invalid_call_size`. On the web3 build nothing on-chain bounds the size yet
(see [`economy.md`](./economy.md#caps-and-gates-the-anti-farming-spine)).
Decision record:
[`specs/2026-11-26-impr-vxp-call-size-range.md`](./spec-driven-development/specs/2026-11-26-impr-vxp-call-size-range.md).
