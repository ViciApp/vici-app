# Spec: Waitlist admission from the admin access page

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W2** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W1.** Buildable in parallel with W3. Must be merged, with W3, before the first person is admitted. Implementation PR title: `feat(waitlist): admit waitlisters from the admin access page`.

## Goal

An admin opens the access page, sees who is on the waitlist, and admits people: a chosen few, or the next N in order of arrival. An admitted person receives one email saying their handle is ready, and from then on the beta gate lets their email sign in, with any provider that proves that email. Everyone else stays outside exactly as today.

## Context

- **The gate.** `betaGateVerdict` in `backend/src/auth/beta-gate.ts` reads the `beta_gate` app setting (`{ enabled, emails, allowNewUsers }`) and is called at every point a sign-in learns the caller's email: `POST /auth/otp/request`, `POST /auth/otp/verify`, and the Google and Apple callbacks (`backend/src/routes/auth.ts`). Off, everyone passes. On, allowlisted addresses pass; with `allowNewUsers` an existing account passes, a legacy address gets `legacy_account_pending`, anyone else passes. Without `allowNewUsers` nobody outside the allowlist passes, **including people who already have an account**. Refusals are `403 { error: 'beta_closed' }` or a redirect to `/signin?e=beta`, the same for every address. The behaviour is documented in `backend/README.md` ("Beta access gate") and tested in `backend/tests/beta-gate.test.ts` and `e2e-web2/beta-gate.spec.ts`.
- **The setting has no screen.** It is written through the generic settings routes (`PUT /api/v1/admin/settings/beta_gate`, `backend/src/routes/admin.ts`, `backend/src/admin/settings.ts`). The app has no page that reads or writes it. `src/routes/(app)/admin/access/+page.svelte` renders `src/lib/components/pages/AdminAccessPage.svelte`, which today manages roles and oracles only, built from `src/lib/components/admin/` (`AdminSubPageHeader`, `AdminList`, `AdminAddForm`).
- **The allowlist is a JSON array** inside one settings row, read on every sign-in attempt and scanned linearly. It suits a handful of testers, not a waitlist: a write replaces the whole array, so two admins saving at once lose one change.
- **From W1.** `waitlist_reservations` (one row per email, `handle`, `confirmed_at`, `source`, attribution, `claimed_at`), `deleteWaitlistReservation`, the admin delete route, the status read.
- **Email.** `sendEmail` in `backend/src/lib/email.ts`: transactional, English, one message per call, no batch or list sending. `setEmailTransport` is the test seam.
- **Admin guards.** `requireUser` then `requireAdmin` (`backend/src/auth/guard.ts`), 401 and 403 kept apart.
- **Worker.** `jobs` in `backend/src/worker.ts`; a job is idempotent through the schema.
- **Sign-in refusal copy.** `signin.beta_closed` in every catalog under `src/lib/constants/messages/`; `docs/ai/frontend/web2-backend-mode.md` describes how `/signin` renders it.

## Scope

### 1. Admission

- A migration adds to `waitlist_reservations`: `admitted_at timestamptz`, `admitted_by uuid references users (id) on delete set null`, `admission_email_sent_at timestamptz`, `claim_reminder_sent_at timestamptz`, and an index on `(admitted_at)` for the lapse sweep.
- `admitReservations({ ids, adminId })` and `admitNextReservations({ count, adminId })` in `backend/src/waitlist/admission.ts`: set `admitted_at` and `admitted_by` on confirmed, not yet admitted rows, with `update ... where admitted_at is null returning`, so a repeat or two admins at once admit each person once. "Next" is by `confirmed_at`, then `id`.
- **Admission cannot be undone, removal can.** Removing a reservation (W1's delete) withdraws the admission with it, as long as the account has not been created.

### 2. The gate

`betaGateVerdict` gains one rule, checked right after the allowlist and before the `allowNewUsers` branch: **an address with an admitted reservation is allowed.** One indexed lookup on `waitlist_reservations (email)`.

- It holds whatever provider proves the address: the email code, Google, Apple. A provider that hides the real address (Apple's relay) does not match and is refused like any other unknown address.
- It keeps holding after the account exists, because in strict mode the gate does not pass existing accounts by itself: the admitted row is what lets the person sign in again tomorrow. The row therefore stays after the claim (W3) and goes with the account when it is purged (W1).
- The gate off, the allowlist and `allowNewUsers` behave exactly as before. With the gate off or with `allowNewUsers`, people who never joined the list can sign up too; reservations still protect their handles.
- **Required state for a waitlist to mean anything:** `enabled: true`, `allowNewUsers` not `true`. The admin page shows the current state so an admin can see when admissions have no effect (section 5).

### 3. The admission email

- One email per admitted person, sent by a worker job (`waitlist-admission-emails`, every tick): rows with `admitted_at` set and `admission_email_sent_at` null, a bounded batch per tick (`WAITLIST_ADMISSION_EMAILS_PER_TICK`), each stamped in the same statement that selects it for sending (`update ... set admission_email_sent_at = now() where id = $1 and admission_email_sent_at is null returning`), so a second run or a second machine never sends twice. A send that fails clears the stamp for a later tick and is logged.
- Content: the handle, that the account can now be created, a link to the app's sign-in with the address to use, the date the hold ends (section 4), and how to be removed. English (pending decision 2). `sendWaitlistAdmissionEmail` in `backend/src/lib/email.ts`.
- The link carries nothing that signs anyone in: the person proves the address again with a code or a provider.

### 4. Admitted and never claimed

- A reservation admitted `WAITLIST_CLAIM_WINDOW_DAYS` ago and still unclaimed lapses: the row is deleted, the handle is free, the gate no longer admits the address. The person can join the list again.
- One reminder `WAITLIST_CLAIM_REMINDER_DAYS_BEFORE` days before the lapse, stamped in `claim_reminder_sent_at` the same way as the admission email.
- Both run in one hourly job (`waitlist-claim-window`); the delete is a `where` on dates, harmless to repeat.
- The values are pending decision 3. Rows never admitted are not touched by this job (W1, pending decision 6).

### 5. Admin routes

In `backend/src/routes/waitlist.ts`, under `/api/v1/waitlist/admin`, all behind `requireUser` then `requireAdmin`:

| Route                  | Does                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /summary`         | counts: waiting, admitted and not yet joined, joined; the oldest waiting date; the gate's state (`enabled`, `allowNewUsers`) read from the setting                                                                                  |
| `GET /reservations`    | a page of rows (`state` filter, `q` matched as a prefix on email or handle key, keyset cursor on `confirmed_at, id`, `limit` capped by `WAITLIST_ADMIN_PAGE_MAX`): email, handle, source, whether an invite brought them, the dates |
| `POST /admit`          | body `{ ids }` (uuids checked with `UUID_RE`, `maxItems` `WAITLIST_ADMIT_MAX_BATCH`) or `{ next }` (`t.Integer`, same bound); answers `{ admitted }`                                                                                |
| `DELETE /reservations` | W1's delete, unchanged                                                                                                                                                                                                              |

Unconfirmed rows are never listed: an address nobody has proven is not shown to anyone.

### 6. Admin screen

A "Waitlist" section on `AdminAccessPage.svelte`, as `src/lib/components/admin/AdminWaitlist.svelte` (web2 build only, hidden on the default backend):

- the three counts and a line stating the gate's state, with a warning when admissions currently have no effect;
- a searchable, paged list (email, handle, joined date, state), rows selectable;
- "Admit selected" and "Admit next" with a number field, each behind a confirmation that states how many emails will be sent;
- "Remove" per row, behind a confirmation that says the handle is released and the person's data deleted.

Service `src/lib/services/waitlist-admin.services.ts`, wrappers in `src/lib/web2/client.ts`, i18n keys `admin.waitlist.*` in every catalog. Reuse the page's existing pieces before adding any (`docs/ai/frontend/reusability.md`).

### 7. What a refused person reads

`signin.beta_closed` is the same line for every refused address and stays so. Its wording changes to point at the waitlist (pending decision 4), in every catalog. Nothing in the refusal says whether the address is on the list.

### Out of scope

- Editing the gate's switches or the allowlist from the admin page (pending decision 5).
- Automatic admission of any kind (pending decision 1).
- Exporting the list.
- Queue positions shown to visitors, and any effect of invites on the order.
- The handle claim and onboarding: W3.
- Localised emails.

## Linked issues

Open issues were searched on 26 Nov 2026 (six open). None covers admission, the beta gate or the admin access page. No issue is linked.

## Analytics

Instrument, server-side, with two additions to the taxonomy (both halves of the app pair and both lists in `backend/src/analytics/taxonomy.ts`):

| Event               | When                                   | Props                                                                  |
| ------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `waitlist_admitted` | an admit call changed at least one row | `count` (people admitted by the call), `source` (`selected` or `next`) |
| `waitlist_lapsed`   | the claim-window job removed rows      | `count`                                                                |

One event per call or per job run, never per person, and no `userId` of the admitted person (there is none). The admin's id is not attached either: who admitted whom is in `admitted_by`, an operational record, not product analytics. Removals by an admin are not tracked as analytics for the same reason. Email opens and clicks are not tracked.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** The gate adds one index-only lookup to each sign-in attempt that is not already allowlisted. An admit call is one `update` over at most `WAITLIST_ADMIT_MAX_BATCH` rows. The email job sends a bounded batch per tick, sized under the provider's rate (W1 open question 3). The list read is keyset-paged; the summary is three counts over one table.
- **Memory and storage.** Four nullable columns and one index on an existing table. No growth of its own.
- **Scalability.** At 100,000 rows the list stays paged and the gate lookup stays O(1). Admitting 10,000 people is twenty calls of 500 and drains through the email job at the configured rate; the page states how long that takes.
- **Upgrade and compatibility.** One forward-only migration (`add column if not exists`). The previous release ignores the columns. The gate change is additive: no existing verdict changes for an address without an admitted reservation, pinned by the existing `beta-gate.test.ts` cases passing unchanged. No `.did`, no bindings, nothing breaking.
- **Security.** The gate is a rollout valve, not a security boundary, and stays one. New admin routes expose email addresses to admins only; the list never includes unconfirmed rows. Protected paths touched: `backend/src/auth/beta-gate.ts`, `backend/src/db/**`, `backend/src/routes/waitlist.ts` (admin routes), `backend/src/lib/email.ts`, `backend/src/worker.ts`.
- **Parameters.** Every figure is a named constant in `backend/src/waitlist/admission.ts`; the email copy derives the hold's end date from `WAITLIST_CLAIM_WINDOW_DAYS`, never from a literal.

## Implementation outline

1. Migration `NNNN_waitlist_admission.sql` (the next free number), with the why at the top.
2. `backend/src/waitlist/admission.ts`: constants, `admitReservations`, `admitNextReservations`, `listReservations`, `summariseWaitlist`, `sendPendingAdmissionEmails`, `runClaimWindow`, `isAdmittedEmail`.
3. `betaGateVerdict`: the admitted rule; the header comment and `backend/README.md` ("Beta access gate", verdict table) updated.
4. `sendWaitlistAdmissionEmail`, `sendWaitlistClaimReminderEmail` in `backend/src/lib/email.ts`.
5. Admin routes; two worker jobs with their one-line idempotency comments.
6. W1's status read answers `admitted` for an admitted, unclaimed row, so the landing can tell a returning visitor.
7. App: client wrappers, `waitlist-admin.services.ts`, `AdminWaitlist.svelte`, the section on `AdminAccessPage.svelte`, `admin.waitlist.*` and the changed `signin.beta_closed` in every catalog.
8. **Docs in the same PR:** `PRODUCT.md` (a "Waitlist: admission" entry: who gets in, the email, the claim window), `backend/README.md`, `docs/ai/frontend/web2-backend-mode.md` (the refusal copy), `docs/ai/frontend/testing.md` if the E2E fixtures change.

**Tests**

- `backend/tests/waitlist-admission.test.ts`: admit by ids and by next (order by confirmation), each idempotent; unconfirmed and already admitted rows are skipped; 401 and 403 on every admin route; a malformed id is a 400, not a 500; the list pages without gaps or repeats and never returns an unconfirmed row; the summary counts.
- `backend/tests/beta-gate.test.ts`: with the gate on and strict, an admitted address passes at the code request, the code verification and the Google and Apple callbacks; a waiting address is refused with `beta_closed`; a removed reservation is refused again; an admitted address that already created its account still passes; every existing case unchanged.
- Email job: one run sends each pending email once and stamps it, a second sends nothing, a failing transport leaves the row to be retried; the copy names the handle and the hold's end date.
- Claim window: a row past the window is deleted and its handle reservable again; a claimed row is never deleted; the reminder goes once.
- E2E (`e2e-web2/waitlist-admission.spec.ts`): an admin admits a waiting person from the access page; that person's sign-in, refused before, now succeeds; the email is read from the E2E transport.

**Rollout.** Ship with the gate in its required state already set (W1 open question 2). Admit a small first batch and watch delivery before larger ones. Rollback: the previous image; admitted rows remain but the gate stops honouring them, so admitted people who have not signed in are refused until the code returns, and those in strict mode who already created an account are refused at their next sign-in. That second effect is why the first batches should be small.

**Risks**

- **Strict mode locks out returning users without the admitted rule.** This spec makes the admitted row the thing that keeps them signing in; deleting such a row by hand, outside the purge, locks its owner out.
- **Bulk email from a domain that has only sent codes.** A large first admission can hurt deliverability; the per-tick batch is the brake.
- **Admin sees personal data.** The list shows email addresses; access is the admin role, and nothing is exported.
- **Legacy addresses.** In strict mode a legacy user's sign-in reads `beta_closed`, not `legacy_account_pending` (that branch needs `allowNewUsers`). If W1's pending decision 4 keeps legacy addresses off the list, they can only be let in through the allowlist until cutover.
- **A person admitted to a different address than the one they sign in with** (a Google account under another email) is refused and reads the generic line. The admission email names the address to use.

## Acceptance criteria

- [ ] An admin can see counts and a searchable, paged list of confirmed reservations; unconfirmed addresses never appear.
- [ ] An admin can admit chosen people or the next N by arrival; doing it twice admits nobody twice.
- [ ] Each admitted person gets one admission email, never two, naming their handle and the date the hold ends; a failed send is retried.
- [ ] With the gate on and strict, an admitted address can sign in with the email code and with any provider asserting that address; a waiting address cannot.
- [ ] An admitted person who created their account can sign in again on a later day.
- [ ] Removing a reservation before the account exists closes the gate for that address again and frees the handle.
- [ ] An admitted reservation not claimed within the window is removed after one reminder; its handle is free.
- [ ] Every gate behaviour that existed before is unchanged for addresses without an admitted reservation.
- [ ] The page says when the gate's state makes admissions pointless.
- [ ] `PRODUCT.md` and `backend/README.md` describe the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **The gate's production state and who is on the allowlist today** (W1 open question 2): admissions only mean something with the gate on and strict.
2. **Does the admin access page work on the web2 build today** (`listRoles` and the oracle manager against the API)? If part of it is default-backend only, the waitlist section still has to render alone.
3. **Worker tick length and the email provider's rate**, to size `WAITLIST_ADMISSION_EMAILS_PER_TICK`.
4. **Counsel**: the admission email and the reminder are sent under the consent given at the waitlist; confirm the wording and that one reminder is covered.
5. **Does the E2E server expose sent emails beyond sign-in codes** (`GET /__e2e/otp/:email`), or does the suite need a second read?

## Pending decisions

1. **How people are admitted.** Recommended: by hand, by an admin, either chosen people or "the next N" in order of arrival. Alternatives: an automatic daily number; or no admission step at all, opening sign-up to everyone at once by switching the gate (reservations then only protect handles).
2. **The admission email's language.** Recommended: English only for the first release, and the waitlist stores no language. Alternative: store the visitor's app language when they join and write in it (seven languages of email copy to maintain, one more stored field per person).
3. **How long an admitted person has to create the account.** Recommended: 30 days, with one reminder 7 days before the end; after that the handle is released and they can join again. Alternatives: no time limit; a shorter window (14 days); no reminder.
4. **What a refused sign-in says.** Recommended: one line for everyone that points to the waitlist, for example "VICI is opening in waves. Reserve your handle to join the waitlist.". Alternative: keep today's "private beta" line.
5. **The gate's switches in the admin page.** Recommended: this PR only shows the gate's state; turning it on or off and editing the allowlist stays as it is until a separate small PR. Alternative: add the full editor here (a larger PR on a sensitive setting).
6. **Do invites change the order?** Recommended: no; the list shows who came through an invite, and the admin can choose them by hand. Alternative: each invited friend who joins moves the inviter up automatically (needs a visible position and rules against farming).

## Decisions

- **The gate reads the reservation, not the settings array.** A list that grows to thousands does not belong in one JSON value rewritten whole on each change; a row per person gives an indexed lookup and atomic admission.
- **The admitted row stays after the claim.** In strict mode it is what lets the person back in; it leaves with the account.
- **Emails go through a stamped worker job, not the admit request.** A request that sends 500 emails would time out halfway and nobody could tell who was told; a stamp per row makes "sent exactly once" a property of the schema.
- **No per-address refusal copy.** Saying "you are on the list" at the gate would tell anyone whether an address joined.
