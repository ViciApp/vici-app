# Spec: Challenge links, API

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#1732)

Verified challenge links are specified in five parts, each with its own status and its own implementation PR, because one PR per purpose would not hold all of it:

| Part   | Spec                                                                                               | Stacks on                  |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------- |
| **A1** | this file: data model, routes, inviter credit, answers, server analytics, limits, retention        | nothing (from `main`)      |
| A2     | [`2026-11-26-feat-challenge-links-preview.md`](./2026-11-26-feat-challenge-links-preview.md)       | A1                         |
| A3     | [`2026-11-26-feat-challenge-links-app-action.md`](./2026-11-26-feat-challenge-links-app-action.md) | A1                         |
| A4     | [`2026-11-26-feat-challenge-links-landing.md`](./2026-11-26-feat-challenge-links-landing.md)       | A1 and the landing page PR |
| B      | [`2026-11-26-feat-landing-calls-conversion.md`](./2026-11-26-feat-landing-calls-conversion.md)     | A1, for its last step only |

A2, A3, A4 and B can be built in parallel once A1 is merged. All of them ship with the landing go-live: not before, not after.

## Goal

The API can issue a short, unguessable link for a real prediction by a real user, answer a public read of it with data only the server can vouch for, credit the challenger when a sign-up arrives through it, and record when the invited friend makes their own call. No field a client sends can set who called what: the only input on the receiving side is the id.

## Context

**How a prediction exists on the server.** The API stores no "prediction" row. A call is a set of executed fills in the engine, placed through the session-gated order routes in `backend/src/routes/engine.ts` and composed client-side by `placeOrder` in `src/lib/services/order.services.ts` (a market order walks several book levels, so one call can be several fills). The server-side truth for "what does this user hold on this series, and at what price" already exists: `heldBinaryPosition({ events, seriesId })` in `backend/src/vxp/predictions.ts`, fed by `getTradeHistory({ userId })` in `backend/src/engine/clearing.ts`. It returns the held side and the average entry price of the contracts still held, ignores self-matched trades, and is what the engine-verified awards trust. A challenge link binds to that.

**Referral machinery to reuse.**

- `backend/src/account/referrals.ts`: `redeemReferralCode` (one redemption per referee ever, signup window `REFERRAL_SIGNUP_WINDOW_MS`, no self-redeem, award-marker check for a re-registered identity), `claimReferralFriendship`, `writeConfirmedFriendship`, `getOrAssignReferralCode`, and the code generator over `REFERRAL_CODE_ALPHABET` (Crockford base32).
- `backend/src/vxp/referral.ts`: `settleReferralPayout` pays both sides on the referee's first executed prediction, idempotent on the award key `referral/<refereeUserId>`; the `referrals` table (migration `0006_vxp_economy.sql`) has `referee_user_id` as primary key.
- `backend/src/routes/referrals.ts`: the public `/lookup` is limited per IP with `enforceLimit` (`backend/src/lib/rate-limit.ts`) and `clientIp` (`backend/src/lib/http.ts`).

**Triggers.** `runTradeActivityTriggers` (`backend/src/vxp/triggers.ts`) loads the caller's full engine trade history on every trade activity the client posts.

**Privacy inputs.** `isPubliclyHidden` and `PUBLICLY_VISIBLE_PROFILE_SQL` in `backend/src/profiles/profile.ts` hide soft-deleted and hibernated accounts from every public read. `profiles.visibility` and `preferences.sharing.callsPublic` are the profile-level sharing settings. `hardDeleteAccount` in `backend/src/account/lifecycle.ts` lists the tables an account's deletion clears.

**Server analytics.** `captureServerEvents` in `backend/src/analytics/events.ts` records events the server vouches for; their names are listed in `SERVER_ANALYTICS_EVENT_NAMES` (`src/lib/types/analytics-event.ts`) and mirrored in `backend/src/analytics/taxonomy.ts`.

**Backends.** The feature is API-only. Verified against the code: it needs server-side custody of the engine identity (to read a user's trade history authoritatively) and a sign-up to convert into, and the legacy on-chain build has neither (`areNewSignupsMoved` in `src/lib/services/new-app-redirect.services.ts`; "Legacy app: new accounts move to vici.app" in `PRODUCT.md`). **Satellite impact:** no collection, hook or endpoint change. The one satellite-adjacent file touched is `src/lib/schema/analytics-event.schema.ts` (imported by `src/satellite/index.ts`) for the new event names, which triggers `npm run juno:functions:build` (the generated `satellite_extension.did` and declarations gain the three names in the analytics variants, nothing else) and the vendored declaration copy (AGENTS.md rule 9).

## Scope

### 1. The link

- **One link per (user, series), holding the challenger's current state.** A link is bound to a user and a series, and the server keeps on it the position that user holds now: side, side-framed entry price of the held contracts, and the engine timestamp of the fill that opened the held run. It also keeps the side held when the link was created, so a reader can be told the challenger changed their mind.
- **Creation** (`POST /api/v1/challenges`, session) takes the series id and the consent flag only. The server reads the caller's trade history from the engine and computes the held position. It refuses with `no_position` when the caller holds nothing on that series, `market_closed` when the series is past expiry or settled, `unknown_series` when the registry has no such series or the series was not created by the Vici engine (`eng_0`), and `unsupported_series` for a non-binary series. Any market the caller holds a binary position on can be challenged.
- **Idempotent:** creating again for a series with an active link returns that link (same id), refreshed with the current position and the consent flag just sent. A partial unique index enforces it.
- **Id:** 16 characters of Crockford base32 from `crypto.randomInt`, the generator shape of `generateReferralCode`: 80 bits. It carries no user id, handle or series id. Input is normalised to uppercase; anything not matching the pattern reads as not found without touching the database.
- **Consent, per link.** `show_identity` is set by the challenger when sharing (A3 asks explicitly, default on) and can be changed later (`PATCH /api/v1/challenges/:id`). With consent the public read carries the handle and avatar together with the side and price, **whatever the profile's own visibility or `callsPublic` setting says**: this link is the owner's explicit, revocable decision about this one call. Without consent the read carries no identity, and the receiving page says "A friend called ...".
- **Revocation** (`DELETE /api/v1/challenges/:id`, owner): the link reads as not found from then on. A later create for the same series issues a new id.

### 2. Keeping the state current

- `runTradeActivityTriggers` gains one step that reuses the events it already loaded to refresh the caller's active links: side, entry price and time are rewritten from `heldBinaryPosition`; a flat position clears them (the link stays active with no position).
- Creation refreshes too. There is no engine call on the public read.
- Market state (open, or closed for predictions: past expiry or settled) is computed on read from the cached registry series and settlement status, with no write.

### 3. Public read

`GET /api/v1/challenges/:id` (no session, limited per IP) answers:

- `seriesId`;
- `position`: `{ side, entryPriceBps, calledAtMs }` or `null` when the challenger holds nothing now;
- `sideChanged`: whether the current side differs from the side at creation;
- `challenger`: `{ handle, avatar, avatarParts }` when consent is on, otherwise `null`;
- `marketOpen`.

It never carries the account id, an email, a balance or a call size. A revoked, unknown or pruned link, and a link whose challenger is soft-deleted or hibernated, all answer the same `404 challenge_not_found`, so the endpoint is no oracle for "this id existed" or "this account was deleted". A soft-deleted account's links work again if it is recovered.

The wording for each state belongs to the readers (A2 for the preview, A4 for the page); this spec only guarantees the data.

### 4. Inviter credit

- **A challenge link is a referral channel, not a new earn surface.** `POST /api/v1/challenges/:id/redeem` (session) writes the same single `referrals` row a referral code writes, with the challenger as referrer and a new nullable `challenge_id` column naming the link. No new award type, no challenge-specific VXP.
- **No double pay, by construction.** `referrals.referee_user_id` is the primary key, so a person is credited to one inviter ever, across every channel (invite link, league invite, market share `?ref=`, challenge link). The payout is unchanged: `settleReferralPayout` on the referee's first executed prediction, the flat referee bonus and the referrer's diminishing, capped reward, both idempotent on `referral/<refereeUserId>`. Amounts stay in `src/lib/constants/referral.constants.ts`. If two redemptions race, the first written row stands (`on conflict (referee_user_id) do nothing ... returning`): only the winner writes the friendship and answers `redeemed`; the loser writes nothing and answers `not_eligible` (a referral code that loses the race answers the usual already-redeemed refusal). Which link a browser redeems when it saw several is A4's rule (last touch).
- The route applies the rules of `redeemReferralCode` through shared helpers (signup window, no self, one per referee, award-marker check). A redeemed sign-up gets the confirmed friendship every referral redemption writes (`writeConfirmedFriendship`). An account past the window or already referred is not an error: the route answers `{ outcome: 'not_eligible' }` and writes nothing, so an existing account is never befriended by opening a link. A caller with no profile yet answers `400 profile_required`, which is retryable (the referral route keeps the same distinction), so a redeem that races the profile write does not lose the credit. Redeeming one's own link answers `400 self_challenge`. Sign-up through a link is credit, never an "answer".
- A link with no current position, or on a closed market, still credits. A not-found link credits nobody.

### 5. Answers

- **An answer is a real call on the challenged market, verified in the engine.** `POST /api/v1/challenges/:id/answer` (session) recomputes the caller's held position on the link's series from their trade history and stores side and entry price. It refuses `no_position` when they hold nothing there and `self_challenge` for the link's owner. One answer per (link, user), idempotent: a repeat returns the stored answer unchanged, checked before the position is required, so it still answers after the caller closed or flipped that position; a conflict-safe insert settles two concurrent first answers.
- **Auto-friend on answer, never on open.** Recording an answer writes a confirmed friendship between challenger and answerer through `writeConfirmedFriendship` (never downgrades an existing relation). Opening or reading a link writes nothing. This is the only way an existing account becomes the challenger's friend through a link.
- `GET /api/v1/challenges/answers` (session) lists answers to the caller's links, newest first, bounded, each with the challenge id, the answerer's handle and avatar (the two are friends by then), side, price, time, series and the caller's own current position on that link: the source of the challenger's inbox card (A3). Answers from soft-deleted or hibernated accounts are left out.
- `GET /api/v1/challenges/mine` (session) lists the caller's links with their answer counts.

### 6. Abuse and privacy

- **No Turnstile on any challenge endpoint.** The rationale, per risk:
  - _Creation_ is authenticated, needs a real engine position on that series, yields at most one active link per (user, series), and is limited per account. A scripted account cannot mint links faster than it can open real positions.
  - _Reads_ are limited per IP and addressed by an 80-bit random id: at one million live links a guess hits with probability about 1e-18, so enumeration is infeasible at any rate the limiter allows. A Turnstile check on the read would also block the first paint and every preview crawler.
  - _Redeem and answer_ are authenticated, limited per account and bounded by one row per referee and one per (link, user).
  - There is no unauthenticated write. Opens are counted by the client through the analytics ingest, which has its own limits.
  - The sign-up a challenge funnels into is protected by the Turnstile verification that a separate PR adds to the public sign-up surface: that is where a farm of invitees is stopped.
- **Rate limits** are named constants at the top of `backend/src/routes/challenges.ts` with windows from `backend/src/lib/time.ts`: the public read per IP (budget sized like `REFERRAL_LOOKUP_LIMIT_PER_HOUR`, for a class on one network opening one link); create, patch, redeem and answer per account (`ip: user.id`, the documented pattern for signed-in endpoints that fan out an engine read). Revoke and the two owner lists are session-gated, cheap and bounded, and carry no limit of their own.
- **No PII in links or responses** beyond the handle and avatar the owner consented to show.

### 7. Lifecycle and retention

- **Hard delete** of an account: `hardDeleteAccount` deletes its links (answers cascade) and the answers it gave. Referral history keeps following the existing rules ("Privacy: what survives an account's deletion" in `PRODUCT.md`); `referrals.challenge_id` is plain text with no foreign key, so pruning links never touches it.
- **Retention: 90 days.** A worker job deletes a link, with its answers, 90 days after its market closed or after it was revoked (`CHALLENGE_LINK_RETENTION_MS`). A pruned link reads as not found.

### 8. Client transport

So the parts that stack on this one do not each edit the same files, this PR also adds the thin transport, with no UI: typed wrappers in `src/lib/api-client/client.ts`; `src/lib/services/challenge.services.ts` exposing the calls plus `areChallengeLinksEnabled()` (components never branch on the backend themselves), with `getChallenge` answering `undefined` for any link that cannot be read; `src/lib/types/challenge.ts`; `src/lib/constants/challenge.constants.ts` (id pattern, mirrored with the API and pinned by a shared-drift test); `parseChallengeId` in `src/lib/utils/challenge.utils.ts` (the API's normalisation, so a malformed id costs no request; A3 and A4 add their helpers to the same file); and the three analytics names in the taxonomy.

### Out of scope

- The head fragment endpoint and everything nginx: A2.
- Any UI: the action and share sheet (A3), the receiving page (A4), the inbox card (A3).
- Turning landing taps into predictions: B.
- The Turnstile service itself: separate PR.
- Push or email notifications.
- Non-binary series (`heldBinaryPosition` is binary only).
- Any change to referral amounts, the curve, the cap or the signup window.
- A composited per-challenge image. Not planned; at most a future idea.

## Linked issues

Searched at implementation time (open issues, through the REST search API): "challenge" finds none; "share link" and "referral" find only #543 (anti-farm: gate referral and onboarding payouts on an authoritative trade). This spec neither changes nor closes it: a challenge redemption is paid by the same first-prediction settlement, which already reads the engine. No closing keyword.

## Analytics

Instrument. This PR adds three names to the taxonomy in all three places (`src/lib/types/analytics-event.ts`, `src/lib/schema/analytics-event.schema.ts`, `backend/src/analytics/taxonomy.ts`, the last pinned by `backend/tests/shared-drift/`) and records the two the server vouches for:

| Event                | Recorded by                                                             | Props                                                                                     |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `challenge_created`  | server (`captureServerEvents`), added to `SERVER_ANALYTICS_EVENT_NAMES` | `marketId`, `label` (`new` \| `existing`), `ok` (consent to show identity)                |
| `challenge_answered` | server, added to `SERVER_ANALYTICS_EVENT_NAMES`                         | `marketId`, `label` (`same_side` \| `opposite_side`), `source` (`referred` \| `existing`) |
| `challenge_opened`   | client, in A4 (name added here so the parallel parts do not collide)    | defined in A4                                                                             |

A credited sign-up reuses `referral_redeemed` with `source: 'challenge'` (client, A4). The challenge id is never an event prop (it is a bearer link), and no handle is sent.

## Technical requirements (satellite / backend: mandatory)

**Satellite:** not touched beyond the schema regeneration named in Context.

- **Data model** (one forward-only migration, `backend/src/db/migrations/0026_challenge_links.sql`, or the next free number at build time):
  - `challenge_links`: `id text primary key` (checked against the id pattern), `challenger_user_id uuid not null references users (id) on delete cascade`, `series_id text not null`, `series_expiry_ms bigint not null` (the registry expiry, part of the series id and immutable, so the market-state test and the prune need no registry read), `created_side text not null check (created_side in ('YES','NO'))`, `side text check (side in ('YES','NO'))`, `entry_price_bps int check (entry_price_bps between 1 and 9999)` (side-framed probability, rounded from the engine's fixed-point price so no float is stored), `called_at_ms bigint` (the three current-position columns are null together when the position is flat, enforced by a check), `show_identity boolean not null default true`, `status text not null default 'active' check (status in ('active','revoked'))`, `status_changed_at_ms bigint` (set exactly when revoked, enforced by a check), `market_closed_at_ms bigint` (stamped by the prune job the first time it sees the market past expiry or settled: the start of the retention window), `position_synced_at_ms bigint not null`, `created_at_ms bigint not null`. A partial unique index on `(challenger_user_id, series_id) where status = 'active'`; an index on `(challenger_user_id, created_at_ms desc)`; four partial indexes for the prune's scans (open markets by expiry and by series, closed markets by close time, revoked links by revocation time).
  - `challenge_answers`: `challenge_id text not null references challenge_links (id) on delete cascade`, `answerer_user_id uuid not null references users (id) on delete cascade`, `side`, `entry_price_bps`, `answered_at_ms bigint not null`, primary key `(challenge_id, answerer_user_id)`, and an index on `answerer_user_id` for the hard delete.
  - `alter table referrals add column if not exists challenge_id text`: null for every existing row and every non-challenge redemption; the previous release keeps working against it.
- **Performance.** Public read: one primary-key select joined to `profiles`, plus the registry series from `cached(...)` (`backend/src/engine/cache.ts`, `PUBLIC_READ_TTL_MS`); no engine call. Create and answer: one `get_trade_history` engine read each, the same read `runTradeActivityTriggers` makes per trade, bounded by the per-account limits. The state refresh adds one indexed select and at most one update per held series per trade activity, and no engine call.
- **Memory and storage.** A link row is about 250 bytes, an answer about 100. A user has at most one active link per series. At 100,000 users with five links each: about 500,000 rows, on the order of 150 MB with indexes, bounded by the 90-day prune. Rate-limit windows stay in memory per instance (the limitation already noted in `rate-limit.ts`).
- **Scalability.** At 10x and 100x the per-open cost stays one indexed read. `/mine` and `/answers` are bounded lists read with one join, never N+1. The prune job deletes in bounded batches, and its settlement check reads a bounded page of the not-yet-closed series per tick (`CHALLENGE_STAMP_SERIES_PER_TICK`, in series id order), resuming after the last one on the next tick; markets past expiry are stamped in one update with no engine read. The trade trigger groups the history it already loaded by series once, so each history row is read once per trigger whatever the number of links.
- **Upgrade and compatibility.** Additive migration, no rename, not breaking. This is a generated `.did` change: the satellite's `satellite_extension.did` and its declarations gain the three event names (`challenge_created`, `challenge_answered`, `challenge_opened`) in the analytics variants, as every taxonomy addition does, and A1 regenerates them (`npm run juno:functions:build`) and copies the declarations into `backend/src/declarations` in the same PR. Nothing else in the Candid surface changes. New wire codes are contracts: `challenge_not_found`, `no_position`, `market_closed`, `unknown_series`, `unsupported_series`, `self_challenge`, `profile_required`.
- **Security.** Writes pass the existing same-origin guard (`refuseUnsafeRequest`). The account is always the session's; no user id is read from a body. Consent is stored server-side and only its owner can change it.
- **Protected paths touched** (call out in the PR body, per `governance.md`): `backend/src/db/**` (migration), `backend/src/vxp/triggers.ts`, `backend/src/account/**`, and the generated satellite outputs from the schema regeneration.
- **Parameters.** Limits and retention are named constants in the route and domain modules; referral amounts and windows stay in `src/lib/constants/referral.constants.ts` and its API mirror `backend/src/vxp/constants.ts`.

## Implementation outline

1. **Migration** as above, with the why in the header comment.
2. **Position timestamp.** Extend `heldBinaryPosition` to also return `openedAtNs`, the engine timestamp of the fill that opened the held run, without changing its existing fields.
3. **Domain**, split in three files to stay under the 500-line lint cap: `backend/src/social/challenges.ts` (id generation and pattern; `createChallenge`; `getChallengeView`; `setChallengeConsent`; `revokeChallenge`; `listMyChallenges`; typed `ChallengeError` subclasses mapped by the route), `backend/src/social/challenge-answers.ts` (`redeemChallenge`; `recordChallengeAnswer`; `listChallengeAnswers`) and `backend/src/social/challenge-upkeep.ts` (`syncChallengesForUser({ userId, events })`; `pruneChallengeLinks`; `CHALLENGE_LINK_RETENTION_MS`).
4. **Referral sharing.** Split the body of `redeemReferralCode` into two shared helpers in `backend/src/account/referrals.ts`: `referralIneligibility(userId)` (one per referee, award marker, profile, signup window; checked before any referrer is resolved, so the referral route's refusal order and messages stay as they are) and `writeReferralRedemption({ userId, referrerUserId, code, challengeId? })` (the row and the friendship). `redeemChallenge` resolves the link and its challenger, takes the challenger's code from `getOrAssignReferralCode`, and calls them; `writeConfirmedFriendship` is exported and takes a transaction's `q` for the answer.
5. **Routes** `backend/src/routes/challenges.ts` (`challengesRoutes`, prefix `/api/v1/challenges`), mounted in `backend/src/index.ts`.
6. **Triggers and lifecycle.** `syncChallengesForUser` from `runTradeActivityTriggers`; the deletes in `hardDeleteAccount`; a `prune-challenge-links` job in `backend/src/worker.ts`.
7. **Server analytics** and the taxonomy names, with the satellite regeneration.
8. **Client transport** as in Scope 8.
9. **Docs in the same PR:** `PRODUCT.md` (a "Challenge links" entry covering the rules above; the deletion entry), `economy.md` (a challenge link is a referral channel), `backend/README.md` (routes), `frontend/api-client.md` (a new API domain), `backend/reusability.md` for the shared referral helper.

**Tests** (real Postgres, engine through `setEngineActorProvider`, `resetRateLimits` between tests; split by module under the line cap: `backend/tests/challenges.test.ts`, `challenge-answers.test.ts`, `challenge-upkeep.test.ts`, with the fake engine and fixtures in `backend/tests/helpers/challenges.ts`): create needs a position; create is idempotent per series and refreshes the state; no request field can set side or price; a flip rewrites the side and sets `sideChanged`, a flat position clears it, both through the trade trigger; the public read has no account id; consent on shows the handle for a private profile and for `callsPublic: false`; consent off hides it for a public profile; consent can be changed only by the owner; soft-deleted and hibernated challengers read as not found and come back on recovery; revoked equals unknown on the wire; redeem writes one `referrals` row with `challenge_id`, refuses self, and a second redemption through any channel changes nothing; an account past the signup window redeems to `not_eligible` with no row and no friendship; answer is engine-verified, idempotent, refused for the owner, and writes the friendship; hard delete removes links and answers; the prune job removes what is 90 days past and nothing younger; the limits answer 429; malformed ids never reach SQL. One case proves a challenge redemption settles exactly one referee bonus and one referrer reward; it sits in `challenge-answers.test.ts`, because `backend/tests/vxp-referral.test.ts` would pass the 500-line cap with it. Shared drift: the id pattern pair and the analytics taxonomy pair. A pure spec in `src/tests/` for the id pattern helper.

**Rollout.** Additive and unused until a web build calls it, so it can merge and deploy ahead of the other parts without exposing anything. Rollback: the routes and tables can stay.

**Risks**

- **State freshness depends on the trade activity post.** The refresh runs when the client posts its trade activity (the nudge every award trigger already relies on). A call whose activity post fails leaves the link one trade behind until the next trade or the next create. Accepted; the same dependency already holds for the referral settlement.
- **Referral farming through challenge links** is exactly as wide as through invite links: same row, same cap, same curve, same first-prediction gate.
- **Consent overrides the profile setting** for that link only. The owner sees exactly what will be shown before sharing (A3) and can turn it off afterwards.

## Acceptance criteria

- [ ] A user with a binary position on any open market can create a link; without one the API answers `no_position`.
- [ ] Side, price and time on a link come from the engine trade history; no request field sets them.
- [ ] Creating again for the same series returns the same id.
- [ ] After the challenger flips side, the public read carries the new side and price and `sideChanged: true`; after they close the position it carries `position: null`.
- [ ] With consent on, the read carries the handle even for a private profile; with consent off it carries none, even for a public one.
- [ ] Unknown, revoked, pruned and hidden-account links are indistinguishable on the wire.
- [ ] A sign-up redeemed through a link has exactly one `referrals` row naming the challenger and is paid the existing bonuses once, on the first prediction; no other channel can add a second.
- [ ] An answer exists only when the engine shows the caller holds a position on that market, and it makes the two friends; opening a link never does.
- [ ] Hard delete and the 90-day prune remove links and answers.
- [ ] No response contains an account id, an email or a call size.
- [ ] Per-IP and per-account limits answer `429 rate_limited`; no challenge endpoint asks for a Turnstile token.
- [ ] `cd backend && bun run typecheck && bun test`, `npm run quality`, `npm run check` and `npm test` pass.

## Open questions

1. **Open issues.** Answered: see "Linked issues".
2. **Settlement read for `marketOpen`.** Answered: `getSettlementStatus` (`backend/src/engine/clearing.ts`) is the `cached(...)` public read at `PUBLIC_READ_TTL_MS` and keeps a `Finalised` view for good, so a single read costs no uncached engine call; "settled" is any settlement plan for the series. It runs only while the stored expiry is still ahead, so a market past expiry costs no engine read at all. The owner list and the prune read many series at once through `listSettlementStatuses` (one call per 100 series, same cache).

## Decisions

Owner decisions are marked as such.

- **Bind to the held position, not to an order id.** A call can be several fills and the client composes them; the engine history folded by `heldBinaryPosition` is the one figure the server can vouch for.
- **The link shows the challenger's current state** (owner). A changed side is shown as the current side at the current position's price; a closed position leaves nothing to show; a closed market is told in the past tense. The link is therefore a live view of one user on one market, kept current by the trade trigger, not a frozen snapshot.
- **Sharing is consent** (owner). Consent is stored per link, defaults to on in the share sheet, is revocable, and overrides the profile's visibility and `callsPublic` for that link only. Without it the identity is withheld.
- **Any market can be challenged** (owner), as long as the position is binary.
- **"Answered" is a real call on the challenged market, engine-verified** (owner). A sign-up alone is credit.
- **Auto-friend on answer, never on open** (owner).
- **Retention: 90 days** after the market closes or the link becomes inactive, then the prune job deletes the data (owner).
- **Analytics land in the challenge PRs** (owner): server events here, client events in A3 and A4, not in the landing analytics PR.
- **No Turnstile on creation or reads** (owner). The protection is authentication, a real position, one active link per (user, series), a per-user creation limit, a per-IP read limit and 80-bit ids, as argued in Scope 6.
- **One active link per (user, series).** Many links per prediction would split attribution, multiply the rows a spammer can mint, and make "the link I sent" ambiguous.
- **A challenge is a referral channel.** Reusing the `referrals` row makes "no double pay" a primary-key fact instead of a rule to enforce, and keeps the referrer cap and curve authoritative.
- **Split into five specs** (owner): PRs are scoped to one purpose each; the spec is split so each purpose has its own status and PR.
- **API only.** See Context.
- **Store the expiry and the close time on the link** (implementation). The registry expiry is part of the series id, so copying it is safe; with it, the public read of a market past expiry costs no engine read, and retention can count from the close without a registry read per row.
- **Only Vici markets** (implementation). A series another engine created reads as `unknown_series`: the receiving surfaces render Vici markets only.
