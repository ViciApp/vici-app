# Spec: Verified challenge links

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

This is **part A of two**. The work was too large for one reviewable PR, so the spec was split as the workflow asks: this part covers links issued from a real prediction, the receiving end, the link preview, inviter credit and the "friend answered" notification. Part B, [`2026-11-26-feat-landing-calls-conversion.md`](./2026-11-26-feat-landing-calls-conversion.md), covers turning a visitor's landing taps into real predictions at sign-up, and ends by calling the create action defined here. Each part has its own status and its own PR. Both ship with the landing go-live.

## Goal

A signed-in user who holds a real prediction can tap "Challenge a friend" and send a short link, `https://vici.app/c/<id>`. The friend who opens it lands on the signed-out landing page with the challenged market as the first card and a line built from server data: "@handle called Yes at 38%. Think they're wrong?". Messengers show a preview specific to that challenge. If the friend signs up, the challenger is recorded as their inviter through the existing referral machinery, and when the friend makes their own call on that market the challenger gets an inbox card. Nothing on the receiving page can be changed by editing the URL: the only input is an unguessable id, and the user, market, side, entry price and time all come from the server.

## Context

**How a prediction exists on the server.** The web2 API never stores a "prediction" row. A call is a set of executed fills in the engine, placed through the session-gated order routes in `backend/src/routes/engine.ts` (`/orders/limit`, `/orders/market`) and composed client-side by `placeOrder` in `src/lib/services/order.services.ts` (a market order walks several book levels, so one call can be several fills). The server-side truth for "what does this user hold on this series, and at what price" already exists: `heldBinaryPosition({ events, seriesId })` in `backend/src/vxp/predictions.ts`, fed by `getTradeHistory({ userId })` in `backend/src/engine/clearing.ts`. It returns the held side and the average entry price of the contracts still held, ignores self-matched trades, and is what the calibration awards trust. A challenge link binds to that, so a client can never supply the side or the price.

**Referral machinery to reuse.**

- `backend/src/account/referrals.ts`: `redeemReferralCode` (one redemption per referee ever, signup window `REFERRAL_SIGNUP_WINDOW_MS`, no self-redeem, award-marker check for a re-registered identity), `claimReferralFriendship` (friendship only), `writeConfirmedFriendship`, `getOrAssignReferralCode`, and the code generator over `REFERRAL_CODE_ALPHABET` (Crockford base32).
- `backend/src/vxp/referral.ts`: `settleReferralPayout` pays both sides on the referee's first executed prediction, idempotent on the award key `referral/<refereeUserId>`; the `referrals` table (migration `0006_vxp_economy.sql`) has `referee_user_id` as primary key.
- `backend/src/routes/referrals.ts`: the public `/lookup` is limited per IP (`REFERRAL_LOOKUP_LIMIT_PER_HOUR`) with `enforceLimit` from `backend/src/lib/rate-limit.ts` and `clientIp` from `backend/src/lib/http.ts`.
- Frontend: `src/lib/components/arena/InviteLanding.svelte` (behind `src/routes/i/[code]` and `src/routes/join/[code]`) stashes `referralCode` into the `PENDING_ONBOARDING_STORAGE_KEY` payload; `drainPendingOnboarding` in `src/lib/services/onboarding-handoff.services.ts` redeems it after sign-in with a bounded retry (`MAX_DRAIN_ATTEMPTS`); `src/routes/(app)/+layout.svelte` captures `?ref=` for signed-out visitors only.

**Notifications.** The inbox is derived on the client from server state, not pushed: `src/lib/stores/inbox.store.ts` builds `InboxNotification` cards (`src/lib/types/inbox.ts`) from stores such as `friendRequestsStore` and `leagueBattlesStore`; read and dismissed state live in `localStorage` (`INBOX_READ_STORAGE_KEY`, `INBOX_DISMISSED_STORAGE_KEY` in `src/lib/constants/inbox.constants.ts`); `NOTIFICATION_KIND_CONFIG` in `src/lib/constants/notification-kind.constants.ts` maps a kind to its icon and destination. The kind `'challenge'` is already in the union and the config and is not produced by any store today.

**Share surfaces in the app.** `src/lib/components/market/SharePopover.svelte` (opened from `FlowBackHeader.svelte` on the back of a Flow card) and `MarketDetailShareButton.svelte` on the market detail page share `/m/{slug~id8}?ref=<code>` links built with `marketShareParam` (`src/lib/utils/market-slug.utils.ts`). `src/lib/services/share.services.ts` holds `notifyShareFailed`; `src/lib/utils/clipboard.utils.ts` holds `writeToClipboard`.

**Privacy inputs.** `profiles.visibility` (`'public' | 'friends_and_followers' | 'friends_only'`) and `preferences.sharing.callsPublic` are shaped by `sanitizePreferences` in `backend/src/profiles/profile.ts`; `isPubliclyHidden` and `PUBLICLY_VISIBLE_PROFILE_SQL` in the same file hide soft-deleted and hibernated accounts from every public read. `hardDeleteAccount` in `backend/src/account/lifecycle.ts` lists the tables an account's deletion clears.

**Why the preview needs the server.** vici.app is a static SPA: `Dockerfile.web` copies the SvelteKit `adapter-static` build into `nginx:alpine`, and `nginx.web.conf` serves `index.html` for every unmatched path. Messengers fetch a link and read its `<head>` without running JavaScript, so today every vici.app URL previews as the generic card in `src/app.html`. [`frontend/seo.md`](../../frontend/seo.md) describes the deploy-time head rewriting used for market pages; a challenge is created at runtime, so deploy-time generation cannot cover it.

**Landing page.** The signed-out landing (the swipe deck of curated cards, components under `src/lib/components/landing/` with the `LandingDeck*` prefix) is delivered by the landing PRs and is not on `main` at authoring time. This spec depends on it and adds one input to it (a lead series) and one line above the deck.

**Backends.** Per [`frontend/web2-backend-mode.md`](../../frontend/web2-backend-mode.md), every transport branch lives in a `*.services.ts` module behind `isWeb2Backend()`. The legacy on-chain build (vici.market) no longer creates accounts (`areNewSignupsMoved` in `src/lib/services/new-app-redirect.services.ts`, "Legacy app: new accounts move to vici.app" in `PRODUCT.md`).

## Scope

### 1. Issuing a link (app)

- A "Challenge a friend" action appears wherever the viewer holds a position on the market shown: the back of a Flow card after a call (`FlowBackHeader.svelte`, next to the existing share button) and the market detail page (next to `MarketDetailShareButton.svelte`). It is hidden when the viewer holds no position on that series, when the market is closed for predictions, and on the web3 build.
- Tapping it calls `POST /api/v1/challenges` with the series id only. The server reads the caller's trade history from the engine, computes the held position, and stores a snapshot: side, side-framed entry price, and the engine timestamp of the fill that opened the held position. It refuses with `no_position` when the caller holds nothing on that series and with `market_closed` when the series is past expiry or settled.
- **One active link per (user, series).** Creating again while the held side is unchanged returns the same link (same id, same snapshot), so the URL a user has already sent stays the one they send next time, and attribution accumulates on one row. The link is superseded only when the position it describes no longer exists (see "Lifecycle").
- The client then shares `https://vici.app/c/<id>` with the text "@handle challenged you on VICI. Think they're wrong?" through `navigator.share` when available, otherwise a small sheet with WhatsApp, Telegram and "Copy link". Before the first share the sheet states what the recipient will see ("Anyone with this link sees this call" and, per the privacy rule below, whether the handle is shown).
- The owner can revoke a link (`DELETE /api/v1/challenges/:id`) from the same sheet ("Turn off this link").

### 2. The id

16 characters of Crockford base32 from `crypto.randomInt`, the same generator shape as `generateReferralCode`: 80 bits. With the per-IP read limit below, guessing a live id is infeasible (at one million live links, one guess hits with probability about 1e-18). The id carries no information: no user id, no handle, no series id. Input is normalised to uppercase before lookup; anything that does not match the id pattern reads as not found without touching the database.

### 3. Receiving end

`src/routes/c/[id]/+page.svelte` is a public route. The only thing it reads from the URL is the id. Query parameters are ignored for content.

- **Signed-out visitor:** `GET /api/v1/challenges/:id` returns the challenge view. The route renders the landing page with the challenged series as the lead card and the line above the deck. It stashes `challengeId` in the pending-onboarding payload (see "Inviter credit") and keeps a `challengeContext` (`id`, `seriesId`) for the answer step.
- **Signed-in visitor:** redirected to the market detail (`/markets/{seriesId}`) with a banner carrying the same line and a "Predict in Flow" action (the existing `setPinnedFlowMarket` path). The challenger opening their own link gets the market detail with no banner.
- **Web3 build:** the route redirects to the same path on `NEW_APP_ORIGIN` (`src/lib/constants/claim.constants.ts`); the legacy build renders nothing of its own.

What the page shows per state, all decided by the server response:

| State                                                                            | Line above the deck                                                                                                                      | Lead card                                                            | Attribution |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Active, market open, handle visible                                              | "@handle called Yes at 38%. Think they're wrong?"                                                                                        | the challenged series                                                | yes         |
| Active, market open, handle withheld (privacy rule)                              | "A friend called Yes at 38%. Think they're wrong?"                                                                                       | the challenged series                                                | yes         |
| `closed`: the challenger no longer holds that position (exited or flipped)       | "@handle challenged you. Make your call." (no side, no price)                                                                            | the challenged series                                                | yes         |
| Market closed for predictions (past expiry or settled)                           | "@handle called Yes at 38% on a market that has closed." plus the result when the settlement names one (existing public settlement read) | the standard deck; the closed market is not a card (nothing to call) | yes         |
| Not found: unknown id, revoked, pruned, or challenger soft-deleted or hibernated | none                                                                                                                                     | the standard landing page                                            | no          |

Revoked, unknown and hidden-account links are indistinguishable to the caller (one `404 challenge_not_found`), so the endpoint is not an oracle for "this id existed" or "this account was deleted".

### 4. Link preview: nginx includes a head fragment rendered by the API

The chosen design: the same SPA shell is served to everyone, and nginx fills the preview tags through a server-side include of a small HTML fragment the API renders for that challenge.

- `src/app.html` wraps its generic preview tags (title, description, canonical, `og:*`, `twitter:*`) in a named SSI block and follows it with an include of `/__challenge_head/<id>` that names the block as its stub. SSI directives are HTML comments, so wherever SSI is off (every other path, the Juno build, local dev) the page is byte-for-byte what a browser reads today.
- `nginx.web.conf` gains a location for `^/c/<id pattern>$` that turns SSI on and serves `index.html`, and an `internal` location `/__challenge_head/` that proxies to `GET /api/v1/challenges/:id/head` with a sub-second timeout and a 60 second micro-cache keyed by id. On any failure (timeout, 404, API down) nginx emits the stub, which is the generic share card. The page still loads; only the preview degrades.
- The fragment contains only: `<title>`, `description`, `og:title`, `og:description`, `og:url`, `og:image`, `og:type`, the `twitter:*` equivalents, and `robots: noindex, nofollow`. Copy is English, as the rest of the crawler-facing layer is (`seo.md`): a crawler carries no recipient locale. Title: "@handle called Yes at 38% | VICI"; description: the market's registry title plus "Think they're wrong?". The states of the table above map to the same wording.
- `og:image` is an absolute URL on the live domain. This spec ships a static image per curated deck series (the card art already in the web bundle) and the generic share card for every other market. A composited per-challenge image (handle and price drawn on the art) is a pending decision below.
- `/c/*` responses carry `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`. `/c/` is not added to `robots.txt`: preview crawlers that honour it would then fetch nothing.

Alternatives considered are under "Decisions".

### 5. Inviter credit

- **A challenge link is a referral channel, not a new earn surface.** Redeeming one writes the same single `referrals` row a referral code writes, with the challenger as referrer and a new nullable `challenge_id` column naming the link. No new award type, no challenge-specific VXP.
- **No double pay, by construction.** `referrals.referee_user_id` is the primary key, so a person is credited to one inviter ever, across every channel (invite link, league invite, market share `?ref=`, challenge link). The payout is unchanged: `settleReferralPayout` on the referee's first executed prediction, the flat referee bonus and the referrer's diminishing, capped reward, both idempotent on `referral/<refereeUserId>`. All amounts stay in `src/lib/constants/referral.constants.ts`.
- **Which link wins:** last touch before sign-up. Opening a challenge link sets `challengeId` and clears `referralCode` in the pending-onboarding payload; opening an invite or `?ref=` link afterwards does the reverse. The drain therefore redeems exactly one. If two redemptions race anyway, the first written row stands (`on conflict (referee_user_id) do nothing`).
- `POST /api/v1/challenges/:id/redeem` applies the rules of `redeemReferralCode` (signup window, no self, one per referee, award-marker check) through a shared helper, and falls back server-side to the friendship-only claim for an account past the window or already referred. It answers `{ outcome: 'redeemed' | 'friendship_only' }`. Either way a confirmed friendship is written (`writeConfirmedFriendship`: never downgrades an existing relation).
- A challenge whose state is `closed` or whose market has closed still credits. A not-found link credits nobody.

### 6. "Your friend answered"

- An **answer** is the invitee's own position on the challenged series, verified by the server. After any successful call on a series that matches the stored `challengeContext`, the client posts `POST /api/v1/challenges/:id/answer`; the server recomputes the caller's held position from the engine and stores side and entry price. One answer per (link, user), idempotent. The challenger cannot answer their own link.
- The challenger's inbox shows a `'challenge'` card per answer: "@friend called No at 44%. You said Yes at 38%.", deep-linked to the market. The card is derived from `GET /api/v1/challenges/answers` (answers to the caller's links, newest first, bounded window), loaded with the app shell like the other inbox sources, with read and dismissed state in the existing `localStorage` overlays.
- The answerer's handle is shown when the two are friends (true for every redeemed sign-up) or the answerer's profile is public; otherwise "Someone answered your challenge".
- A sign-up through a link that never makes a call produces no card: the referral list in the app already shows redemptions.

### 7. Privacy and abuse

- **No PII in links:** the id is random; the URL has no handle, user id or market.
- **Public response:** handle and avatar only (when allowed), side, entry price, time of the call, series id, state. Never the account id, email or any balance or size.
- **Handle visibility follows the profile's settings, evaluated on every read** (so a later change applies to links already sent): the handle and avatar are shown only when `visibility` is `public` and `sharing.callsPublic` is not `false`. Otherwise the line says "A friend". The side and price are still shown, because issuing the link is the owner's explicit act of sharing that one call. Whether an explicit share should also override the handle rule is a pending decision.
- **Rate limits** (named constants at the top of `backend/src/routes/challenges.ts`, windows from `backend/src/lib/time.ts`): the public read per IP; create, redeem and answer per account (`ip: user.id`, the documented pattern for signed-in endpoints that fan out an engine read). nginx adds a per-client `limit_req` on `/c/` so a preview storm cannot reach the API unbounded; the micro-cache absorbs repeated previews of one link.
- **Turnstile.** The reusable Turnstile service and its API verification land in a separate PR, which this spec depends on. Each endpoint was checked against "is there an unauthenticated write, or an enumeration risk?":

  | Endpoint                                          | Auth    | Write      | Enumerable     | Protection                                                                |
  | ------------------------------------------------- | ------- | ---------- | -------------- | ------------------------------------------------------------------------- |
  | `GET /challenges/:id`                             | none    | no         | no (80-bit id) | per-IP limit; no Turnstile, so the first paint and previews are not gated |
  | `GET /challenges/:id/head`                        | none    | no         | no             | nginx `limit_req` and micro-cache; coarse API limit                       |
  | `POST /challenges`                                | session | yes        | n/a            | per-account limit; one active link per series                             |
  | `POST /challenges/:id/redeem`                     | session | yes        | n/a            | per-account limit; one redemption per referee                             |
  | `POST /challenges/:id/answer`                     | session | yes        | n/a            | per-account limit; engine-verified                                        |
  | `GET /challenges/mine`, `/answers`, `DELETE /:id` | session | owner only | n/a            | session                                                                   |

  No challenge endpoint is an unauthenticated write, by design: opens are counted through the analytics ingest, which has its own limits. The sign-up a challenge funnels into is the Turnstile-gated one from the dependency PR, which is where a scripted farm of invitees is stopped.

### 8. Lifecycle

- **Position closed or flipped.** `runTradeActivityTriggers` (`backend/src/vxp/triggers.ts`) already loads the caller's full trade history on every trade activity. A new step reuses those events to re-evaluate the caller's active links: a link whose series is now flat or held on the other side becomes `closed`. No extra engine call. Creating a link for that series again issues a fresh id with the current position.
- **Adding to the position** keeps the link and its snapshot: the line states what the challenger had called when they challenged.
- **Market closes or resolves.** Computed on read from the cached registry series and settlement status; no write.
- **Revoked** by the owner: reads as not found. Irreversible; a new link gets a new id.
- **Soft delete or hibernation** of the challenger: reads as not found while the profile is hidden, and works again if the account is recovered or resumed.
- **Hard delete** of the challenger: `hardDeleteAccount` deletes their links (answers cascade) and the answers they gave. Referral history keeps following the existing rules in `PRODUCT.md` ("Privacy: what survives an account's deletion"); `referrals.challenge_id` is plain text with no foreign key, so pruning links never touches it.
- **Retention.** A worker job prunes links whose market closed, or whose status left `active`, more than `CHALLENGE_LINK_RETENTION_MS` ago. A pruned link reads as not found.

### 9. Web3 build

The feature is web2-only. Verified against the code: it needs server-side custody of the engine identity (to read a user's trade history authoritatively), a public HTML-capable origin for previews, and a sign-up to convert into, and the legacy build has none of the three (no new accounts since the move to vici.app). `src/lib/services/challenge.services.ts` exposes `areChallengeLinksEnabled()` (true only for `isWeb2Backend()`), which the two action buttons and the route read; components never branch on the backend themselves. **Satellite impact:** no collection, hook, endpoint or `.did` change. The only satellite-adjacent file touched is `src/lib/schema/analytics-event.schema.ts` (imported by `src/satellite/index.ts`) if new event names are added, which triggers the usual `npm run juno:functions:build` regeneration and the vendored declaration copy (AGENTS.md rule 9).

### Out of scope

- Turning landing taps into real predictions at sign-up, and the "Challenge a friend" action on the landing itself: part B.
- The Turnstile service and its API verification: separate PR, a dependency.
- The call-size change (continuous range, default from constants): separate spec. Nothing here reads a call size.
- A composited per-challenge preview image, unless the pending decision below says otherwise.
- Push or email notifications. The inbox card is the only notification.
- Challenge links for non-binary (multi-outcome) series: `heldBinaryPosition` is binary only. The action is hidden on other series.
- Any change to referral amounts, the curve, the cap or the signup window.
- Wiring for the legacy on-chain build beyond the redirect.

## Linked issues

GitHub issue search was not possible from the authoring session (no access to the repository's issues). No issue is linked. Before flipping the status to `In progress`, the implementer searches open issues for "challenge", "share link", "og" and "referral" and records the result here. `PRODUCT.md` mentions #543 (anti-farm hardening of the new-account mint surface): this spec does not change that surface and does not close it.

## Analytics

Instrument. New names (three places each: `src/lib/types/analytics-event.ts`, `src/lib/schema/analytics-event.schema.ts`, and the mirror `backend/src/analytics/taxonomy.ts` pinned by `backend/tests/shared-drift/`):

| Event                | Recorded by                                                             | Props                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challenge_created`  | server (`captureServerEvents`), added to `SERVER_ANALYTICS_EVENT_NAMES` | `marketId`, `source` (`flow` \| `market_detail` \| `onboarding`), `label` (`new` \| `existing`)                                                      |
| `challenge_opened`   | client, on the receiving route                                          | `marketId` when known, `label` (`active` \| `closed` \| `market_closed` \| `not_found`), `ok` (handle shown), `source` (`signed_out` \| `signed_in`) |
| `challenge_answered` | server, added to `SERVER_ANALYTICS_EVENT_NAMES`                         | `marketId`, `label` (`same_side` \| `opposite_side`), `source` (`signup` \| `existing`)                                                              |

Reused names, no new entry:

- `market_shared` with `source: 'challenge'` and `label` = channel (`native` \| `whatsapp` \| `telegram` \| `copy`) when the link is actually sent.
- `referral_redeemed` with `source: 'challenge'` for a sign-up credited through a link (this is the "challenge sign-up" event; the existing `resolvePendingReferral` call site already takes a `source`), and `signed_up` unchanged.
- `notification_opened` with `label: 'challenge'` for the inbox card (already in its documented vocabulary).

Every prop is from a closed vocabulary or an existing id field. The challenge id is never sent (it is a bearer link), and no handle is sent.

The landing work routes its analytics through a dedicated later PR. Whether these events land in this spec's PR or in that one is a pending decision; the server-recorded two cannot be added without this spec's routes.

## Technical requirements (satellite / backend: mandatory)

**Satellite:** not touched (see Scope 9). The requirements below are for the web2 API and the web image.

- **Data model** (one forward-only migration, `backend/src/db/migrations/0026_challenge_links.sql`, or the next free number at build time):
  - `challenge_links`: `id text primary key` (checked against the id pattern), `challenger_user_id uuid not null references users (id) on delete cascade`, `series_id text not null`, `side text not null check (side in ('YES','NO'))`, `entry_price_bps int not null check (entry_price_bps between 1 and 9999)` (side-framed probability, rounded from the engine's fixed-point price so no float is stored), `called_at_ms bigint not null`, `status text not null default 'active' check (status in ('active','closed','revoked'))`, `status_changed_at_ms bigint`, `created_at_ms bigint not null`. A partial unique index on `(challenger_user_id, series_id) where status = 'active'` is the idempotency of "one active link per prediction"; an index on `(challenger_user_id, created_at_ms desc)` serves `/mine`.
  - `challenge_answers`: `challenge_id text not null references challenge_links (id) on delete cascade`, `answerer_user_id uuid not null references users (id) on delete cascade`, `side`, `entry_price_bps`, `answered_at_ms bigint not null`, `via text not null check (via in ('signup','existing'))`, primary key `(challenge_id, answerer_user_id)`.
  - `alter table referrals add column if not exists challenge_id text`: null for every existing row and every non-challenge redemption. The previous release keeps working against it.
- **Performance.** Public read: one primary-key select joined to `profiles`, plus the registry series from `cached(...)` (`backend/src/engine/cache.ts`, `PUBLIC_READ_TTL_MS`); no engine call on a cache hit. Expected frequency: one per link open, plus at most one head fragment per id per 60 seconds behind the nginx cache. Create and answer: one `get_trade_history` engine read each, the same read `runTradeActivityTriggers` makes per trade, bounded by the per-account limits. The lifecycle sync adds one indexed select per trade activity and no engine call.
- **Memory and storage.** A link row is about 200 bytes, an answer about 100. A user can hold at most one active link per series they hold a position on. At 100,000 users with five links each: about 500,000 rows, on the order of 100 MB with indexes, shrinking with the prune job. Rate-limit windows stay in memory per instance (the existing limitation noted in `rate-limit.ts`).
- **Scalability.** At 10x and 100x the per-open cost stays one indexed read; a link that goes viral is absorbed by the nginx micro-cache for previews and by the per-IP limit for the JSON read (a school network sharing one IP is the reason the budget follows `REFERRAL_LOOKUP_LIMIT_PER_HOUR`). `/mine` and `/answers` are bounded lists, never N+1: answers are read with one join.
- **Upgrade and compatibility.** Additive migration, no rename. No `.did` change and no breaking change. New wire codes are contracts: `challenge_not_found`, `no_position`, `market_closed`, `self_challenge`. `src/lib/web2/client.ts` gains the typed wrappers in the same PR. The id pattern is a mirrored constant (app and API), pinned by a new shared-drift test like the referral code pair.
- **Security.** The head fragment is HTML injected into a page for every visitor, so it is built from a fixed template with every interpolated value HTML-escaped; the handle is already restricted by the nickname rule, the market title comes from the registry and is escaped, and no client-supplied string reaches it. Writes pass the existing same-origin guard (`refuseUnsafeRequest`). The `/__challenge_head/` location is `internal`. Sessions are cookies; no user id is read from a body.
- **Protected paths touched** (call out in the PR body, per `governance.md`): `nginx.web.conf`, `Dockerfile.web` and possibly `fly.web.toml` (API upstream for the include), `backend/src/db/**` (migration), `backend/src/vxp/triggers.ts` and `backend/src/account/**` (VXP and account domains), `src/app.html` head tags (a contract with `scripts/build/generate-seo-assets.ts`; that script is only touched if its patterns stop matching).
- **Parameters.** Limits and retention are named constants in `backend/src/routes/challenges.ts` and `backend/src/social/challenges.ts`; referral amounts and windows stay in `src/lib/constants/referral.constants.ts` and its API mirror `backend/src/vxp/constants.ts`. This spec restates none of them.

## Implementation outline

1. **Migration** `backend/src/db/migrations/00NN_challenge_links.sql` as above, with the why in the header comment.
2. **Domain** `backend/src/social/challenges.ts`: id generation and pattern; `createChallenge({ userId, seriesId })`; `getChallengeView(id)` (applies the hidden-account and handle rules, computes market state); `revokeChallenge`; `listMyChallenges`; `recordChallengeAnswer`; `listChallengeAnswers`; `syncChallengesForUser({ userId, events })`; `pruneChallengeLinks`; `renderChallengeHead(view)`. Typed errors (`ChallengeError` subclasses) mapped by the route.
3. **Position timestamp.** Extend `heldBinaryPosition` (`backend/src/vxp/predictions.ts`) to also return the timestamp of the fill that opened the held run, without changing its existing fields.
4. **Referral sharing.** Extract the body of `redeemReferralCode` into a helper taking `{ userId, referrerUserId, code, challengeId? }` in `backend/src/account/referrals.ts`; `redeemChallenge` resolves the challenger, takes their code from `getOrAssignReferralCode`, and calls it, falling back to the friendship claim.
5. **Routes** `backend/src/routes/challenges.ts` (`challengesRoutes`, prefix `/api/v1/challenges`), mounted in `backend/src/index.ts`; the `/head` route answers `text/html`.
6. **Triggers and lifecycle.** Call `syncChallengesForUser` from `runTradeActivityTriggers`; add the deletes to `hardDeleteAccount`; add a `prune-challenge-links` job to `backend/src/worker.ts`.
7. **Web image.** SSI block and include in `src/app.html`; `/c/` and `/__challenge_head/` locations, `limit_req` zone and micro-cache in `nginx.web.conf`; the API upstream passed to the image.
8. **Client transport.** Typed wrappers in `src/lib/web2/client.ts`; `src/lib/services/challenge.services.ts` (the only place that branches on `isWeb2Backend()`); `src/lib/types/challenge.ts`; `src/lib/constants/challenge.constants.ts` (id pattern, storage key); the `/c` path next to `PublicPath` in `src/lib/constants/routes.constants.ts`.
9. **Issuing UI.** `src/lib/components/market/ChallengeShareButton.svelte` and its sheet, reusing the channel icons, `writeToClipboard` and `notifyShareFailed`; mounted in `FlowBackHeader.svelte` and beside `MarketDetailShareButton.svelte`.
10. **Receiving UI.** `src/routes/c/[id]/+page.svelte`; `src/lib/components/landing/LandingDeckChallengeLine.svelte`; the landing deck accepts a lead series; a banner on the market detail page for signed-in visitors.
11. **Attribution and answer.** Add `challengeId` to `PendingOnboarding` and to `settlePendingSlot`'s bounded retry in `onboarding-handoff.services.ts`; make the `/i/[code]` and `?ref=` stashes clear it (last touch); post the answer after a successful `placeOrder` on the context series.
12. **Inbox.** `src/lib/stores/challenge-answers.store.ts`, a derived source in `inbox.store.ts` producing `'challenge'` cards, cleared on identity change like the other stores.
13. **i18n** keys in every catalog under `src/lib/constants/messages/` (`challenge.share.*`, `landing.deck.challenge.*`, `inbox.challenge_answer.*`, `market.detail.challenge.*`).
14. **Docs in the same PR:** `PRODUCT.md` (new "Challenge links" entry; "Friendship rules" invites bullet; "Privacy: what survives an account's deletion"), `economy.md` (a challenge link is a referral channel), `frontend/seo.md` (the runtime head include), `frontend/web2-backend-mode.md` (web2-only domain), `backend/README.md` (routes, env), the reusability catalogs for any shared piece, `governance.md` only if a protected path row changes.

**Tests**

- **API** (`backend/tests/challenges.test.ts`, real Postgres, engine through `setEngineActorProvider`, `resetRateLimits` between tests): create needs a position; create is idempotent per series; the snapshot comes from the engine history, never the body; a flipped or flat position closes the link through the trade trigger; public read shape has no account id; handle withheld for a non-public profile and for `callsPublic: false`; soft-deleted and hibernated challengers read as not found and come back on recovery; revoked equals unknown on the wire; redeem writes one `referrals` row with `challenge_id`, refuses self, and a second redemption through any channel changes nothing; past-window accounts get friendship only; answer is engine-verified, idempotent, and refused for the challenger; hard delete removes links and answers; per-IP and per-account limits answer 429; malformed ids never reach SQL; the head fragment escapes a hostile market title.
- **Referral regression:** `backend/tests/vxp-referral.test.ts` and `referral-codes.test.ts` stay green; one added case proves a challenge redemption settles exactly one referee bonus and one referrer reward.
- **Shared drift:** the id pattern pair; the analytics taxonomy pair.
- **Pure logic** (`src/tests/`): the line-and-state mapping from a challenge view to copy keys; the last-touch stash merge; the inbox card derivation.
- **E2E** (`e2e-web2/challenge.spec.ts`, fake engine seeded with a position): user A creates a link from the market detail; a signed-out context opens `/c/<id>` and sees the line and the lead card; editing the URL's query changes nothing; the visitor signs up, user A's referral list shows them, the visitor makes a call and user A's inbox shows the card.
- **Preview** is not reachable from Playwright (the suite does not run nginx): verified by a container smoke check of the web image against a stub upstream (fragment present on `/c/<id>`, stub on upstream failure, untouched head on `/`), and manually on staging with at least WhatsApp, Telegram and iMessage.

**Rollout**

1. API first: migration and routes are additive and unused until the web build links to them.
2. Web image second, in the same release window as the landing go-live: the nginx change, the route and the action buttons.
3. The feature is switched on by whatever switches the landing live (see the open question); it must not be reachable before the landing is, nor lag it.
4. Rollback: redeploy the previous web image (links then open the plain landing through the SPA fallback); the API routes and tables can stay.

**Risks**

- **nginx include mechanics** are the least certain piece (open question below); the fallback design is ready and changes nothing outside `nginx.web.conf`.
- **A page-critical path now touches the API.** Mitigated by the sub-second timeout, the stub and the micro-cache: an API outage costs a preview, not the page.
- **Referral farming through challenge links** is exactly as wide as through invite links: same row, same cap, same curve, same first-prediction gate.
- **Size.** Migration, API, web image, two app surfaces, the receiving route and the inbox in one PR is large. It has one purpose and is reviewable in the order of the outline; splitting it further is a pending decision.
- **Stale snapshot.** A challenger who adds to a position keeps the original price on the link. Accepted: the line describes the call as it was when they challenged.

## Acceptance criteria

- [ ] A user with a position on a market can create a challenge link from the back of a Flow card and from the market detail page; a user without one cannot (no action shown, and the API answers `no_position`).
- [ ] The stored side, entry price and time come from the engine trade history; no request field can set them.
- [ ] Creating a second time for the same held position returns the same id.
- [ ] `https://vici.app/c/<id>` opened signed-out shows the challenged market first and the line with the server's handle, side and price; changing or adding query parameters changes nothing shown.
- [ ] Each state of the table in Scope 3 renders its line; unknown, revoked and hidden-account links render the plain landing page and are indistinguishable on the wire.
- [ ] A messenger preview of `/c/<id>` shows the challenge-specific title and description; with the API unreachable it shows the generic share card and the page still loads.
- [ ] The handle is withheld on the page and in the preview when the challenger's profile is not public or has calls set to private, and that follows a later settings change.
- [ ] A sign-up through a challenge link has exactly one `referrals` row naming the challenger, pays the existing referral bonuses once on the first prediction, and makes the two friends; an earlier or later invite link cannot produce a second payout.
- [ ] When the invitee makes a call on the challenged market the challenger gets one inbox card that opens the market.
- [ ] Closing or flipping the position, revoking, soft delete, hibernation, hard delete and market close each behave as written in Scope 8.
- [ ] No response or URL contains an account id, an email or a call size.
- [ ] Public and per-account limits answer `429 rate_limited`.
- [ ] The web3 build shows no challenge action and `/c/<id>` there redirects to vici.app.
- [ ] `PRODUCT.md`, `economy.md`, `seo.md`, `web2-backend-mode.md` and `backend/README.md` describe the shipped behaviour.
- [ ] `cd backend && bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **nginx SSI behaviour in the web image.** Confirm in a container built from `Dockerfile.web`: (a) `ssi on` in a regex location that serves `index.html` through `try_files` processes the directives; (b) `include virtual` accepts the id from a location capture or a `set` variable; (c) the `stub` block is emitted on upstream timeout and on 404; (d) the SSI comments in `src/app.html` survive `npm run build` unchanged; (e) the head patterns in `scripts/build/generate-seo-assets.ts` still match with the block markers around them. If (a) to (c) fail, switch to the crawler-only proxy recorded under "Decisions"; if (d) or (e) fails, emit a dedicated shell copy for `/c/` at image build instead of marking `app.html`.
2. **How nginx reaches the API.** Is the API app reachable from the web app over Fly's private network (and does it listen there), or only through `https://api.vici.app`? The private route keeps the visitor's `Fly-Client-IP` meaningful for the API's limiter; over the public route every include comes from the web machine's address, so the head endpoint must rely on nginx's own `limit_req` and cache.
3. **Landing go-live switch.** Do the landing PRs go live by merge and deploy alone or behind a constant or env flag? This spec must use the same switch.
4. **Landing deck contract.** Does the landing deck accept an arbitrary series as its lead card, and what does it render for a series outside the curated set (which has no dedicated art)? Needed before step 10; if it only renders the curated set, see pending decision 3.
5. **Is vici.app proxied by Cloudflare** (beyond using Turnstile)? If so, its caching and bot rules must not cache `/c/*` HTML across ids or challenge preview crawlers.
6. **Open issues.** Run the issue search that was not possible at authoring time.

## Pending decisions

Each needs the owner; the recommendation is the author's.

1. **Handle rule versus explicit share.** Follow the profile's privacy settings on every read (handle withheld, "A friend called...") or treat creating the link as consent to show the handle on that link. _Recommendation: follow the settings, and tell the owner in the share sheet what recipients will see, with a shortcut to Settings. It is the reading of "consistent with profile privacy settings" that cannot surprise a private user later._
2. **Per-challenge preview image.** Static art per curated series plus the generic card for the rest, or a composited image per challenge (handle and price drawn on the art) rendered by the API. _Recommendation: static for go-live; composited as a fast-follow. Rendering needs a new image dependency in the API (protected) and a cache, and the title and description already carry the personal part of the preview._
3. **Challenges on markets outside the curated deck.** Show any challenged series as the lead card on the landing with the standard market artwork, or send those links to the public market page with the challenge line. _Recommendation: lead card on the landing for every series, so there is one receiving experience and one funnel into sign-up._
4. **What counts as "answered".** Only a call on the challenged market, or also the sign-up itself. _Recommendation: only the call. The referral list already shows sign-ups, and "answered" should mean the friend took a side._
5. **Friendship for an existing user who answers.** Auto-friend on answer (the same implied consent as an invite link) or leave the graph alone for accounts that did not sign up through the link. _Recommendation: auto-friend on answer, never on open, through the same never-downgrade write._
6. **Closed position on the receiving page.** Show the neutral line (no side, no price) or keep the historical "called Yes at 38%". _Recommendation: neutral. The challenger no longer stands behind that call._
7. **Retention.** How long a link outlives its market or its `active` status before the prune job removes it. _Recommendation: 90 days, so late opens still credit the inviter and old links do not accumulate._
8. **Where the analytics land.** In this spec's PR or in the landing analytics PR. _Recommendation: here. Two of the three events are recorded by the server inside the new routes, and a feature shipped without them is invisible at go-live._
9. **Further split of this part.** One PR as specified, or an API-and-image PR followed by an app PR. _Recommendation: one PR, reviewed in outline order. A split would need a second spec part under the one-spec-one-PR rule and the API alone is not testable end to end._
10. **Turnstile on create.** Add a Turnstile check to `POST /challenges` in addition to the session and the per-account limit. _Recommendation: no. The caller is authenticated, each link needs a real engine position, and a widget on a share action costs more than it protects._

## Decisions

- **Bind to the held position, not to an order id.** A call can be several fills and the client composes them; the engine history folded by `heldBinaryPosition` is the one figure the server can vouch for, and it is already the basis of engine-verified awards.
- **One active link per (user, series).** Many links per prediction would split attribution, multiply rows a spammer can mint, and make "the link I sent" ambiguous. One link with a partial unique index is idempotent in the schema, as the backend patterns require.
- **80-bit random id.** Short enough for a messenger, far beyond what the read limit lets anyone search. Sequential or signed ids were rejected: the first is enumerable, the second leaks structure and is long.
- **Preview by an nginx include of an API-rendered head fragment.** Compared with the alternatives:
  - _Proxy `/c/*` to an API endpoint that returns the page._ The API would have to hold and keep in step the SPA shell and its hashed bundle names, or answer a stub page that redirects, adding a hop and a blank frame for every person and making the page depend on the API being up. Rejected.
  - _Crawler-only proxy_ (nginx maps known preview user agents to the API, people get the SPA). Smallest change, but it serves two different documents for one URL and silently degrades for any crawler missing from the list. Kept as the fallback if open question 1 fails, because an unknown crawler still gets the generic card.
  - _Generated images alone._ An image does not solve the tags: the title, description and image URL still have to be in the HTML a crawler fetches. It is an addition to either design (pending decision 2), not a substitute.
  - The include serves one document to everyone, needs no crawler list, leaves the SPA shell owned by the web build, and fails to the generic card.
- **A challenge is a referral channel.** Reusing the `referrals` row makes "no double pay" a primary-key fact instead of a rule to enforce, keeps the referrer cap and curve authoritative, and needs no change to `economy.md` beyond naming the channel.
- **Web2 only.** See Scope 9.
- **English previews.** A crawler has no recipient locale; the page itself is localised once it loads.
