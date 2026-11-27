# Spec: Waitlist, landing calls kept with the reservation

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W4** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W1, on W3** (the session read of a reservation) **and on the challenge links API** (A1, branch `claude/landing-xgugio-challenge-links-api`). Must be merged before the capsule's done state offers "Challenge a friend". Implementation PR title: `feat(waitlist): keep landing calls with the reservation`.

It also lists the edits three drafts of the challenge links work need, on branch `claude/landing-xgugio-challenge-links-spec` and not on `main` at authoring time: `specs/2026-11-26-feat-challenge-links-api.md` (A1), `specs/2026-11-26-feat-challenge-links-landing.md` (A4) and `specs/2026-11-26-feat-landing-calls-conversion.md` (B). This spec does not edit them.

## Goal

The Yes and No a waitlister taps on the landing are kept on the server with their reservation, so they survive the wait and follow the person to any device. When the account is created they are offered for conversion into real predictions, if the market is still open. Meanwhile "Challenge a friend" in the capsule's done state works: it gives a link that shows the waitlister's stored call, "@handle called Yes at 38%. Think they're wrong?", read from the server and never from the address bar. A friend who joins through it counts as an invite and as challenge credit when accounts exist.

## Context

- **The landing's taps.** The deck and the Markets view (`src/lib/components/landing/`, branches `claude/landing-xgugio-deck` and `claude/landing-xgugio-markets`) let a signed-out visitor tap Yes or No with a call size; the size's bounds and default are in `src/lib/constants/vxp-economy.constants.ts`. After a tap the deck says "You called Yes with 50 VXP. If you're right, you earn N VXP."; the Markets view says "Calls open with the waitlist.". Both lines stay as they are.
- **Spec B** planned to keep taps in the browser for 7 days and convert them at sign-up, with "no new server surface".
- **A1 as built** (`backend/src/db/migrations/0026_challenge_links.sql`, `backend/src/social/challenges.ts`, `backend/src/routes/challenges.ts`): `challenge_links` is one row per (user, series) with `challenger_user_id uuid not null`, the held position (`side`, `entry_price_bps`, `called_at_ms`) rewritten from the engine by the trade trigger, `created_side`, `show_identity`, `status`, the market-close stamps and a prune job; ids are 16 characters of the referral alphabet; `GET /api/v1/challenges/:id` is the public read, `POST /:id/redeem` writes the single referral row with its `challenge_id`, `POST /:id/answer` records an engine-verified answer. Everything about a link's owner assumes an account.
- **From W1 and W3.** `waitlist_reservations`, the status token, `POST /waitlist/status`, `GET /waitlist/mine`, removal that deletes what hangs from a reservation, `invited_challenge_id`.
- **Prices on the server.** The API reads the engine's books through the cached public reads under `backend/src/engine/`; `toEntryPriceBps` in `backend/src/social/challenges.ts` is the side-framed basis-point form.

## Scope

### 1. Stored calls

**`waitlist_taps`**: `reservation_id` (references `waitlist_reservations`, `on delete cascade`), `series_id`, `series_expiry_ms`, `side` (`YES` or `NO`), `price_bps` (1 to 9999, side-framed), `size_vxp int` (within the call-size bounds), `tapped_at_ms`; primary key `(reservation_id, series_id)`.

- **One per series, ten per reservation** (`WAITLIST_TAPS_MAX`): a tap on the same series replaces the earlier one; an eleventh drops the oldest, in the same transaction.
- **`POST /api/v1/waitlist/taps`**: body `{ statusToken, seriesId, side, size }`. The server checks that the series is a listed, open, binary market and that the size is within the call-size constants, then **reads the price itself** and stamps its own time. The client sends neither. Limited per IP and per reservation (`WAITLIST_TAPS_LIMIT_PER_HOUR`).
- **Before joining** there is no reservation to attach to: the page holds taps in the browser (the buffer the deck and Markets PRs already need to render their state) and, right after a successful `confirm`, sends each one. Their stored price and time are those of that moment, not of the tap.
- **Read back:** `POST /waitlist/status` returns the stored calls with the handle, so the landing restores them for a returning visitor on any browser that holds the token; `GET /waitlist/mine` returns them to the signed-in app.
- **Kept until** the market closes (pruned hourly by `series_expiry_ms`), the reservation is removed or lapses, or the conversion sheet has dealt with them (section 3). There is no 7-day limit.

### 2. "Challenge a friend" from a stored call

**One table, one id space.** A link issued from a stored call is a row of A1's `challenge_links` with a discriminator, so `/c/<id>`, the public read, the preview (A2) and the receiving page (A4) serve both kinds through one path:

- `source text not null default 'position' check (source in ('position', 'landing_tap'))`;
- `reservation_id uuid references waitlist_reservations (id) on delete cascade`;
- `challenger_user_id` becomes nullable, with `check (challenger_user_id is not null or reservation_id is not null)`;
- a second partial unique index, `(reservation_id, series_id) where status = 'active' and reservation_id is not null`.

**`POST /api/v1/waitlist/challenge`**: body `{ statusToken, seriesId }`; needs a stored call on that series; creates or returns the active link for (reservation, series) with `side`, `entry_price_bps` and `called_at_ms` copied from the stored call, `created_side` set once, `show_identity` true; answers `{ id }`. The capsule's done state calls it for the visitor's most recent call and shares `https://vici.app/c/<id>`.

- **Kept in step.** Replacing the stored call on that series rewrites the link's three position fields in the same transaction; a changed side therefore reads as "now says" on the receiving page, exactly as for a real position.
- **What the public read shows.** The reservation's current handle (no avatar), the stored side and price, and whether the market is open. Nothing in the URL beyond the id is read.
- **Removal** of the reservation deletes its links with it (the cascade); the URL then shows the standard landing.
- **When the account is created** (W3's end of hold), the reservation's links get `challenger_user_id`. From then on the link belongs to the account: it appears in "my challenges", its consent can be changed and it can be revoked through A1's routes. It stays `landing_tap` and keeps showing the stored call until the person's first real trade on that series, when A1's trade trigger rewrites the position from the engine and sets `source = 'position'`. If they never convert that call, the link keeps the stored call until the market closes.
- **A friend who arrives through it** and joins the waitlist has the link on their reservation (`invited_challenge_id`, W1). That is an invite for the list order (W5) and challenge credit at account creation (W3 and section 4).

### 3. Conversion at account creation

Spec B keeps its sheet and its rule: nothing is placed without an explicit confirmation, at the price of that moment. This part gives it its input and its cleanup:

- `GET /waitlist/mine` carries the stored calls (`seriesId`, `side`, `priceBps`, `sizeVxp`, `tappedAtMs`), so the sheet opens on any device after the account is created.
- `DELETE /api/v1/waitlist/mine/taps` (session-gated), body `{ seriesIds? }`: the app calls it when the sheet has placed or declined calls, per B's "Not now, once more next session" rule. Links issued from those calls are not deleted: they are the account's now.

### 4. Credit when the inviter has no account yet

A1's redeem writes a referral row naming the challenger as referrer, and referrals can only be redeemed within `REFERRAL_SIGNUP_WINDOW_MS` of the friend's profile creation. A waitlister's link has no account behind it until its owner is admitted and signs up, which may be after the friend.

- If the link has a `challenger_user_id` when the friend's profile is created: W3 applies the credit as for any challenge link.
- If it does not: the friend's reservation keeps `invited_challenge_id`, and the credit is applied when the inviter's account is created, by the same function, with the window measured from the later of the two profile creations. This is the one change to the referral rule this part asks for, and it is pending decision 1: until it is decided, this deferred branch is not built and an ownerless link credits nobody.

### 5. Edits required to the challenge links drafts

**A1 (API, already built on its branch).**

- The schema changes of section 2, in a migration of this PR if A1 is merged, else folded into A1's own.
- `getChallengeView` / `findPublicLink`: a row without a user takes its identity from the reservation; the view gains `kind: 'position' | 'landing_tap'`.
- The trade trigger updates rows by `challenger_user_id` only and flips `source` when it writes a position onto a `landing_tap` row.
- `redeem`: a link whose challenger has no account answers a terminal `challenger_pending`, not a failure to retry.
- `answer`: unchanged in what it verifies; the inbox note to a challenger without an account is skipped.
- `listMyChallenges`, consent and revoke stay account-only.
- The prune job treats both kinds alike.
- Its "Goal" and "Context" no longer say every link is bound to a real prediction: a `landing_tap` link is bound to a stored call of a verified waitlister, and says so in the view.

**A4 (receiving end).**

- The line table applies to both kinds; for `landing_tap` the price is the stored one.
- A signed-out visitor's action opens the waitlist capsule, not sign-up; the `challengeId` it stashes travels with the code request onto the reservation.
- "A sign-up after opening a link credits that challenger once" becomes "an account created by a waitlister who joined after opening a link credits that challenger once, when both have accounts".
- Its answer hook is seeded after account creation from `/waitlist/mine`, since the browser-side context does not survive the wait.

**B (landing calls, conversion).**

- Section 1 (recording): a call is buffered in the browser only until there is a reservation, then stored with it on the server; the price and time are the server's; the 7-day expiry is replaced by "until the market closes"; the limit of 10 stays.
- Section 2 (copy): unchanged.
- Section 3 (sheet): opens when an admitted waitlister creates the account, from `/waitlist/mine`, on any device. An existing account that signs in on a browser holding buffered calls keeps B's device path.
- Section 5 (challenge on the landing): replaced by section 2 above; `challengeIntentSeriesId` is no longer needed, since the link exists before sign-up. After conversion the same link continues, backed by the real position.
- Hand-off: the pending-onboarding payload no longer carries a waitlister's calls.
- "No new server surface" and the out-of-scope line about endpoints are superseded by this part.
- Rollout: before the first admission, not with the landing go-live.
- Its end-to-end tests gain the steps join, admit, create the account.

**A2 (preview)** reads the public view and needs only to tolerate a challenger without an avatar. **A3 (in-app action)** is unaffected.

### Out of scope

- The conversion sheet itself and how a call is placed: B.
- The receiving page: A4. Previews: A2.
- The deck, the Markets view and their copy: their own PRs.
- List order and the inviter email: W5.
- A consent switch in the capsule for showing the handle on a link (the action itself is "challenge a friend as @handle"; after account creation A1's consent applies).

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). #543 is adjacent to section 4. No issue is linked.

## Analytics

Instrument, server-side, with existing names:

- `challenge_created` (A1's server event) with `source: 'landing_tap'` and `marketId`.
- `challenge_opened`, `challenge_answered`, `referral_redeemed`: unchanged names; `source` tells the kinds apart where A4 and W3 emit them.
- No event per stored call: the landing analytics PR already records taps client-side, and one server row per tap would double them.

No handle, email or price is sent.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** One write per tap after joining, each with a registry lookup and one cached book read; bounded per reservation and per IP. The public read of a `landing_tap` link is one row plus one reservation lookup, no engine call.
- **Memory and storage.** At most ten rows of about 100 bytes per reservation; rows leave when their market closes. One nullable column, one text column and one index on `challenge_links`.
- **Scalability.** 100,000 reservations at the cap are one million small rows, read only by primary key. The prune is one dated `delete`.
- **Upgrade and compatibility.** One forward-only migration: the table, and the `challenge_links` changes (`add column if not exists`, `alter column ... drop not null`, the checks dropped and re-added, the index). The previous release keeps working: it never writes a row without a user and ignores `source`. No `.did`, no bindings, nothing breaking.
- **Security.** The price shown publicly on a link is read by the server, never sent by a client; the token that authorises a tap is the reservation's private token. A link exposes a handle its owner chose to share by creating it. Protected paths touched: `backend/src/db/**`, `backend/src/social/challenges.ts` and its trigger, `backend/src/account/referrals.ts` if section 4's window rule is accepted.
- **Parameters.** Call-size bounds: the VXP economy constants and their API mirror; ids: A1's `CHALLENGE_ID_*`; the referral window: `REFERRAL_SIGNUP_WINDOW_MS`.

## Implementation outline

1. Migration: `waitlist_taps`; the `challenge_links` changes.
2. `backend/src/waitlist/taps.ts`: `recordWaitlistTap`, `listTaps`, `clearMyTaps`, `pruneClosedTaps`, `createTapChallenge`, `attachLinksToAccount`.
3. `backend/src/social/challenges.ts`: the view for a row without a user, `kind`, the trigger's flip, `challenger_pending`.
4. Routes: `POST /waitlist/taps`, `POST /waitlist/challenge`, `DELETE /waitlist/mine/taps`; calls on the status and `mine` reads; the prune in `waitlist-prune`; `attachLinksToAccount` called from W3's end of hold; the deferred credit of section 4, if pending decision 1 is yes.
5. App: client wrappers; `waitlist.services.ts` (`recordCall`, `challengeLatestCall`, the flush after `confirm`, restore); the capsule's done-state action wired to it.
6. **Docs in the same PR:** `PRODUCT.md` ("Waitlist": calls kept, the link from a call; "Guest mode": landing calls of a waitlister are the stated exception to "preview picks never become positions", and only through B's confirmation), `docs/ai/economy.md` if section 4 changes the referral window, `backend/README.md`.

**Tests**

- `backend/tests/waitlist-taps.test.ts`: a tap needs a valid token, a listed open binary series and a size in bounds; the price stored is the server's whatever the body carries; one per series, the eleventh drops the oldest; closed markets are pruned; removal deletes calls and links; a link needs a stored call, is one per (reservation, series), follows a replaced call and reads "side changed"; the public read shows the reservation's handle and nothing from the query string; at account creation the link gains its owner and appears in "my challenges"; a real trade flips it to `position`; redeem on an ownerless link answers `challenger_pending`; the deferred credit is applied once when the inviter's account appears (if pending decision 1 is yes; otherwise an ownerless link credits nobody).
- `backend/tests/challenges.test.ts`: every existing case unchanged.
- E2E (`e2e-web2/waitlist-challenge.spec.ts`): tap, join, "Challenge a friend", open the link in a second browser and read the line; edit the URL's query and see no change; the friend joins and the inviter's reservation shows one invite.

**Rollout.** After W1 and A1, before the done state shows the action. Rollback: the previous image; stored calls and links stay and are ignored.

**Risks**

- **A link claims a call that is not a prediction.** "@handle called Yes at 38%" is true of a landing tap, not of a position. The view's `kind` lets the page word it honestly if the owner wants; today's line is the designed one.
- **The stored price is the price at storage**, not at the tap, for calls made before joining.
- **Two kinds in one table** widen A1's invariants; every A1 query that assumed a user must be revisited.
- **Behavioural data about people without accounts** now sits on the server, tied to an email. It is removed with the reservation and named in the policy.
- **Thin books.** A market with no executable price cannot give a stored price; such a tap is refused and the landing must say so.

## Acceptance criteria

- [ ] A waitlister's calls are on the server, at most ten, one per series, each with series, side, price, time and size, and are restored on another browser holding the token.
- [ ] The price and time stored are the server's; nothing the client sends sets them.
- [ ] Calls on a closed market are gone; calls and links go with a removed reservation.
- [ ] "Challenge a friend" yields `/c/<id>` showing the waitlister's handle and stored call; editing the address changes nothing shown.
- [ ] A friend who joins through that link is recorded on their reservation as invited by it.
- [ ] At account creation the stored calls are available to the conversion sheet on any device, and the links belong to the account.
- [ ] A converted call turns its link into an ordinary position link with the same id.
- [ ] Links issued by accounts behave exactly as before.
- [ ] The three challenge links drafts are updated as section 5 lists before their status moves on.
- [ ] `PRODUCT.md` describes the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Which server function gives the side-framed executable price of a series**, and is the cached read fresh enough to show publicly?
2. **Do the deck and Markets PRs already buffer taps**, in which module and shape?
3. **The call-size bounds on the API side** once the call-size spec lands.
4. **What does the done state show when the visitor has made no call?** The designed action needs one. This spec assumes the action then leads to the deck; the copy for that is not designed.
5. **Is A1 merged before this part starts?** It decides where the `challenge_links` changes land.

## Pending decisions

1. **When the inviter has no account yet, is the credit applied when their account appears?** The facts are known: `REFERRAL_SIGNUP_WINDOW_MS` counts from the friend's profile creation, and a waitlister's account can only appear after admission, which may come after the friend's.
   - Recommended: yes, with the window measured from the later of the two profile creations, applied once by the same function when the inviter's account is created (section 4). It keeps the owner decision that a sign-up through the link counts as challenge credit for every waitlister, not only for those admitted first.
   - Alternative A: no change to the referral rule. Credit only when the inviter already has an account; a waitlister admitted after the friend earns nothing from that invite, and the acceptance criteria say so.
   - Alternative B: a separate, smaller reward for deferred invites, outside the referral rule. Keeps the referral window untouched at the cost of a second reward to explain.

## Decisions

Owner decisions (27 Nov 2026):

- **Landing calls are stored on the server with the reservation**: at most 10, each with series, side, price, time and size, offered for conversion into real predictions at account creation if the market is still open. This replaces spec B's 7-day device storage.
- **The landing copy after a tap stays exactly as designed**: "You called Yes with 50 VXP. If you're right, you earn N VXP."; the Markets line stays "Calls open with the waitlist.".
- **The capsule's done state keeps "Challenge a friend"**: the link shows the waitlister's stored call, read from the server through a server-issued id bound to the reservation and the stored call, never from URL parameters. A sign-up through it counts as an invite and as challenge credit at account creation.

Author's choices (a reviewer may overrule):

- **Reuse `challenge_links` with a `source` discriminator** rather than a waitlist-side table. One id space keeps one `/c/<id>` route, one public read, one preview and one receiving page, and lets a waitlister's link carry on unchanged when it becomes an account's. A second table would need every one of those twice and a migration of rows at account creation. The cost is that A1's "every link has an account" invariant becomes "an account or a reservation".
- **The server reads the price.** A price sent by the browser and shown publicly under someone's handle would be exactly the forgeable link this work exists to remove.
- **Calls made before joining are stored at the price of the moment they are stored.**
- **No event per stored call.**
