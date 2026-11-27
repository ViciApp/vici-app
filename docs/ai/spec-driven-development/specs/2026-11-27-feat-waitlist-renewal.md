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

- A migration adds `renewal_email_sent_at timestamptz` to `waitlist_reservations`.
- **Who it applies to:** confirmed reservations that are neither admitted nor attached to an account.
- **The re-confirm email**, `WAITLIST_RENEWAL_NOTICE_DAYS` (30) before `expires_at`, once per cycle, stamped before the send and cleared on failure: the handle, the date the hold ends, a "keep my handle" link, the remove link. In the reservation's language, copy in every live locale.
- **The keep link**: `https://vici.app/waitlist/keep?r=<id>&t=<token>` with `token = peppered('waitlist-keep\n' + id + '\n' + expires_at)`, so a link is good for its own cycle only. It opens a public page (`src/routes/waitlist/keep/+page.svelte`) with one button; only the button's `POST /api/v1/waitlist/renew` (`{ id, token }`, IP-limited) renews: `expires_at` moves twelve months on and `renewal_email_sent_at` is cleared. A mail scanner opening the link renews nothing.
- **No answer:** at `expires_at` the row is deleted by the hourly job (`waitlist-renewal`, which also sends the notices): the handle is free, the calls and links of W4 go with it, the mailbox can join again. No further email is sent.
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

- **Performance.** One hourly job with two dated, indexed scans (`expires_at`); a bounded batch of emails per run.
- **Memory and storage.** One nullable column; an index on `expires_at` if W1 did not add it.
- **Scalability.** A large first cohort expires within the same days a year later: the email batch size spreads the notices, which is why they start 30 days ahead.
- **Upgrade and compatibility.** One forward-only migration (`add column if not exists`). Nothing breaking.
- **Security.** The keep token is an HMAC under the session pepper, bound to the row and its current end date; renewal changes nothing but that date. The route is public and IP-limited.
- **Parameters.** `WAITLIST_HOLD_MONTHS` (W1), `WAITLIST_RENEWAL_NOTICE_DAYS`, the batch size: named constants in `backend/src/waitlist/renewal.ts`.

## Implementation outline

1. Migration `NNNN_waitlist_renewal.sql`.
2. `backend/src/waitlist/renewal.ts`: constants, `sendRenewalNotices`, `renewReservation`, `removeExpiredReservations`.
3. The re-confirm builder and its copy in every live locale; `POST /waitlist/renew`; the job in `backend/src/worker.ts`.
4. App: the keep page, its public path in `src/lib/constants/routes.constants.ts`, the client wrapper, i18n keys `waitlist.keep.*` in every catalog.
5. **Docs in the same PR:** `PRODUCT.md` ("Waitlist": how long a handle is held and how to keep it), `backend/README.md`.

**Tests** (`backend/tests/waitlist-renewal.test.ts`): a notice goes once, 30 days ahead, in the row's language, and not to admitted rows or rows with an account; a failed send is retried; opening the link changes nothing; the button renews for twelve months and a second press with the same link is refused; a link from an earlier cycle is refused; an unanswered row is deleted at its end date and its handle can be reserved again; a second job run does nothing.

**Rollout.** Any time within eleven months of the first reservation. Rollback: the previous image; reservations then simply do not expire.

**Risks**

- **One email decides.** A notice lost to spam costs the person their handle with no second warning.
- **A cohort that joined on launch day expires together**, and the handles it frees become available on one day, known in advance to anyone watching.

## Acceptance criteria

- [ ] A waiting reservation gets one re-confirm email 30 days before its twelve months end, in its language.
- [ ] Pressing the button on the linked page extends the hold by twelve months; opening the link alone does not.
- [ ] A reservation not renewed is removed at its end date and its handle is free.
- [ ] Admitted reservations and those with an account are never notified or removed by this part.
- [ ] `PRODUCT.md` describes the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` pass.

## Open questions

1. **How long before the end the email goes** (30 days proposed) and whether one email is enough.
2. **Counsel**: the policy's retention sentence must match (twelve months, renewable).

## Decisions

Owner decision (27 Nov 2026): **a reservation lasts 12 months, then a re-confirm email; if there is no response, it is released.**

Author's choices (a reviewer may overrule): the notice goes 30 days ahead and once; the keep link is bound to its cycle and needs a button press; admitted reservations and those with an account are outside this clock.
