# Spec: Handle waitlist, reserve a handle with a verified email

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

The waitlist is specified in three parts, each with its own status and its own implementation PR, because one PR per purpose would not hold all of it:

| Part   | Spec                                                                                         | Implementation PR title                                         | Stacks on                                                        |
| ------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| **W1** | this file: data model, the two public operations, the hold on the handle, privacy, retention | `feat(waitlist): reserve a handle with a verified email`        | the public handle check PR (Turnstile helpers), else from `main` |
| W2     | [`2026-11-27-feat-waitlist-admission.md`](./2026-11-27-feat-waitlist-admission.md)           | `feat(waitlist): admit waitlisters from the admin access page`  | W1                                                               |
| W3     | [`2026-11-27-feat-waitlist-handle-claim.md`](./2026-11-27-feat-waitlist-handle-claim.md)     | `feat(waitlist): claim the reserved handle at account creation` | W1                                                               |

W2 and W3 can be built in parallel once W1 is merged. The landing can go live with W1 alone (people join the list); W2 and W3 must both be merged before the first person is admitted.

## Goal

A signed-out visitor on the landing picks a handle, gives an email, types the 6-digit code sent to that email, and reads "Handle claimed. You're on the waitlist.". From that moment the handle is held for that email: nobody else can reserve it or take it in the app. No account, session, profile or VXP is created, and the visitor cannot play until admitted (W2) and until they create the account (W3).

## Context

**What exists.**

- **Handle rules and uniqueness.** `backend/src/profiles/nickname.ts`: `checkNicknameAvailability` (format, then uniqueness on `profiles.nickname_key`), `nicknameUniqueKey` (trim, NFKD, strip combining marks, lowercase: case and accent insensitive), `MIN_NICKNAME_LENGTH` / `MAX_NICKNAME_LENGTH`, `NICKNAME_PATTERN`. The app mirror is `src/lib/constants/profile.constants.ts`, which also holds `RESERVED_HANDLES`. The unique index is `profiles_nickname_key_uniq` (`backend/src/db/migrations/0004_profiles_social.sql`). The write guard is `assertValidNickname` in `backend/src/profiles/profile-write.ts`, run inside the `upsertMyProfile` transaction.
- **`RESERVED_HANDLES` is enforced by the app only.** `Onboarding.svelte` and `HandleEditor.svelte` check it; the API does not, so a request that bypasses the app can take `admin` today.
- **Imported legacy handles** live in `profiles` too: the import (`backend/scripts/etl/transforms.ts`) writes a profile per legacy principal under a provisional `claim_pending` user, adopted at first sign-in (`backend/src/auth/adoption.ts`).
- **One-time codes.** `backend/src/auth/otp.ts`: `createOtp` / `requestOtp` / `verifyOtp` over the `otp_codes` table (`0002_auth_identity.sql`), 6 digits from `generateOtp`, hashed with `peppered` (`backend/src/lib/crypto.ts`), `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS` spent by one conditional `update` before the compare, `OTP_MAX_LIVE_CODES`. `verifyOtp` ends in `resolveIdentity`, which provisions an account, and `/auth/otp/verify` (`backend/src/routes/auth.ts`) mints a session: neither may happen here. `otp_codes` has no purpose column, so a code stored there is a sign-in code. `backend/src/school/verification.ts` is the precedent for a second code flow with its own storage, its own cap and TTL.
- **Email.** `backend/src/lib/email.ts`: `sendEmail` (Resend, console fallback outside production), `codeExpiryNotice`, `setEmailTransport` (test seam). The API sends two emails today, both in English, both transactional: the sign-in code and the school verification code. There is no template system, no localisation, no list sending and no unsubscribe handling.
- **Rate limiting.** `enforceLimit` / `clientIp` (`backend/src/lib/rate-limit.ts`, `backend/src/lib/http.ts`), in memory, per instance; the rules are in `docs/ai/backend/patterns.md` ("Rate limiting").
- **Bot protection** (from the public handle check PR, branch `claude/landing-xgugio-public-handle-check`, not on `main` at authoring time): `verifyTurnstileToken({ token, ip, action })` and `MAX_TURNSTILE_TOKEN_LENGTH` in `backend/src/lib/turnstile.ts`, `issueHumanProof` / `verifyHumanProof` in `backend/src/lib/human-proof.ts`, the anonymous probe `GET /api/v1/profiles/public-nickname-availability` in `backend/src/routes/profiles.ts`; on the app side `acquireTurnstileToken` in `src/lib/services/turnstile.services.ts`, `checkHandleAvailabilityPublic` in `src/lib/services/handle-availability.services.ts`, `nicknameFormatIssue` in `src/lib/utils/nickname.utils.ts`, the action names in `src/lib/constants/turnstile.constants.ts`.
- **Per-email serialisation.** `lockLoginEmails` in `backend/src/auth/adoption.ts` is the advisory lock every first login and claim takes for an address; its lock order is documented at the top of that file.
- **Account purge.** `purgeExpiredAccount` in `backend/src/account/lifecycle.ts`; what survives a deletion is listed in `PRODUCT.md` ("Privacy: what survives an account's deletion").
- **Worker.** `jobs` in `backend/src/worker.ts`; recipe in `docs/ai/backend/workflows/new-worker-job.md`.
- **Privacy policy.** `src/lib/constants/legal-docs.constants.ts` (slug `privacy`, rendered at `/info/privacy`), contact `INFO_EMAIL` in `src/lib/constants/contact.constants.ts`.
- **The landing capsule** (components under `src/lib/components/landing/` with the `LandingClaim*` prefix, delivered by the landing page PR, not on `main` at authoring time) drives the three steps and talks to the server only through an injected adapter with two operations, `requestCode` and `confirm`.

**What the waitlist must not reuse.** `otp_codes` and `verifyOtp`: see "Decisions".

## Scope

### 1. Data model

One table, `waitlist_reservations`, one row per email:

| Column                                                               | Holds                                                                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id uuid`                                                            | primary key                                                                                                                       |
| `email text not null`                                                | the address, normalised with `normalizeEmail` (`backend/src/auth/identity.ts`); `check (email = lower(btrim(email)))`; **unique** |
| `handle text`, `handle_key text`                                     | the confirmed handle in the owner's form (case and accents kept) and its `nicknameUniqueKey`; null until the first confirmation   |
| `pending_handle text`, `pending_handle_key text`                     | the handle a code was last requested for, not yet confirmed                                                                       |
| `code_hash text`, `code_expires_at timestamptz`, `code_attempts int` | the live code (one per row), hashed; its expiry; attempts spent                                                                   |
| `code_sends int`, `code_sends_window_started_at timestamptz`         | the per-email send cap                                                                                                            |
| `status_token_hash text`                                             | see section 6 (pending decision 10)                                                                                               |
| `consent_at timestamptz not null`                                    | when the visitor submitted the email step next to the privacy link (server clock)                                                 |
| `privacy_version text not null`                                      | the version of the policy the app displayed (a constant, see section 7)                                                           |
| `source text not null`                                               | which entry point of the landing opened the capsule; a closed vocabulary enforced by a `check`                                    |
| `invited_referral_code text`, `invited_challenge_id text`            | last-touch attribution, at most one set (pending decision 12)                                                                     |
| `created_at`, `confirmed_at`                                         | row creation; first confirmation                                                                                                  |
| `claimed_at`, `claimed_user_id uuid`                                 | written by W3 when the account takes the handle                                                                                   |

W2 adds its own columns (`admitted_at`, `admitted_by`, the admission email stamps) in its own migration.

**Not stored:** IP address, user agent, locale, name, the plaintext code, the plaintext status token.

**Uniqueness.**

- `unique (email)`: one reservation per email.
- `unique (handle_key) where handle_key is not null and claimed_at is null`: two emails can never hold the same confirmed handle, in any letter case or accent form. Once claimed, the profile's own index holds the handle and the reservation stops holding it (so a later handle change in the app frees it normally).
- **Against existing users' handles** (including imported legacy profiles) there is no database constraint across two tables. Both writers take the same advisory lock on the handle key inside their transaction before checking and writing: `pg_advisory_xact_lock(hashtextextended('handle:' || key, 0))`. The waitlist takes the email lock first (`lockLoginEmails`, so a confirmation and a first login for the same address run one after the other), then the handle lock; the profile write takes only the handle lock. That order extends the one documented in `adoption.ts` without a cycle (open question 4).
- **A pending hold** (pending decision 1): while a code is live, `pending_handle_key` counts as taken for everyone else. It is enforced by the check under the handle lock, not by an index, because it depends on the clock.

**One validator.** `checkNicknameAvailability` gains the waitlist clause, so every caller agrees on "taken": the anonymous probe, the signed-in probe (`GET /profiles/nickname-availability`), the profile write guard (onboarding and the handle editor both end there) and the waitlist itself. A handle is `taken` when a profile holds its key, or a reservation holds it confirmed and unclaimed, or a reservation holds it pending with a live code. The function takes an optional `excludeReservationEmail` so a reservation never conflicts with itself; W3 uses the same parameter to let the owner take their own handle. In this part nobody is exempt: a reserved handle is unavailable to every account.

**Reserved handles move to the server.** `backend/src/profiles/nickname.ts` gets `RESERVED_NICKNAME_KEYS`, mirrored from `RESERVED_HANDLES` and pinned by `backend/tests/shared-drift/domain-limits.test.ts`, and `checkNicknameAvailability` answers `{ available: false, reason: 'reserved' }` for them (matched on the fold, so a case or accent variant is reserved too). The write guard keeps its grandfather rule: a stored handle that predates the rule does not block edits to other fields. The wire union in `src/lib/web2/client.ts` (`Web2NicknameAvailability`) gains `'reserved'`.

### 2. Routes

A new area: `backend/src/routes/waitlist.ts` (`waitlistRoutes`, prefix `/api/v1/waitlist`, mounted in `backend/src/index.ts`), logic in `backend/src/waitlist/reservations.ts`.

**`POST /api/v1/waitlist/code`** (the adapter's `requestCode`)

Body: `{ handle, email, turnstileToken, privacyVersion, source, referralCode?, challengeId? }`, every string length-capped by a named constant.

In order: IP limit; body validation; Turnstile; handle format (`checkNicknameAvailability` reasons); then, in one transaction under the email and handle locks: per-email send cap, handle availability, upsert of the row (`pending_handle`, a fresh code replacing any earlier one, `code_attempts = 0`, `consent_at = now()`, `privacy_version`, `source`, attribution), then the email.

| Answer                                                                | When                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `200 { ok: true, codeTtlMs }`                                         | a code was stored and handed to the email transport                            |
| `400 { error: 'email_invalid' }`                                      | empty, no `@`, longer than `MAX_WAITLIST_EMAIL_LENGTH`                         |
| `400 { error: 'handle_invalid' }`                                     | fails the format rules or is a reserved handle                                 |
| `409 { error: 'handle_taken' }`                                       | a profile, a confirmed reservation or another email's live pending hold has it |
| `403 { error: 'turnstile_failed' }`                                   | Cloudflare refused the token                                                   |
| `503 { error: 'turnstile_unavailable' }` / `'turnstile_unconfigured'` | as the handle probe answers them                                               |
| `429 { error: 'rate_limited' }` with `Retry-After`                    | IP limit, per-email send cap or the global breaker                             |

**The answer never depends on what the server knows about the email** (already on the list, already an account, a legacy account): those are decided at confirmation, once the caller has proven they own the address. Delivery failures are logged and do not change the answer, as in `requestOtp`.

Asking again with the same email and the same handle is idempotent apart from sending a fresh code. Asking with the same email and another handle moves the pending hold to the new handle.

**`POST /api/v1/waitlist/confirm`** (the adapter's `confirm`)

Body: `{ email, code }`. In order: IP limit; then one transaction under the email lock: find the row, spend an attempt with the conditional `update ... where code_attempts < $max returning` (the pattern of `verifyOtp`), compare in constant time, then take the handle lock and re-check availability before writing.

| Answer                                    | When                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `200 { handle, statusToken }`             | the pending handle became the confirmed one; the code is burnt; `confirmed_at` set on the first time   |
| `401 { error: 'invalid_code' }`           | wrong code, no row for this email, or a row with no live code                                          |
| `410 { error: 'expired_code' }`           | a never-confirmed row whose code has expired or whose attempts are spent: ask for a new one            |
| `409 { error: 'handle_taken' }`           | the handle was lost between the request and the confirmation; the visitor picks another and asks again |
| `409 { error: 'already_registered' }`     | the email already signs in to an account (pending decision 3); the row is deleted                      |
| `409 { error: 'legacy_account_pending' }` | the email belongs to a legacy account (pending decision 4); the row is deleted                         |
| `429 { error: 'rate_limited' }`           | IP limit                                                                                               |

`expired_code` is answered only for a row that was never confirmed, so the endpoint does not reveal whether an address is on the list. A confirmation mints no session and sets no cookie.

**`POST /api/v1/waitlist/status`** (pending decision 10): body `{ statusToken }`, answers `200 { handle, state }` with `state` `waiting` (W2 adds `admitted`, W3 adds `joined`) or `404 { error: 'not_found' }`. IP-limited. The token rides the body, never a URL.

**`DELETE /api/v1/waitlist/admin/reservations`**: admin only (`requireUser`, then `requireAdmin`), body `{ email }`, deletes the row and answers `{ deleted: boolean }`. This is the deletion-on-request tool available from day one; W2 puts a button on it.

**Refinements of the adapter contract** (the capsule's two operations stay):

- `requestCode({ handle, email, source })` resolves `{ ok: true }` or `{ error }`; the service adds the Turnstile token, the privacy version and any stashed attribution itself.
- `confirm({ email, code })` resolves `{ handle }` or `{ error }`; the service stores the status token.
- Error codes: `handle_taken`, `handle_invalid`, `email_invalid`, `invalid_code`, `expired_code`, `rate_limited`, plus `already_registered`, `legacy_account_pending`, `bot_check_failed` (any Turnstile refusal) and `unavailable` (network or 5xx). The capsule needs a line for each.
- A third, optional operation `restore()` resolves `{ handle, state }` or nothing, for a returning visitor.

### 3. The code

- 6 digits from `generateOtp`, stored as `peppered('waitlist\n' + email + '\n' + code)` so a waitlist hash can never equal a sign-in hash; compared with `constantTimeEqual`.
- `WAITLIST_CODE_TTL_MS`: ten minutes, the same lifetime as the sign-in code, and the length of the pending hold.
- `WAITLIST_CODE_MAX_ATTEMPTS`: five per code, spent before the compare.
- One live code per email: a fresh request replaces the previous code. `WAITLIST_CODE_SENDS_PER_DAY` (five per email per rolling 24 hours, stored on the row) bounds both the guesses a fresh code would buy and the mail a stranger can cause an address to receive.
- The email: `sendWaitlistCodeEmail` in `backend/src/lib/email.ts`, subject distinct from the sign-in code's so the two cannot be confused, expiry line from `codeExpiryNotice`, plus one line saying what the code does and how to be removed (pending decision 8).

### 4. Turnstile and rate limits

- Every code request carries a fresh Turnstile token for its own action (`waitlist_code`, a constant in `backend/src/waitlist/reservations.ts` mirrored in `src/lib/constants/turnstile.constants.ts` and pinned by the drift suite). The token is single use: one challenge per email sent. Production without `TURNSTILE_SECRET_KEY` refuses, never opens.
- Named constants at the top of `backend/src/routes/waitlist.ts`, windows from `backend/src/lib/time.ts`:

| Constant                                 | Value           | Keyed by                                 |
| ---------------------------------------- | --------------- | ---------------------------------------- |
| `WAITLIST_CODE_LIMIT_PER_TEN_MINUTES`    | 5               | IP                                       |
| `WAITLIST_CONFIRM_LIMIT_PER_TEN_MINUTES` | 15              | IP                                       |
| `WAITLIST_STATUS_LIMIT_PER_TEN_MINUTES`  | 30              | IP                                       |
| `WAITLIST_CODE_GLOBAL_LIMIT_PER_HOUR`    | open question 3 | all callers: a breaker on the email bill |

- The confirmation needs no Turnstile: the code, its attempt cap and the IP limit bound it.

### 5. Retention and cleanup

- **Never confirmed.** A row with no confirmed handle is deleted `WAITLIST_PENDING_RETENTION_MS` (24 hours) after its last code request, by a worker job (`waitlist-prune`, `everyNthTick: HOURLY_TICKS`, a plain `delete ... where` that a re-run repeats harmlessly). The 24 hours exist only to keep the send cap meaningful.
- **Confirmed, not admitted.** Kept until admission or a deletion request (pending decision 6).
- **Admitted, never claimed.** W2 (the claim window).
- **Account deleted.** `purgeExpiredAccount` deletes the reservation with `claimed_user_id` of the purged account.
- **Deletion on request** (pending decision 9): the admin route of section 2. Deleting a row frees its handle at once and removes the email.

### 6. Returning visitors

The service keeps the confirmed handle and the status token in `localStorage` as a cache of a server result (key in `src/lib/constants/waitlist.constants.ts`). On load the capsule calls `restore()`: a `not_found` clears the cache, so a lapsed or deleted reservation never shows as held. Clearing the browser loses only the cache: the reservation is on the server.

### 7. Privacy

- The privacy link sits beside the email step and opens `/info/privacy` (open question 5 covers whether a signed-out visitor can open it today).
- `consent_at` is the server time of the code request; `privacy_version` is `PRIVACY_POLICY_VERSION`, a constant added next to the policy in `src/lib/constants/legal-docs.constants.ts` and bumped with its "Last updated" line.
- The policy text gains the waitlist: what is collected (email, handle, the times above), why (to hold the handle and to write once when the account can be created), how long, how to be removed (`INFO_EMAIL`). The wording is counsel's (open question 6); the implementation PR carries it.
- Data minimisation is the "Not stored" list of section 1. Analytics carry no email and no handle.

### 8. The app side

- `src/lib/web2/client.ts`: `requestWaitlistCode`, `confirmWaitlistCode`, `readWaitlistStatus`, typed errors through `Web2ApiError.code`.
- `src/lib/services/waitlist.services.ts`: the adapter (`requestCode`, `confirm`, `restore`) the landing injects into the capsule. Web2 build only: the default backend has no waitlist and the landing is not served there.
- The capsule skips the live probe for the handle whose pending hold this browser owns, so stepping back from the code field does not show the visitor's own handle as taken.
- i18n keys for the added error lines in every catalog under `landing.claim.*`.

### Out of scope

- Admission, the gate, the admin list, the admission email: W2.
- Taking the handle at account creation, onboarding, what becomes of landing taps and challenge links: W3.
- The capsule's layout, steps and motion: the landing page PR.
- Turnstile on the sign-in code request: its own PR (`claude/landing-xgugio-email-code-turnstile`).
- Marketing email of any kind, and any list export.
- Moving the rate limiter to a shared store (it stays per instance, as `rate-limit.ts` says).

## Linked issues

Open issues were searched on 26 Nov 2026 (six open). None covers a waitlist or handle reservation. #543 (anti-farm hardening of the new-account mint surface) is adjacent: this part creates no account and mints nothing, so it neither fixes nor widens it. No issue is linked.

## Analytics

Instrument, server-side, so the counts do not depend on a browser. Three additions to the taxonomy, each in `src/lib/types/analytics-event.ts`, `src/lib/schema/analytics-event.schema.ts`, and `ANALYTICS_EVENT_NAMES` plus `SERVER_ANALYTICS_EVENT_NAMES` in `backend/src/analytics/taxonomy.ts` (pending decision 13):

| Event                     | When                                            | Props                                                                                                           |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `waitlist_code_requested` | a code was stored                               | `source` (entry point), `ok` (first request for this email in the row's life)                                   |
| `waitlist_joined`         | a confirmation succeeded                        | `source` (entry point), `label` (`new` or `handle_changed`), `ok` (arrived through an invite or challenge link) |
| `waitlist_join_refused`   | a confirmation was refused after a correct code | `label` (`handle_taken`, `already_registered`, `legacy_account_pending`)                                        |

All captured with `captureServerEvents` and no `userId` (there is no account). `signed_up` is **not** emitted: nobody signed up. No email, handle, IP or code is sent.

Client-side steps of the capsule (opened, handle accepted, email submitted, code error) belong to the landing analytics PR and reuse existing names: `onboarding_started` with `source: 'landing_claim'` and the entry point as `label`; `handle_checked` with `source: 'landing_claim'` and `ok`; `onboarding_step` with `source: 'landing_claim'` and `label` in `handle_ok`, `email_submitted`, `code_error`, `joined`.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** Two writes per joiner (request, confirm), each one transaction with two advisory locks and three indexed lookups. The handle probe gains one indexed `exists` on `waitlist_reservations`; it is the hot path (a debounced probe per keystroke, capped by the probe's own limits). One Turnstile round trip and one email per code request. No satellite or engine call, no instruction budget involved.
- **Memory and storage.** One row per email, about 400 bytes with its indexes. 100,000 reservations are about 40 MB. Growth is bounded by the code limits; unconfirmed rows live 24 hours. The rate limiter keeps a few entries per active IP, swept every minute.
- **Scalability.** At 10 times and 100 times the expected list the lookups stay index-only (`email`, `handle_key`, `pending_handle_key`). The per-instance limiter under-counts across several app machines by the machine count; the per-email cap and the pending hold are in Postgres and do not. No N+1: nothing here fans out.
- **Upgrade and compatibility.** One forward-only migration, `backend/src/db/migrations/NNNN_waitlist_reservations.sql` (the next free number at implementation time; sibling branches also add migrations), `create table if not exists` and `create index if not exists`. The previous release keeps working against it: it does not read the table, so during a deploy an old machine does not see holds for a few seconds; the confirmation re-checks under the lock, and the profile index stays the last resort. `checkNicknameAvailability` gains a reason (`reserved`): additive on the wire, and the client type changes in the same PR. No `.did`, no bindings, nothing breaking.
- **Security.** Public, unauthenticated writes: IP limits, Turnstile on the one that sends email, a per-email cap, bounded strings, the global body cap. Codes and the status token are hashed at rest with the session pepper; nothing in a response distinguishes a known email before the code is proven. The same-origin guard (`refuseUnsafeRequest`) applies to both POSTs. Protected paths touched: `backend/src/db/**`, `backend/src/profiles/nickname.ts` and `profile-write.ts` (the write guard), `backend/src/account/lifecycle.ts`, `backend/src/lib/email.ts`, the admin route. `backend/src/auth/**` is read (`lockLoginEmails`, `normalizeEmail`) and not changed.
- **Parameters.** Handle bounds and pattern: `backend/src/profiles/nickname.ts` and `src/lib/constants/profile.constants.ts`. Code length: `generateOtp`. Everything introduced here is a named constant in `backend/src/waitlist/reservations.ts` or at the top of `backend/src/routes/waitlist.ts`; the spec's figures are proposals for those constants, not a second source.

## Implementation outline

1. **Migration** `NNNN_waitlist_reservations.sql` with the why at the top, the table, the two unique indexes, an index on `pending_handle_key`, the `source` check.
2. **Domain** `backend/src/waitlist/reservations.ts`: constants; `requestWaitlistCode`, `confirmWaitlistCode`, `readWaitlistStatus`, `deleteWaitlistReservation`, `pruneUnconfirmedReservations`; typed errors (`class WaitlistError extends Error` carrying the wire code); `lockHandleKey({ q, key })`.
3. **Validator** `backend/src/profiles/nickname.ts`: `RESERVED_NICKNAME_KEYS`, the `reserved` reason, the reservation clause, `excludeReservationEmail`. `backend/src/profiles/profile-write.ts`: take `lockHandleKey` before `assertValidNickname` when the write sets a handle, and map `reserved` to a `ProfileValidationError`.
4. **Email** `sendWaitlistCodeEmail` in `backend/src/lib/email.ts`.
5. **Routes** `backend/src/routes/waitlist.ts`, mounted in `backend/src/index.ts`.
6. **Purge and worker**: the reservation delete in `purgeExpiredAccount`; `waitlist-prune` in `backend/src/worker.ts`.
7. **App**: client wrappers, `waitlist.services.ts`, `waitlist.constants.ts`, the Turnstile action constant, `PRIVACY_POLICY_VERSION`, i18n keys, the capsule wired to the adapter where the landing mounts it.
8. **Docs in the same PR**: `PRODUCT.md` (a "Waitlist: reserve a handle" entry; "Onboarding: one screen" notes that a reserved handle reads as taken; "Privacy: what survives an account's deletion" lists the reservation among what is removed), `backend/README.md` (routes, constants, the mirrored Turnstile action and reserved list), `docs/ai/backend/reusability.md` and `docs/ai/frontend/reusability.md`, `docs/ai/frontend/web2-backend-mode.md`.

**Tests**

- `backend/tests/waitlist.test.ts` (real Postgres, `setEmailTransport`, `setTurnstileSeam`, `resetRateLimits`, collision-free fixtures from `uniqueEmail` / `uniqueNickname`): the happy path returns the handle in the owner's form and creates no `users`, `auth_identities` or `sessions` row; the code read from the transport confirms, a second use does not; five wrong codes lock it; an expired code answers `expired_code`; a waitlist code is refused by `/auth/otp/verify` and a sign-in code by `/waitlist/confirm`; `Jose`, `JOSE` and the accented form collide; a handle held by a profile, by a confirmed reservation and by another email's live pending hold all answer `handle_taken`; an expired pending hold frees the handle; two concurrent confirmations for one handle yield one winner; the same email with another handle replaces the first and frees it; an email with an account answers `already_registered`, a legacy email `legacy_account_pending`, and neither is revealed by `/code`; a reserved handle answers `handle_invalid`; each Turnstile verdict; each limit with its `Retry-After`; the per-email send cap; the status token round trip and `not_found` after a delete; the admin delete (401, 403, deleted, absent).
- `backend/tests/nickname.test.ts` and `profile-guards.test.ts`: a reserved handle and a held handle are refused on the profile write and by both probes; an unchanged grandfathered handle still saves.
- `backend/tests/account-lifecycle.test.ts`: a purge removes the account's reservation.
- `backend/tests/worker.test.ts` or the waitlist suite: one prune run deletes the stale unconfirmed rows, a second does nothing, confirmed rows are untouched.
- `backend/tests/shared-drift/domain-limits.test.ts`: reserved list, Turnstile action.
- App: `src/tests/lib/services/waitlist.services.spec.ts` (wire code to adapter code, the cache cleared on `not_found`).
- E2E (`e2e-web2/waitlist.spec.ts`, code read from `GET /__e2e/otp/:email` or its waitlist twin): join from the landing, reload and see the handle, a second browser sees the handle as taken, the signed-in handle editor refuses it.

**Rollout.** The migration ships dark: nothing calls the routes until the landing does. Go-live needs `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` and `RESEND_API_KEY` in production, the policy text published, and the beta gate in the state W2 describes. Rollback is the previous image; the table stays, and reservations made meanwhile keep their rows but stop being honoured by the handle checks until the code returns.

**Risks**

- **Squatting.** Anyone with several mailboxes can hold several handles for free. The limits slow it, they do not stop it (pending decisions 5 and 11); W2's admin list is where it is seen and undone.
- **A reservation is a promise.** Once the landing says "Handle claimed", a later collision (the legacy import, a rule change) is a broken promise. Open question 1 must be closed before go-live.
- **Mail abuse.** The endpoint sends mail to an address its owner may not have typed. Turnstile, the IP limit, the per-email cap and the global breaker bound it; the email says what it is and that it can be ignored.
- **Deliverability.** A code that lands in spam ends the flow. The sending domain's reputation now carries a public form.
- **Per-instance limits** multiply with app machines (existing limitation).
- **Two protected paths change** (the handle validator and the profile write guard): a regression there affects every sign-up, not only the waitlist.

## Acceptance criteria

- [ ] Joining needs a handle that passes the app's rule, an email, and the 6-digit code sent to that email; the done state appears only after the server has confirmed.
- [ ] No account, session, profile or VXP exists after joining.
- [ ] Two people cannot hold the same handle in any letter case or accent form, from two browsers at the same moment.
- [ ] A reserved handle reads as taken in the anonymous probe, the signed-in probe, onboarding and the handle editor, and the profile write refuses it.
- [ ] A handle held by any existing profile, imported ones included, cannot be reserved.
- [ ] A platform-reserved name is refused by the API, not only by the app.
- [ ] A waitlist code cannot sign anyone in, and a sign-in code cannot confirm a reservation.
- [ ] A code works once, for ten minutes, for five attempts.
- [ ] The code request passes Turnstile and the limits of section 4; each refusal has a stable code.
- [ ] Before the code is proven, no answer differs by whether the email is known.
- [ ] The row stores the consent time and the policy version, and none of: IP, user agent, locale, plaintext code.
- [ ] An unconfirmed row is gone 24 hours after its last code request.
- [ ] An admin can delete a reservation by email; the handle is free at once.
- [ ] The reservation survives clearing the browser's storage; a returning visitor's cached handle is checked against the server.
- [ ] `PRODUCT.md`, `backend/README.md` and the reusability pages describe the shipped behaviour; `bun run typecheck && bun test` in `backend/`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Are all legacy handles already in `profiles` in production, and what does the final import do on a handle collision?** If the import has not run, or runs again later, a visitor could reserve a handle a legacy user holds. The answer decides whether the waitlist must also check `legacy_auth_identities` or an export of legacy handles.
2. **What state is the beta gate in on production today** (`enabled`, `allowNewUsers`, how many allowlisted addresses)? W2 depends on it; this part needs it only for the rollout.
3. **Resend plan limits** (sends per second, per day, per month) and the expected arrival rate at go-live: they set `WAITLIST_CODE_GLOBAL_LIMIT_PER_HOUR` and tell whether the account needs a higher tier.
4. **Does `upsertMyProfile` take any lock today that could cycle with the handle lock** (it runs in a transaction; confirm it takes no email lock)?
5. **Can a signed-out visitor open `/info/privacy` on the web2 build**, or does the route sit behind the app gate? If it does, the privacy link needs a public target.
6. **Counsel**: the wording beside the email step, the policy paragraph, the legal basis, and whether a checkbox is required in any market served.
7. **The capsule's adapter as built**: the exact type the landing page PR exports, so `waitlist.services.ts` implements it rather than a near copy, and whether it already passes the entry point.
8. **How many app machines run in production**, to judge the per-instance limits.

## Pending decisions

Each has a recommendation and the alternatives. "Owner" decisions are product calls.

1. **Is the handle held while the code is on its way?** Recommended: yes, for the ten minutes the code lives, so a handle shown as free is still free when the visitor types the code. Alternative: no hold until the code is confirmed; simpler, but someone else can take the handle in those minutes and the visitor must pick again and wait for a second code.
2. **The same email asks again with a different handle.** Recommended: the new handle replaces the first (after the code is confirmed), one handle per email, until the person is admitted. Alternatives: the first handle is final and the visitor is told which one they hold; or one email may hold several handles (not recommended: it invites squatting).
3. **The email already has a VICI account on vici.app.** Recommended: refuse after the code is proven, with a line such as "You already have an account. Sign in.". Alternatives: let them reserve a second handle for a later rename; or accept silently and ignore it later.
4. **The email belongs to an account on the legacy app (vici.market).** Recommended: refuse after the code is proven, with a line saying the account and its handle move over automatically, so there is nothing to reserve. Alternatives: let them reserve, and the reserved handle replaces the legacy one when the account moves; or let them reserve and drop the reservation when the account moves.
5. **Blocked names.** Recommended: the API enforces today's list (`admin`, `vici`, `support` and the others in `RESERVED_HANDLES`), the owner supplies brand, product and staff names to add before go-live, and impersonation of public figures is handled on report by an admin removing the reservation. Alternatives: a pre-loaded list of celebrity and brand names; or reserve such names only against proof.
6. **How long a reservation is kept if the person is never admitted.** Recommended: until admission or a removal request, with no time limit, because the page promises to hold the handle; the policy says so. Alternative: a fixed limit (for example 12 months) after which the person is asked to confirm again or is removed.
7. **Consent at the email step.** Recommended: a sentence with the privacy link beside the field, no checkbox; the time and the policy version are stored. Alternative: an explicit checkbox that must be ticked (heavier, sometimes preferred by counsel).
8. **An email after joining.** Recommended: none; the code email carries one line on what happens next and how to be removed. Alternative: a second email, "@handle is held for you", as a receipt (one more email within a minute of the first).
9. **How a person gets removed.** Recommended for the first release: they write to the contact address and an admin removes them (the tool exists from day one). Alternatives: a "remove me" link in every waitlist email; or a remove action in the capsule for the browser that joined.
10. **Does the page recognise a returning visitor from the server?** Recommended: yes, with a private token kept in the browser, so the page can show "@handle, on the waitlist" and, later, "you're in". Alternative: trust the browser's own memory only; simpler, but the page may show a handle that has since lapsed.
11. **Alias and throwaway addresses.** Recommended: accept every address as typed (apart from letter case) and rely on the limits and the admin list. Alternatives: treat `name+tag@` and dotted Gmail variants as one person; or refuse known disposable-mail domains.
12. **Does an invite or challenge link still credit the inviter when the friend can only join the waitlist?** Recommended: yes; the reservation remembers the last link the visitor arrived through, and the credit is applied when they create the account (W3). Alternative: no credit for people who come through the waitlist.
13. **Analytics names.** Recommended: three server events with their own names (`waitlist_code_requested`, `waitlist_joined`, `waitlist_join_refused`). Alternative: no additions, only `onboarding_step` with a `waitlist` source (cheaper, but the join cannot be told apart from a real onboarding step without care).
14. **A marketing opt-in beside the email step.** Recommended: no; the address is used for the waitlist only. Alternative: an optional, unticked "send me news" box, which then needs an unsubscribe path the app does not have today.
15. **Which of the app's two handle rules applies.** Recommended: the one account creation uses today (2 to 16 characters, letters, digits and `. _ -`), the same rule the anonymous probe applies. Alternative: the stricter rule of the in-app handle editor (3 to 15, no `.` or `-`), which would make a reserved handle always editable later but refuses some handles onboarding accepts.

## Decisions

Fixed by the owner:

- The steps are handle, email, 6-digit code, done; the done line is "Handle claimed. You're on the waitlist.". No account is created and the visitor cannot play until admitted.
- The handle rule is the app's; the check is live and public.
- The code request is Turnstile-protected and rate-limited.
- A reserved handle is unavailable to everyone else, in the public check, onboarding and the handle editor, and is claimable by the same email at account creation.
- The capsule calls `requestCode` and `confirm` through an injected adapter.
- Privacy link beside the email step, consent time stored, data minimisation, deletion on request.

Author's technical choices (a reviewer may overrule them; none changes what a visitor sees):

- **The code lives on the reservation row, not in `otp_codes`.** A row there is a sign-in code: with no purpose column, a waitlist code for an address could be presented to `/auth/otp/verify`. Keeping the table untouched leaves the sign-in path exactly as it is, makes cross-use impossible by construction, and puts the handle and its code in one row so the confirmation is one atomic update. The primitives (`generateOtp`, `peppered`, `constantTimeEqual`, `codeExpiryNotice`, the conditional attempt update) are reused; `backend/src/school/verification.ts` already follows this shape.
- **A fresh Turnstile token per code request, not the probe's reusable proof.** The proof exists so a per-keystroke read costs one challenge per window; a request that sends an email is the costly act and gets its own single-use token.
- **Wire error codes are the adapter's** (`email_invalid`, not the sign-in route's `invalid_email`), so the service maps nothing.
- **Uniqueness across `profiles` and the waitlist is a shared advisory lock plus a check**, since no index spans two tables; each table keeps its own unique index as the last resort.
- **No IP on the row.** The limiter's memory and Cloudflare are the only places it goes.
