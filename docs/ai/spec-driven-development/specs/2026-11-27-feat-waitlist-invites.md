# Spec: Waitlist, invites move the inviter up the list

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W5** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W2** (the list and "admit next N"). A waitlister's own link comes from W4; without W4 this part still counts and reports, but waitlisters have nothing to share. Implementation PR title: `feat(waitlist): invites move the inviter up the list`.

## Goal

Each friend who joins the waitlist through a waitlister's link moves that waitlister up the list, by a fixed number of places per friend up to a cap. The admin list shows each person's rank and invite counts, and "admit next N" follows the rank. The inviter is told by email, in their language, at most once a day, that friends joined through their link. The public page shows no position number.

## Context

- **From W1.** `waitlist_reservations` with `email_key` (one row per mailbox, aliases folded, disposable domains refused), `confirmed_at`, `locale`, `invited_referral_code`, `invited_challenge_id`; the email module; the remove link.
- **From W2.** `waitlistOrder` in `backend/src/waitlist/admission.ts`, the one function the admin list and `admitNextReservations` read; today it is arrival order. The admin page `AdminWaitlist.svelte`.
- **From W4.** A waitlister's link is a `challenge_links` row with `reservation_id`; a friend's reservation names it in `invited_challenge_id`.
- **Account holders' links** (`/i/<code>`, `?ref=`, a position challenge link) also bring friends to the waitlist while sign-up is closed (W3). Their owners are not on the list, so there is nothing to move; they can still be told.
- **Worker.** `jobs` in `backend/src/worker.ts`.

## Scope

### 1. Who invited whom

A migration adds to `waitlist_reservations`: `invited_by_reservation_id uuid references waitlist_reservations (id) on delete set null`, `invite_notified_at timestamptz`, `last_invite_notice_at timestamptz`, `invite_notices_off boolean not null default false`, and an index on `(invited_by_reservation_id)`.

`invited_by_reservation_id` is written at the friend's first confirmation, from `invited_challenge_id` when that link has a `reservation_id` other than the friend's own. Before that confirmation the stash follows W1's rule, the last link the visitor arrived through (owner decision W1.12): opening link A then link B before confirming credits B. From the first confirmation on it is never changed: confirming again with another handle, or arriving later through another link, does not move the invite. W1, W3 and this spec use the same rule: last link before the first confirmation, fixed after it.

### 2. Which friends count

A friend counts for an inviter when the friend's reservation:

- is **confirmed** (a verified email);
- is on a mailbox that is **not disposable** and **distinct after alias folding** (both guaranteed by W1's uniqueness on `email_key`, so ten `+tag` variants of one inbox are one reservation, not ten);
- **still exists**: a friend who is removed, or whose reservation lapses, stops counting; a friend who goes on to create an account keeps counting.

An inviter cannot count themselves: their own mailbox has one reservation.

### 3. The rank

- **Arrival number**: a person's place among waiting reservations ordered by `confirmed_at`, then `id`.
- **Rank** = arrival number minus `WAITLIST_INVITE_PLACES` × min(counted friends, `WAITLIST_INVITE_MAX_COUNTED`). The list is ordered by rank ascending, ties broken by arrival.
- The two values are pending decision 1 (recommended: 10 places per friend, at most 10 friends counted, so at most 100 places gained).
- `waitlistOrder` becomes this order, computed in one query with a window function over waiting rows and a grouped count of friends. The admin list and "admit next N" pick it up together.
- A rank is never stored: it changes whenever anyone joins, is admitted or is removed.

**Why the cap is the defence.** Verified, folded, non-disposable mailboxes make each fake friend cost a real inbox; the cap bounds what any number of them can buy; the admin list shows the counts so a cluster is visible and removable. No IP is stored, so friends are not grouped by network.

### 4. Admin list

`GET /waitlist/admin/reservations` adds to each row: `rank`, `arrivalNumber`, `invitesCounted`, `invitesTotal`, and whether the person was themselves invited. `AdminWaitlist.svelte` shows rank and both counts, sorts by rank, and can filter to people with invites.

### 5. Telling the inviter

- One hourly job, `waitlist-invite-digest`: for each inviter with at least one friend whose `invite_notified_at` is null, and whose own `last_invite_notice_at` is null or more than a day old, and who has not turned the notices off: send one email through W1's `deliverOnce` with the key `invite-digest:<inviter id>:<last_invite_notice_at or 0>`. The digest covers the friends confirmed before the delivery row's `created_at`, so a retry reports the same friends; after the send, the same transaction stamps exactly those friends' `invite_notified_at` and the inviter's `last_invite_notice_at`. A crash before the send leaves the friends unstamped for a later run, and a crash after it re-sends under the same key, which the provider drops.
- **At most one email per inviter per day**, whatever the number of friends: the email states how many joined since the last one and that they moved up the list. It names no friend and states no position.
- In the inviter's `locale`, copy in every live locale, with the remove link. For a reservation that already has an account, that link turns these notices off (W1).
- **Inviters who have an account** (the owner of a referral code or of a position challenge link that a friend's reservation names): the same digest, to the account's sign-in address, once the three facts of open question 1 are settled; until then the job covers waitlisters only and the account holder learns of the friend when the credit is applied (W3).

### Out of scope

- Any position or progress shown to visitors on the public page.
- VXP for invites: credit is the existing referral reward, applied at account creation (W3, W4).
- Automatic admission by rank.
- Naming friends to the inviter.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). #543 (anti-farm) is adjacent in spirit: this part's reward is list position, not VXP, and has its own cap. No issue is linked.

## Analytics

Instrument, server-side:

- `waitlist_joined` (W1) is unchanged: its `ok` already says the person arrived through a link.
- `waitlist_invite_counted` (addition to the taxonomy): one per friend whose confirmation set `invited_by_reservation_id`; props `ok` (the inviter was under the cap, so the friend moved them).
- `waitlist_invite_notice_sent` (addition): one per digest; props `count` (friends reported).

No `userId`, no email, no handle.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** The rank query runs for each admin list page and each "admit next" call: a window function over waiting rows joined to a grouped count. At 100,000 rows it is a few hundred milliseconds, on admin actions only; nothing on a visitor's path computes a rank. The digest job reads by index and sends a bounded batch per run.
- **Memory and storage.** Four columns and one index on an existing table.
- **Scalability.** If the list outgrows an on-demand rank (millions of rows), a materialised rank refreshed by the worker replaces the query behind the same function.
- **Upgrade and compatibility.** One forward-only migration (`add column if not exists`). The previous release ignores the columns and keeps arrival order. No `.did`, no bindings, nothing breaking.
- **Security.** The rank is admin-only. The reward cannot be farmed past the cap. Protected paths touched: `backend/src/db/**`, `backend/src/worker.ts`.
- **Parameters.** `WAITLIST_INVITE_PLACES`, `WAITLIST_INVITE_MAX_COUNTED`, `WAITLIST_INVITE_NOTICE_INTERVAL_MS` in `backend/src/waitlist/invites.ts`.

## Implementation outline

1. Migration `NNNN_waitlist_invites.sql`.
2. `backend/src/waitlist/invites.ts`: constants, `recordInviter` (called from W1's confirmation), `rankedWaitlist` (the query behind `waitlistOrder`), `sendInviteDigests`.
3. The admin list fields; the digest job; the digest builder and its copy in every live locale; the notices-off behaviour of the remove link.
4. App: the list's columns, sort and filter; i18n keys `admin.waitlist.*`.
5. **Docs in the same PR:** `PRODUCT.md` ("Waitlist": how invites change the order, what the inviter is told), `backend/README.md`.

**Tests**

- `backend/tests/waitlist-invites.test.ts`: a friend's first confirmation records the inviter and a later one does not change it; an unconfirmed friend does not count; a removed friend stops counting; alias variants of one mailbox are one friend; the rank for zero, some and more than the cap of friends, with ties by arrival; "admit next N" follows the rank; the admin list returns rank and counts; one digest for several friends, none within a day of the last, none when turned off, a failed send retried, the count in the copy, the inviter's language.
- E2E: two friends join through a waitlister's link and the admin list shows that waitlister above someone who arrived earlier.

**Rollout.** After W2. Ranks apply from the first deploy to everyone already on the list, since nothing is stored. Rollback: the previous image returns to arrival order.

**Risks**

- **The numbers are guesses.** Ten places means a lot on a list of 500 and nothing on a list of 50,000 (pending decision 1).
- **People who do not invite are overtaken**, by at most the cap per inviter ahead of them; nobody is told their position, so nobody sees it move back.
- **Farming with real inboxes** stays possible up to the cap; the admin list is the only detection.
- **A daily email to someone who invited many** is still one email a day until they turn it off.

## Acceptance criteria

- [ ] A friend who confirms after arriving through a waitlister's link is recorded once as invited by that waitlister.
- [ ] Only confirmed friends on distinct, non-disposable mailboxes count, and only while their reservation exists.
- [ ] Each counted friend moves the inviter up by the configured places, up to the cap; beyond it more friends change nothing.
- [ ] The admin list shows rank, arrival number and invite counts, and "admit next N" admits in rank order.
- [ ] The public page shows no position.
- [ ] An inviter receives at most one email a day about friends who joined, in their language, naming none of them, and can turn it off from the email.
- [ ] `PRODUCT.md` describes the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e` pass.

## Open questions

1. **Emailing inviters who already have an account**: may the app email an account holder about invites (it sends them no notification email today), where is their language kept on the server, and how do they turn it off?
2. **Should a friend brought by an account holder's link count for anyone on the list?** This spec says no: the inviter is not on it.
3. **Counsel**: the digest is sent under the waitlist consent; confirm.

## Pending decisions

1. **Places per friend and friends counted** (`WAITLIST_INVITE_PLACES`, `WAITLIST_INVITE_MAX_COUNTED`). Rank, the order of "admit next N" and how much farming can buy all follow from them; they must be set before this part is implemented.
   - Recommended: 10 places per friend, at most 10 friends counted (at most 100 places). Visible on a list of a few thousand, small enough that a farmed cluster cannot jump the whole list.
   - Alternative A: 25 places, at most 4 friends. The same ceiling, weighted to the first few invites, which most people stop at.
   - Alternative B: a share of the list (for example 1% per friend). Set aside by the author: its value changes as the list grows, so the rule cannot be told in one sentence.

## Decisions

Owner decisions (27 Nov 2026):

- **Each friend who joins through a waitlister's link moves the inviter up the list**, with a cap against farming, counting only friends with a verified email who are not disposable. The admin list shows the rank and the invite counts. No position number on the public page.
- **The inviter is notified by email when friends join through their link, at most one email per day per inviter (a digest), in the inviter's language.**

Author's choices (a reviewer may overrule):

- **Arrival number minus a fixed number of places per counted friend**, not a score. It is the rule a person can be told in one sentence, and the cap is a plain number.
- **The rank is computed, not stored**, so it is always consistent with who is on the list.
- **A friend counts while their reservation exists**, including after they get an account: removing fake friends undoes the gain, and a real friend's admission does not cost the inviter.
- **The digest counts and does not name.** A friend did not agree to be named to the inviter.
- **The first invite wins and is never rewritten**, so a second link cannot move a friend from one inviter to another.
