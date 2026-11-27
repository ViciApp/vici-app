# Spec: Waitlist admission and the beta gate editor in the admin

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W2** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W1.** Buildable in parallel with W3 and W6; W5 stacks on this part. Must be merged, with W3, before the first person is admitted. Implementation PR title: `feat(waitlist): admit waitlisters and edit the beta gate from the admin`.

## Goal

An admin opens a Waitlist page in the app's admin, sees who is on the list, and admits people: a chosen few, or the next N in list order. An admitted person receives one email, in their language, saying their handle is ready; from then on the beta gate lets their mailbox sign in with any provider that proves it. They have 30 days to create the account, with one reminder a week before the end. The same page shows and edits the beta gate's switches, with an explicit confirmation before any change that opens sign-up to everyone.

## Context

- **The gate.** `betaGateVerdict` in `backend/src/auth/beta-gate.ts` reads the `beta_gate` app setting (`{ enabled, emails, allowNewUsers }`) at every point a sign-in learns the caller's email: `POST /auth/otp/request`, `POST /auth/otp/verify`, the Google and Apple callbacks (`backend/src/routes/auth.ts`). Off, everyone passes. On, allowlisted addresses pass; with `allowNewUsers` an existing account passes, a legacy address gets `legacy_account_pending`, anyone else passes. Without `allowNewUsers` nobody outside the allowlist passes, **including people who already have an account**. Refusals are `403 { error: 'beta_closed' }` or a redirect to `/signin?e=beta`, identical for every address. Documented in `backend/README.md` ("Beta access gate"), tested in `backend/tests/beta-gate.test.ts` and `e2e-web2/beta-gate.spec.ts`.
- **The setting has no screen.** It is written through the generic settings routes (`PUT /api/v1/admin/settings/beta_gate`, `backend/src/routes/admin.ts`, `backend/src/admin/settings.ts`), which accept any JSON; a malformed allowlist closes the gate for everyone.
- **The admin in the app.** `src/routes/(app)/admin/` holds the hub (`AdminPage.svelte`) and its sub-pages (`access`, `markets`, `resolutions`, `vxp`, `haptics`), each a thin route over a component in `src/lib/components/pages/`, guarded by `Protected` and `PermissionGuard` with `Permission.VIEW_ADMIN_PANEL`, built from `src/lib/components/admin/`. **The access page is not wired to the API:** `src/lib/services/roles.services.ts` has no web2 branch, so its role list and oracle manager talk to the satellite even in the web2 build. The waitlist therefore gets a sibling page that talks only to the API, rather than a section on a page whose other sections do not work there (open question 1).
- **From W1.** `waitlist_reservations` (`email`, `email_key`, `handle`, `locale`, `confirmed_at`, `source`, attribution, `hold_ended_at`, `account_user_id`), `emailMailboxKey`, the localised email module (`backend/src/waitlist/emails.ts`, `email-copy/`), the remove link, the admin delete route, the status read.
- **Admin guards.** `requireUser` then `requireAdmin` (`backend/src/auth/guard.ts`).
- **Worker.** `jobs` in `backend/src/worker.ts`.
- **Sign-in refusal copy.** `signin.beta_closed` in every catalog under `src/lib/constants/messages/`; `docs/ai/frontend/web2-backend-mode.md` describes how `/signin` renders it.

## Scope

### 1. Admission

- A migration adds to `waitlist_reservations`: `admitted_at timestamptz`, `admitted_by uuid references users (id) on delete set null`, `admission_email_sent_at`, `claim_reminder_sent_at`, and an index on `(admitted_at)`.
- `admitReservations({ ids, adminId })` and `admitNextReservations({ count, adminId })` in `backend/src/waitlist/admission.ts`: set `admitted_at` and `admitted_by` on confirmed, not yet admitted rows with `update ... where admitted_at is null returning`, so a repeat, or two admins at once, admits each person once.
- **List order** is the order the admin page shows and "next N" follows. In this part it is arrival (`confirmed_at`, then `id`); W5 replaces it with the rank that counts invites. Both parts read it from one function, `waitlistOrder`, so the page and the admit call cannot disagree.
- Admission is manual only. Nothing admits anyone on a schedule.
- Admission cannot be undone, removal can: deleting a reservation (W1) withdraws the admission with it, as long as the account does not exist.

### 2. The gate

`betaGateVerdict` gains one rule, checked right after the allowlist and before the `allowNewUsers` branch: **a caller whose mailbox key has an admitted reservation is allowed.** One indexed lookup on `waitlist_reservations (email_key)`.

- It holds whatever proves the address: the email code, Google, Apple. Matching is on the mailbox key, so someone who joined as `name+vici@gmail.com` gets in with Google as `name@gmail.com`. A provider that hides the real address (Apple's relay) does not match.
- It keeps holding after the account exists, because in strict mode the gate does not pass existing accounts by itself: the admitted row is what lets the person sign in again tomorrow. The row stays after the claim (W3) and goes with the account when it is purged (W1).
- The gate off, the allowlist and `allowNewUsers` behave exactly as before.
- **A waitlist means something only with `enabled: true` and `allowNewUsers` not `true`.** The page says so when the state differs (section 6).

### 3. The admission email and the reminder

- Sent by a worker job (`waitlist-admission-emails`, every tick): rows with `admitted_at` set and `admission_email_sent_at` null, a bounded batch per tick (`WAITLIST_ADMISSION_EMAILS_PER_TICK`), each stamped by `update ... set admission_email_sent_at = now() where id = $1 and admission_email_sent_at is null returning` before the send, so a second run or a second machine never sends twice. A failed send clears the stamp for a later tick and is logged.
- **Admission:** the handle, that the account can now be created, a link to the app's sign-in, the address to use, the date the hold ends, the remove link. **Reminder:** the same, shorter, seven days before the end.
- Both in the reservation's `locale`, with copy in every live locale, through W1's email module.
- The link signs nobody in: the person proves the address again with a code or a provider.

### 4. Thirty days to create the account

- `WAITLIST_CLAIM_WINDOW_DAYS` (30) after `admitted_at`, a reservation whose account does not exist lapses: the row is deleted, the handle is free, the gate no longer admits the mailbox. The person can join again.
- One reminder `WAITLIST_CLAIM_REMINDER_DAYS_BEFORE` (7) days before, stamped like the admission email.
- One hourly job, `waitlist-claim-window`; the delete is a dated `where`, harmless to repeat.
- While a reservation is admitted, W6's twelve-month clock does not apply to it: the 30 days decide.

### 5. Admin routes

In `backend/src/routes/waitlist.ts` under `/api/v1/waitlist/admin`, all behind `requireUser` then `requireAdmin`:

| Route                  | Does                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /summary`         | counts: waiting, admitted and not yet joined, joined; the oldest waiting date                                                                                                                                                               |
| `GET /reservations`    | a page of confirmed rows in list order (`state` filter, `q` as a prefix on email or handle, `offset` and `limit` capped by `WAITLIST_ADMIN_PAGE_MAX`): position, email, handle, language, source, whether an invite brought them, the dates |
| `POST /admit`          | body `{ ids }` (uuids checked with `UUID_RE`, `maxItems` `WAITLIST_ADMIT_MAX_BATCH`) or `{ next }` (`t.Integer`, same bound); answers `{ admitted }`                                                                                        |
| `DELETE /reservations` | W1's delete, unchanged                                                                                                                                                                                                                      |
| `GET /gate`            | the gate as typed fields: `{ enabled, allowNewUsers, emails, updatedAt, malformed }`                                                                                                                                                        |
| `PUT /gate`            | section 6                                                                                                                                                                                                                                   |

Unconfirmed rows are never listed: an address nobody has proven is shown to no one.

### 6. The beta gate editor

`PUT /api/v1/waitlist/admin/gate`, body `{ enabled, allowNewUsers, emails, expectedUpdatedAt, confirmOpen? }`:

- **Validated**, unlike the generic settings route: `emails` is an array of well-formed addresses, normalised and de-duplicated, capped by `BETA_GATE_MAX_EMAILS`; booleans are booleans. The stored value is always one the gate can read, so the editor cannot close the gate by a typo.
- **Opening needs a confirmation.** A change that lets people in who were not let in before, namely `enabled` from `true` to `false`, or `allowNewUsers` from `false` to `true` while enabled, is refused with `400 { error: 'confirmation_required' }` unless the body carries `confirmOpen: true`. The screen sets it only after the admin has typed a confirmation word in a dialog that states what will happen ("Anyone can create an account", or "Anyone without a legacy account can create an account"). Closing, and editing the allowlist, need no such step.
- **No lost updates.** `expectedUpdatedAt` must equal the stored value's `updatedAt`, else `409 { error: 'gate_changed' }` and the screen reloads.
- The write goes through `upsertAppSetting` with the same key and shape the gate already reads; the generic settings route keeps working.

### 7. Admin screen

`src/routes/(app)/admin/waitlist/+page.svelte` over `src/lib/components/pages/AdminWaitlistPage.svelte`, guarded like its siblings, linked from the hub (`AdminPage.svelte`), web2 build only:

- **Gate** (`src/lib/components/admin/AdminBetaGate.svelte`): the two switches, the allowlist editor, a plain statement of who can sign in right now, a warning when the stored value is malformed, the confirmation dialog of section 6.
- **Waitlist** (`AdminWaitlist.svelte`): the three counts; a searchable, paged list in list order (position, email, handle, language, joined date, state), rows selectable; "Admit selected" and "Admit next" with a number field, each behind a confirmation that states how many emails will be sent; "Remove" per row, behind a confirmation that says the handle is released and the data deleted. A line warns when the gate's state makes admission pointless.

Service `src/lib/services/waitlist-admin.services.ts`, wrappers in `src/lib/web2/client.ts`, i18n keys `admin.waitlist.*` and `admin.gate.*` in every catalog. Reuse the admin pieces that exist before adding any (`docs/ai/frontend/reusability.md`).

### 8. What a refused person reads

`signin.beta_closed` stays one line for every refused address and becomes, in every catalog: **"VICI opens in waves. Claim your handle to join the waitlist."**, with the words linking to the landing. Nothing in the refusal says whether the address is on the list.

### Out of scope

- Automatic admission of any kind.
- Invites changing the order, and the invite columns of the list: W5.
- Exporting the list. A queue position shown to visitors (the page shows none).
- Wiring the access page's roles and oracles to the API.
- The handle claim and onboarding: W3.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). None covers admission, the beta gate or the admin. No issue is linked.

## Analytics

Instrument, server-side, with three additions to the taxonomy (both halves of the app pair and both lists in `backend/src/analytics/taxonomy.ts`):

| Event               | When                                   | Props                                                                                             |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `waitlist_admitted` | an admit call changed at least one row | `count`, `source` (`selected` or `next`)                                                          |
| `waitlist_lapsed`   | the claim-window job removed rows      | `count`, `label: 'claim_window'`                                                                  |
| `beta_gate_changed` | the editor stored a change             | `label` (`opened`, `opened_to_new_users`, `closed`, `allowlist_edited`), `count` (allowlist size) |

One event per call or per job run, never per person, and no `userId` of the admitted person. Who admitted whom is in `admitted_by`, an operational record, not product analytics. Email opens and clicks are not tracked.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** The gate adds one index-only lookup to each sign-in attempt that is not already allowlisted. An admit call is one `update` over at most `WAITLIST_ADMIT_MAX_BATCH` rows. The email job sends a bounded batch per tick, sized under the provider's rate. The list read is paged; the summary is three counts over one table.
- **Memory and storage.** Four nullable columns and one index on an existing table.
- **Scalability.** At 100,000 rows the gate lookup stays O(1) and the list stays paged. Admitting 10,000 people is twenty calls of 500 and drains through the email job at the configured rate; the page states how long that takes.
- **Upgrade and compatibility.** One forward-only migration (`add column if not exists`). The previous release ignores the columns. The gate change is additive: no existing verdict changes for a mailbox without an admitted reservation, pinned by the existing `beta-gate.test.ts` cases passing unchanged. The setting keeps its key and shape. No `.did`, no bindings, nothing breaking.
- **Security.** The gate stays a rollout valve, not a security boundary. The editor is the first screen that can open sign-up to everyone: admin role, server-side confirmation flag, an optimistic check against concurrent edits, an analytics trace. The list exposes email addresses to admins only and never an unconfirmed one. Protected paths touched: `backend/src/auth/beta-gate.ts`, `backend/src/admin/settings.ts` (called), `backend/src/db/**`, the admin routes, `backend/src/worker.ts`.
- **Parameters.** Every figure is a named constant in `backend/src/waitlist/admission.ts`; the email copy derives the hold's end date from `WAITLIST_CLAIM_WINDOW_DAYS`.

## Implementation outline

1. Migration `NNNN_waitlist_admission.sql` (the next free number), with the why at the top.
2. `backend/src/waitlist/admission.ts`: constants, `waitlistOrder`, `admitReservations`, `admitNextReservations`, `listReservations`, `summariseWaitlist`, `sendPendingAdmissionEmails`, `runClaimWindow`, `isAdmittedMailbox`.
3. `betaGateVerdict`: the admitted rule; `readBetaGate` / `writeBetaGate` (validation, the confirmation rule, the stale check) next to it; the header comment and `backend/README.md` ("Beta access gate", verdict table, the editor) updated.
4. The admission and reminder builders and their copy in every live locale.
5. Admin routes; two worker jobs with their one-line idempotency comments.
6. W1's status read answers `admitted` for an admitted row without an account.
7. App: client wrappers, `waitlist-admin.services.ts`, the page, the two components, the hub link, the i18n keys, the changed `signin.beta_closed` with its link.
8. **Docs in the same PR:** `PRODUCT.md` (a "Waitlist: admission" entry and what a refused sign-in says), `backend/README.md`, `docs/ai/frontend/web2-backend-mode.md`, `docs/ai/frontend/testing.md` if the E2E fixtures change.

**Tests**

- `backend/tests/waitlist-admission.test.ts`: admit by ids and by next (list order), each idempotent; unconfirmed and already admitted rows are skipped; 401 and 403 on every admin route; a malformed id is a 400; the list pages without gaps or repeats and never returns an unconfirmed row; the summary counts.
- `backend/tests/beta-gate.test.ts`: with the gate on and strict, an admitted mailbox passes at the code request, the code verification and the Google and Apple callbacks, including under an alias of the same mailbox; a waiting one is refused with `beta_closed`; a removed reservation is refused again; an admitted mailbox that created its account still passes; every existing case unchanged.
- Gate editor: a malformed body is refused and nothing is stored; opening without `confirmOpen` answers `confirmation_required`, with it succeeds; closing and allowlist edits need none; a stale `expectedUpdatedAt` answers `gate_changed`; the stored value is read correctly by `betaGateVerdict`.
- Email job: one run sends each pending email once, in the row's language, and stamps it; a second sends nothing; a failing transport leaves the row to be retried; the copy names the handle and the hold's end date.
- Claim window: a row past 30 days without an account is deleted and its handle reservable again; a row with an account is never deleted; the reminder goes once.
- E2E (`e2e-web2/waitlist-admission.spec.ts`): an admin admits a waiting person from the page; that person's sign-in, refused before with the waitlist line, now succeeds; opening the gate needs the typed confirmation.

**Rollout.** Ship with the gate already on and strict. Admit a small first batch and watch delivery before larger ones. Rollback: the previous image; admitted rows remain but the gate stops honouring them, so admitted people are refused until the code returns, including those who already created an account. That is why the first batches should be small.

**Risks**

- **Strict mode locks out returning users without the admitted rule.** Deleting an admitted row by hand, outside the purge, locks its owner out.
- **One screen can open the product to everyone.** The confirmation is server-enforced, but it is still one admin and one dialog.
- **Bulk mail from a domain that has only sent codes.** The per-tick batch is the brake.
- **Legacy addresses.** In strict mode a legacy user's sign-in reads the waitlist line, not `legacy_account_pending` (that branch needs `allowNewUsers`), and W1 keeps them off the list: until cutover they get in only through the allowlist. The line tells them to claim a handle they cannot claim; the private email of W1 explains when they try.
- **Thirty days is short** for someone who reads mail rarely; the reminder is the only second chance.

## Acceptance criteria

- [ ] An admin can see counts and a searchable, paged list of confirmed reservations in list order; unconfirmed addresses never appear.
- [ ] An admin can admit chosen people or the next N; doing it twice admits nobody twice.
- [ ] Each admitted person gets one admission email, never two, in their language, naming their handle and the date the hold ends; a failed send is retried.
- [ ] With the gate on and strict, an admitted mailbox can sign in with the email code and with any provider asserting that mailbox; a waiting one cannot.
- [ ] An admitted person who created their account can sign in again on a later day.
- [ ] An admitted reservation with no account after 30 days is removed, after one reminder on day 23; its handle is free.
- [ ] The admin page shows the gate's switches and allowlist and saves them; a change that opens sign-up to everyone is refused by the server without the explicit confirmation.
- [ ] Two admins editing the gate at once cannot silently overwrite each other.
- [ ] A refused sign-in shows "VICI opens in waves. Claim your handle to join the waitlist." with a link to the landing, the same for every address.
- [ ] Every gate behaviour that existed before is unchanged for mailboxes without an admitted reservation.
- [ ] `PRODUCT.md` and `backend/README.md` describe the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Does the admin shell work on the web2 build?** `PermissionGuard` reads the profile's role, which the API serves, so the hub and a new page should render for an API admin; the access page's own sections call the satellite. Confirm by signing in as an admin on a web2 build before building on it. If the guard itself is satellite-bound, wiring it is a prerequisite PR.
2. **The gate's production state and who is on the allowlist today.**
3. **Worker tick length and the email provider's rate**, to size `WAITLIST_ADMISSION_EMAILS_PER_TICK`.
4. **Counsel**: the admission email and the reminder under the consent given at the waitlist.
5. **Does the E2E server expose sent emails beyond sign-in codes** (`GET /__e2e/otp/:email`)?
6. **Should the generic settings route keep accepting `beta_gate`**, now that a validated route exists, or refuse that key?

## Decisions

Owner decisions (27 Nov 2026):

- **Admission is manual, from the admin page**: chosen people, or "the next N" in list order.
- **Every email goes out in the visitor's language**: the landing locale is stored at reservation, and the copy exists in every live locale.
- **An admitted person has 30 days to create the account**, with one reminder 7 days before the deadline; then the handle is released.
- **A refused sign-in shows one line for everyone, linking to the landing**: "VICI opens in waves. Claim your handle to join the waitlist."
- **The admin lives in the app and includes a beta gate editor with switches**, with an explicit confirmation step for any change that opens sign-up to everyone.
- **Invites move the inviter up the list**; the rule is W5's.

Author's choices (a reviewer may overrule):

- **A sibling page, `/admin/waitlist`**, not a section of the access page: that page's roles and oracles are not wired to the API, and a page that works only in part is worse than one that works.
- **The gate reads the reservation, not the settings array.** A list that grows to thousands does not belong in one JSON value rewritten whole on each change.
- **The confirmation is enforced by the server**, not only by the dialog, so no client can open sign-up by accident.
- **The admitted row stays after the claim.** In strict mode it is what lets the person back in.
- **Emails go through a stamped worker job, not the admit request.** A request that sends 500 emails would time out halfway and nobody could tell who was told.
- **No per-address refusal copy.** Saying "you are on the list" at the gate would tell anyone whether an address joined.
