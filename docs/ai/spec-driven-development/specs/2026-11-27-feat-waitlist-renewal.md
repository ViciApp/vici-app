# Spec: Waitlist, renew a reservation after twelve months

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W6** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W1.** Independent of the other parts; needed within eleven months of the first reservation. Implementation PR title: `feat(waitlist): renew a reservation after twelve months`.

## Goal

A reservation lasts twelve months. Before it ends the person receives one email asking whether they still want their handle held; one tap keeps it for another twelve months. Without an answer the reservation is removed at its end date and the handle is free again.

## Context

- **From W1.** `waitlist_reservations.expires_at` (set to twelve months after the first confirmation, `WAITLIST_HOLD_MONTHS`), `locale`, the email module (`backend/src/waitlist/emails.ts`, `email-copy/`), the remove link and its derived token, the public page pattern of `src/routes/waitlist/remove/+page.svelte`, the `waitlist-prune` job.
- **From W2**, when merged: an admitted reservation follows the 30-day claim window; a reservation with an account is kept for the gate.

## Scope

- A migration adds `renewal_notice_30_at timestamptz` and `renewal_notice_7_at timestamptz` to `waitlist_reservations`.
- **Who it applies to:** confirmed reservations that are neither admitted nor attached to an account.
- **The re-confirm emails**, at each of `WAITLIST_RENEWAL_NOTICE_DAYS` ([30, 7]) before `expires_at`, each once per cycle (its own stamp column: `renewal_notice_30_at`, `renewal_notice_7_at`), delivered through W1's `deliverOnce` with the key `renewal-<days>:<id>:<expires_at>`, so the stamp is written after the send, a crash at any point leaves the notice to a later run, and a retry is dropped by the provider if the first send went through; the 7-day one is skipped when the handle was already kept: the handle, the date the hold ends, a "keep my handle" link, the remove link. In the reservation's language, copy in every live locale.
- **The keep link**: `https://vici.app/waitlist/keep?r=<id>&t=<token>` with `token = peppered('waitlist-keep\n' + id + '\n' + expires_at)`, so a link is good for its own cycle only. It opens a public page (`src/routes/waitlist/keep/+page.svelte`) with one button; only the button's `POST /api/v1/waitlist/renew` (`{ id, token }`, IP-limited) renews: `expires_at` moves twelve months on and both notice stamps are cleared. The update is conditional, `where id = $1 and expires_at = $2 and expires_at > now()` with the end date the token was checked against: a press after the end date answers `410 { error: 'expired' }` and changes nothing, even while the hourly job has not yet deleted the row, so a lapsed reservation cannot be brought back. A mail scanner opening the link renews nothing.
- **No answer:** at `expires_at` the row is deleted by the hourly job (`waitlist-renewal`, which also sends the notices): the handle is free, the calls and links of W4 go with it, the mailbox can join again. No further email is sent.
- **Every notice goes out before the end date.** Each run takes due rows by `expires_at` ascending, so the nearest end dates go first, and sends batches of `WAITLIST_RENEWAL_EMAILS_PER_RUN` until no due row is left or the run's time budget is spent. The batch and the budget are sized from the provider's rate so that one day of runs clears the largest cohort a single day can produce (the most confirmations ever recorded on one day, times two notices), with the 30-day head start as margin. Each run logs the due rows it left; a row within 48 hours of its end date with no notice sent logs an error the alerting picks up. The delete takes only rows that received at least one notice: a row that reaches its end date with none is kept, logged, notified on the next run, and its end date is moved to seven days after that notice, so nobody loses a handle to a notice that never left.
- **Admission resets nothing here:** a reservation admitted while a notice is out simply leaves this part's scope.
- W1's status read answers `not_found` afterwards, so the landing stops showing the handle.

### Out of scope

- A second notice, or a grace period after the end date.
- Renewing from the capsule.
- Reservations that are admitted or have an account.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). None is related. No issue is linked.

## Analytics

Instrument, server-side:

- `waitlist_renewed` (addition to the taxonomy, both halves of the app pair and both lists in `backend/src/analytics/taxonomy.ts`): a renewal succeeded; props `value` (days before the end date).
- `waitlist_lapsed` (W2's name; added here if W2 has not landed): one per job run that removed rows; `count`, `label: 'expired'`.

No `userId`, no email, no handle.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** One hourly job with two dated, indexed scans (`expires_at`); emails in bounded batches, earliest end date first, within a time budget per run.
- **Memory and storage.** Two nullable columns; an index on `expires_at` if W1 did not add it. Delivery rows live in W1's `waitlist_email_deliveries` and are pruned there.
- **Scalability.** A large first cohort expires within the same days a year later. The notices start 30 days ahead, each run drains the due set earliest first, and the batch is sized so a day of runs covers the busiest day of confirmations; the logged backlog and the 48-hour alert show it before anyone is affected.
- **Upgrade and compatibility.** One forward-only migration (`add column if not exists`). Nothing breaking.
- **Security.** The keep token is an HMAC under the session pepper, bound to the row and its current end date; renewal changes nothing but that date. The route is public and IP-limited.
- **Parameters.** `WAITLIST_HOLD_MONTHS` (W1), `WAITLIST_RENEWAL_NOTICE_DAYS`, `WAITLIST_RENEWAL_EMAILS_PER_RUN` and the run's time budget: named constants in `backend/src/waitlist/renewal.ts`.

## Implementation outline

1. Migration `NNNN_waitlist_renewal.sql`.
2. `backend/src/waitlist/renewal.ts`: constants, `sendRenewalNotices`, `renewReservation`, `removeExpiredReservations`.
3. The re-confirm builder and its copy in every live locale; `POST /waitlist/renew`; the job in `backend/src/worker.ts`.
4. App: the keep page, its public path in `src/lib/constants/routes.constants.ts`, the client wrapper, i18n keys `waitlist.keep.*` in every catalog.
5. **Docs in the same PR:** `PRODUCT.md` ("Waitlist": how long a handle is held and how to keep it), `backend/README.md`.

**Tests** (`backend/tests/waitlist-renewal.test.ts`): the first notice goes once 30 days ahead and the second once 7 days ahead (skipped after a keep), in the row's language, and not to admitted rows or rows with an account; a failed send is retried and a send interrupted after the claim is retried once the lease ends; the earliest end dates are notified first; a row with no notice sent is not deleted at its end date; opening the link changes nothing; a press after the end date answers `expired` and does not renew, also before the row is deleted; the button renews for twelve months and a second press with the same link is refused; a link from an earlier cycle is refused; an unanswered row is deleted at its end date and its handle can be reserved again; a second job run does nothing.

**Rollout.** Any time within eleven months of the first reservation. Rollback: the previous image; reservations then simply do not expire.

**Risks**

- **One email decides.** A notice lost to spam costs the person their handle with no second warning.
- **A cohort that joined on launch day expires together**, and the handles it frees become available on one day, known in advance to anyone watching.

## Acceptance criteria

- [ ] A waiting reservation gets a re-confirm email 30 days and another 7 days before its twelve months end (the second only if not yet kept), in its language.
- [ ] Pressing the button on the linked page extends the hold by twelve months; opening the link alone does not, and neither does a press after the end date.
- [ ] No reservation is removed without having received a notice.
- [ ] A reservation not renewed is removed at its end date and its handle is free.
- [ ] Admitted reservations and those with an account are never notified or removed by this part.
- [ ] `PRODUCT.md` describes the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` pass.

## Open questions

1. **Counsel**: the policy's retention sentence must match (twelve months, renewable).

## Decisions

Owner decision (27 Nov 2026): **a reservation lasts 12 months, then a re-confirm email; if there is no response, it is released.**

Owner decision (27 Nov 2026): **two re-confirm emails, 30 days and 7 days before the end; the second is skipped if the person already kept the handle.**

Author's choices (a reviewer may overrule): the keep link is bound to its cycle and needs a button press; admitted reservations and those with an account are outside this clock.
