# Spec: Handle waitlist, reserve a handle with a verified email

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#1779)

The waitlist is specified in six parts, each with its own status and its own implementation PR, because one PR per purpose would not hold all of it:

| Part   | Spec                                                                                     | Implementation PR title                                                   | Stacks on                                              |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| **W1** | this file: the reservation, the two public operations, the hold, the emails, privacy     | `feat(waitlist): reserve a handle with a verified email`                  | the handle rule PR (R1) and the public handle check PR |
| W2     | [`2026-11-27-feat-waitlist-admission.md`](./2026-11-27-feat-waitlist-admission.md)       | `feat(waitlist): admit waitlisters and edit the beta gate from the admin` | W1                                                     |
| W3     | [`2026-11-27-feat-waitlist-handle-claim.md`](./2026-11-27-feat-waitlist-handle-claim.md) | `feat(waitlist): claim the reserved handle at account creation`           | W1                                                     |
| W4     | [`2026-11-27-feat-waitlist-landing-taps.md`](./2026-11-27-feat-waitlist-landing-taps.md) | `feat(waitlist): keep landing calls with the reservation`                 | W1, W3 and the challenge links API (A1)                |
| W5     | [`2026-11-27-feat-waitlist-invites.md`](./2026-11-27-feat-waitlist-invites.md)           | `feat(waitlist): invites move the inviter up the list`                    | W2 (the list); a waitlister's own link comes from W4   |
| W6     | [`2026-11-27-feat-waitlist-renewal.md`](./2026-11-27-feat-waitlist-renewal.md)           | `feat(waitlist): renew a reservation after twelve months`                 | W1                                                     |

After W1: W2, W3 and W6 can be built in parallel; W4 follows W3, W5 follows W2. The landing can go live with W1 alone (people join the list). W2 and W3 must both be merged before the first person is admitted. W4 must be merged before the capsule's done state offers "Challenge a friend". W6 has eleven months of slack.

Dependencies outside this set, none on `main` at authoring time:

- **R1**, the handle rule: `specs/2026-11-27-impr-handle-rule-and-lookalikes.md` on branch `claude/landing-xgugio-handle-rule-spec` (`HANDLE_PATTERN`, `MIN_HANDLE_LENGTH`, `MAX_HANDLE_LENGTH`, `handleUniqueKey`, `cleanHandle`, `RESERVED_HANDLE_KEYS`, `profiles.handle_key`).
- **The public handle check PR**, branch `claude/landing-xgugio-public-handle-check` (Turnstile and proof helpers, the anonymous probe).
- **The landing capsule**, branch `claude/landing-xgugio-nav-claim` (`sanitizeHandleInput` and `handleFormatIssue` in `src/lib/utils/handle.utils.ts`, the `LandingClaim*` components, the injected adapter).
- **A1**, the challenge links API, branch `claude/landing-xgugio-challenge-links-api`.

## Goal

A signed-out visitor on the landing picks a handle, gives an email, types the 6-digit code sent to that email, and reads "Handle claimed. You're on the waitlist.". From that moment the handle is held for that mailbox: nobody else can reserve it or take it in the app. A receipt arrives by email, in the visitor's language, with a link that removes them. No account, session, profile or VXP is created, and the visitor cannot play until admitted (W2) and until they create the account (W3).

## Context

- **Handle rule (R1).** A handle is lowercase `a` to `z` and `0` to `9`, 3 to 15 characters. Its uniqueness key, `handleUniqueKey`, ignores case, accents and the separators `.`, `_`, `-`; for a handle that satisfies the rule the key is the handle itself. `checkNicknameAvailability` in `backend/src/profiles/nickname.ts` answers `required`, `too_short`, `too_long`, `invalid`, `reserved` or `taken`, comparing against `profiles.handle_key`, and every profile write passes through it (`assertValidNickname` in `backend/src/profiles/profile-write.ts`). The reserved list is server-enforced by R1 (`RESERVED_HANDLE_KEYS`, mirrored from `RESERVED_HANDLES` in `src/lib/constants/profile.constants.ts`). The capsule already applies the input rule and transliterates accents as the visitor types.
- **Imported legacy handles** live in `profiles` (written by `backend/scripts/etl/transforms.ts` under provisional accounts adopted at first sign-in, `backend/src/auth/adoption.ts`), so they are covered by the same check once the import has run.
- **One-time codes.** `backend/src/auth/otp.ts` over `otp_codes` (`0002_auth_identity.sql`): 6 digits from `generateOtp`, hashed with `peppered` (`backend/src/lib/crypto.ts`), ten minutes, five attempts spent by one conditional `update` before the compare. `verifyOtp` ends in `resolveIdentity`, which provisions an account, and `/auth/otp/verify` mints a session: neither may happen here. `otp_codes` has no purpose column, so a code stored there is a sign-in code. `backend/src/school/verification.ts` is the precedent for a second code flow with its own storage.
- **Email.** `backend/src/lib/email.ts`: `sendEmail` (Resend, console fallback outside production), `codeExpiryNotice`, `setEmailTransport` (test seam). Today the API sends two emails, both English: the sign-in code and the school code. There is no localisation, no template system and no unsubscribe handling.
- **Locales.** `REGISTERED_LOCALE_IDS` in `backend/src/markets/locales.ts`, mirrored from `src/lib/constants/locale.constants.ts`; the live ones are `SUPPORTED_LOCALES` (seven).
- **Rate limiting.** `enforceLimit` / `clientIp` (`backend/src/lib/rate-limit.ts`, `backend/src/lib/http.ts`), in memory, per instance.
- **Bot protection.** `verifyTurnstileToken` and `MAX_TURNSTILE_TOKEN_LENGTH` in `backend/src/lib/turnstile.ts`; on the app side `acquireTurnstileToken` in `src/lib/services/turnstile.services.ts` and the action names in `src/lib/constants/turnstile.constants.ts`.
- **Per-email serialisation.** `lockLoginEmails` in `backend/src/auth/adoption.ts`, with its lock order documented at the top of the file.
- **Account purge.** `purgeExpiredAccount` in `backend/src/account/lifecycle.ts`; `PRODUCT.md` "Privacy: what survives an account's deletion".
- **Privacy policy.** `src/lib/constants/legal-docs.constants.ts` (slug `privacy`, rendered at `/info/privacy`); contact `INFO_EMAIL` in `src/lib/constants/contact.constants.ts`.

## Scope

### 1. Data model

**`waitlist_reservations`**, one row per mailbox:

| Column                                                               | Holds                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id uuid`                                                            | primary key                                                                                                                         |
| `email text not null`                                                | the address as typed, trimmed and lowercased (`normalizeEmail`): where mail is sent                                                 |
| `email_key text not null`                                            | the mailbox key of section 3; **unique**                                                                                            |
| `handle text`                                                        | the confirmed handle; `check` against the rule's pattern and bounds; null until the first confirmation                              |
| `pending_handle text`                                                | the handle a code was last requested for, not yet confirmed                                                                         |
| `code_hash text`, `code_expires_at timestamptz`, `code_attempts int` | the live code (one per row), hashed; its expiry; attempts spent                                                                     |
| `status_token_hash text`                                             | section 7                                                                                                                           |
| `locale text not null`                                               | the landing's language when the code was requested, one of `REGISTERED_LOCALE_IDS`: the language of every email to this person      |
| `consent_at timestamptz not null`, `privacy_version text not null`   | when the email step was submitted next to the privacy sentence (server clock) and which policy version the app displayed            |
| `source text not null`                                               | which entry point of the landing opened the capsule (`nav`, `markets`, `footer`, `call`); a closed vocabulary enforced by a `check` |
| `invited_referral_code text`, `invited_challenge_id text`            | the last invite or challenge link the visitor arrived through, at most one set                                                      |
| `created_at`, `confirmed_at`, `expires_at`                           | row creation; first confirmation; the end of the twelve-month hold (W6 sends the re-confirm email and removes rows past this date)  |
| `hold_ended_at`, `account_user_id uuid`                              | written by W3 when the account takes the handle or lets it go                                                                       |

W2, W5 and W6 add their own columns in their own migrations.

**The per-mailbox send cap** on mail an anonymous request can cause is kept apart from reservations, because sections 4.3 and 4.4 send mail to mailboxes that get no reservation. As built it is a window of the shared limiter's `rate_limit_windows` (`enforceSharedLimit`, keyed by the mailbox key), which prunes itself, so no table of its own.

**Not stored:** IP address, user agent, name, the plaintext code, the plaintext status token.

**Uniqueness.**

- `unique (email_key)`: one reservation, so one handle, per mailbox.
- `unique (handle) where handle is not null and hold_ended_at is null`: two mailboxes never hold the same handle. A handle that satisfies the rule is its own key, so this index is also the lookalike guard among reservations.
- **Against profiles** (imported ones included) no index spans two tables. Both writers take one advisory lock on the handle key inside their transaction before checking and writing: `pg_advisory_xact_lock(hashtextextended('handle:' || key, 0))`. The waitlist takes the email lock first (`lockLoginEmails`, on the typed address and on the key), then the handle lock; the profile write takes only the handle lock.
- **The pending hold.** While a code is live, `pending_handle` counts as taken for everyone else. It is enforced by the check under the handle lock, not by an index, because it depends on the clock.

**One validator.** `checkNicknameAvailability` gains the waitlist clause, so every caller agrees on "taken": the anonymous probe, the signed-in probe, the profile write guard (onboarding and the handle editor end there) and the waitlist itself. A handle is `taken` when a profile holds its key, or a reservation holds it (confirmed, hold not ended), or another mailbox holds it pending with a live code. The function takes an optional `excludeReservationKey` so a reservation never conflicts with itself; W3 uses the same parameter for the owner's exemption. In this part nobody is exempt.

### 2. Routes

A new area: `backend/src/routes/waitlist.ts` (`waitlistRoutes`, prefix `/api/v1/waitlist`, mounted in `backend/src/index.ts`), logic under `backend/src/waitlist/`.

**`POST /api/v1/waitlist/code`** (the adapter's `requestCode`)

Body: `{ handle, email, turnstileToken, privacyVersion, source, locale, referralCode?, challengeId? }`, every string length-capped by a named constant.

In order: IP limit; body validation; Turnstile; email shape; disposable domain (section 3); handle format through the shared validator. Then, in one transaction under the email and handle locks: the per-mailbox send cap; handle availability; and one of three outcomes, **all answered with the same body**:

1. the mailbox already signs in to a vici.app account: no row, the email of section 4.3;
2. the mailbox belongs to a legacy account: no row, the email of section 4.4;
3. otherwise: upsert the row (`pending_handle`, a fresh code replacing any earlier one, attempts reset, `consent_at`, `privacy_version`, `source`, `locale`, attribution) and send the code email.

| Answer                                                                | When                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `200 { ok: true, codeTtlMs }`                                         | any of the three outcomes above                                        |
| `400 { error: 'email_invalid' }`                                      | empty, no `@`, longer than `MAX_WAITLIST_EMAIL_LENGTH`                 |
| `400 { error: 'email_not_accepted' }`                                 | a disposable-mail domain                                               |
| `400 { error: 'handle_invalid' }`                                     | fails the rule or is a reserved name                                   |
| `409 { error: 'handle_taken' }`                                       | a profile, a reservation or another mailbox's live pending hold has it |
| `403 { error: 'turnstile_failed' }`                                   | Cloudflare refused the token                                           |
| `503 { error: 'turnstile_unavailable' }` / `'turnstile_unconfigured'` | as the handle probe answers them                                       |
| `429 { error: 'rate_limited' }` with `Retry-After`                    | IP limit, the per-mailbox send cap or the global breaker               |

No answer depends on what the server knows about the mailbox. `handle_taken` is computed the same way in all three outcomes, and outcomes 1 and 2 place no hold. Delivery failures are logged and do not change the answer, as in `requestOtp`.

**`POST /api/v1/waitlist/confirm`** (the adapter's `confirm`)

Body: `{ email, code }`. IP limit; then one transaction under the email lock: find the row by mailbox key, spend an attempt with the conditional `update ... where code_attempts < $max returning`, compare in constant time, take the handle lock, re-check availability, write.

| Answer                          | When                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200 { handle, statusToken }`   | the pending handle became the confirmed one (replacing and releasing an earlier one); the code is burnt; `confirmed_at` and `expires_at` set on the first confirmation; the receipt email is sent |
| `401 { error: 'invalid_code' }` | wrong code, no row for this mailbox, or a row with no live code                                                                                                                                   |
| `410 { error: 'expired_code' }` | a never-confirmed row whose code has expired or whose attempts are spent: ask for a new one                                                                                                       |
| `409 { error: 'handle_taken' }` | the handle was lost between request and confirmation (cannot happen while the hold works; kept as the honest answer if it does)                                                                   |
| `429 { error: 'rate_limited' }` | IP limit                                                                                                                                                                                          |

`expired_code` is answered only for a never-confirmed row, so the route does not reveal whether a mailbox is on the list. A confirmation mints no session and sets no cookie.

**`POST /api/v1/waitlist/status`**: body `{ statusToken }`; `200 { handle, state }` with `state` `waiting` (W2 adds `admitted`, W3 `joined`) or `404 { error: 'not_found' }`. IP-limited. The token rides the body, never a URL.

**`POST /api/v1/waitlist/remove`**: body `{ id, token }` from the link of section 5; deletes the reservation and everything hanging from it, sends the removal confirmation, answers `{ removed: true }` whether or not a row was there. IP-limited.

**`DELETE /api/v1/waitlist/admin/reservations`**: admin only (`requireUser`, then `requireAdmin`), body `{ email }`; the same deletion, for removal on report (impersonation) and for requests that arrive by mail. W2 puts a button on it.

**The adapter** (`src/lib/services/waitlist.services.ts`), refined from the two operations the capsule calls:

- `requestCode({ handle, email, source })` resolves `{ ok: true }` or `{ error }`; the service adds the Turnstile token, the privacy version, the locale and any stashed invite.
- `confirm({ email, code })` resolves `{ handle }` or `{ error }`; the service keeps the status token.
- `restore()` resolves `{ handle, state }` or nothing, for a returning visitor.
- Error codes: `handle_taken`, `handle_invalid`, `email_invalid`, `email_not_accepted`, `invalid_code`, `expired_code`, `rate_limited`, `bot_check_failed` (any Turnstile refusal), `unavailable` (network or 5xx). The capsule needs a line for each.

### 3. One mailbox, real mailboxes

- **`emailMailboxKey(email)`** in `backend/src/waitlist/mailbox.ts`: lowercase and trim; drop a `+tag` from the local part; for `gmail.com` and `googlemail.com` drop the dots of the local part and write the domain as `gmail.com`. `Jo.Smith+vici@googlemail.com` and `josmith@gmail.com` are one mailbox. The typed address is kept for sending; the key is what uniqueness, the send cap, the gate (W2), the claim (W3) and the invite count (W5) compare.
- **Existing accounts and legacy accounts** are matched by mailbox key, not by address: a migration adds the key to `auth_identities` (`email_mailbox_key`) and `legacy_auth_identities` (`openid_email_mailbox_key`, `profile_email_mailbox_key`) as generated columns over an immutable SQL twin of `emailMailboxKey`, so existing rows are filled by the migration and every writer fills them without a change, with an index on each. `emailMailboxKey` is `otpMailboxKey` itself, the key the sign-in code limit already uses. The waitlist looks up both tables by the visitor's key, so an account stored as `name+vici@gmail.com` is found when the visitor types `name@gmail.com`. A parity test pins the SQL backfill against the TypeScript function.
- **Disposable domains are refused.** The list is `backend/src/waitlist/disposable-domains.txt`, one domain per line, generated from the community list published as `disposable-email-domains` and loaded once into a set at boot. `backend/scripts/update-disposable-domains.ts` regenerates it; a scheduled workflow (`.github/workflows/update-disposable-domains.yml`, monthly) runs the script and opens a PR when the file changed, so every update is reviewed like code. Between releases an admin can add or exempt a domain at once through the app setting `waitlist_email_domains` (`{ block: string[], allow: string[] }`, read with `readAppSetting`); `allow` wins over the file. A subdomain of a listed domain is refused too.

### 4. Emails

Every email of the waitlist is written in the person's language, through one module: `backend/src/waitlist/emails.ts` (one builder per email) over `backend/src/waitlist/email-copy/<locale>.ts`, one file per live locale typed against the English one, so a missing line is a type error and a test pins that every live locale has every key. A registered locale without a file falls back along the app's chain to English. All go through `sendEmail`.

| Email                     | Sent when                                                 | Part |
| ------------------------- | --------------------------------------------------------- | ---- |
| 4.1 Code                  | a code is stored                                          | W1   |
| 4.2 Receipt               | a confirmation succeeds                                   | W1   |
| 4.3 Already a member      | a code is requested for a mailbox with a vici.app account | W1   |
| 4.4 Legacy account        | a code is requested for a legacy mailbox                  | W1   |
| 4.5 Removal confirmation  | a reservation is deleted through the remove link          | W1   |
| Admission, claim reminder |                                                           | W2   |
| Inviter digest            |                                                           | W5   |
| Re-confirm                |                                                           | W6   |

- **4.1** The 6-digit code, its lifetime (from the constant), what it does, and that the mail can be ignored. Subject distinct from the sign-in code's.
- **4.2** "@handle is yours, you're on the waitlist", what happens next, how long the hold lasts.
- **4.3** "You already have a VICI account with this address. Sign in here.", with the sign-in link. No code. In the language of the request.
- **4.4** "Your VICI account moves to vici.app automatically, with your handle. Keep playing on vici.market meanwhile." No code.
- **4.5** One line confirming the handle was released and the data deleted. Sent to the address just deleted, then nothing is kept.
- 4.1, 4.2 and every later email to a reservation end with the remove link of section 5. 4.3 and 4.4 have none: nothing is stored for those mailboxes beyond a day of send-cap counting.

**Delivery of the emails a worker job sends** (admission and claim reminder of W2, the inviter digest of W5, the re-confirm notices of W6). A stamp written before the send loses the email for good when the process dies between the commit and the provider call; a stamp written after it sends twice when the process dies between the call and the commit. So these emails go through one helper, `deliverOnce(key, build)` in `backend/src/waitlist/delivery.ts`, over a table `waitlist_email_deliveries` (`delivery_key text primary key`, `created_at timestamptz not null default now()`, `claimed_at timestamptz not null`, `sent_at timestamptz`):

1. **Claim with a lease.** `insert ... values ($key, now()) on conflict (delivery_key) do update set claimed_at = now() where sent_at is null and claimed_at < now() - WAITLIST_EMAIL_LEASE_MS returning created_at`. No row back means another run holds the lease or the email went out: skip it. A run that died anywhere before the send leaves a lease that expires, and a later tick claims it again.
2. **Send with the key as the provider's idempotency key.** `EmailMessage` gains an optional `idempotencyKey`, which `sendEmail` passes to Resend as the `Idempotency-Key` header (Resend keeps it 24 hours, far longer than the lease). A run that died after the provider accepted the email and before step 3 re-sends with the same key and the provider drops the duplicate.
3. **Stamp after the send**, in one transaction: `sent_at` on the delivery row and the caller's own column (`admission_email_sent_at` and the like). A returned error deletes the unsent delivery row, so the next tick retries at once.

The key names the email and its cycle, so a retry reuses it and a new cycle gets a new one: `admission:<id>:<admitted_at>`, `claim-reminder:<id>:<admitted_at>`, `invite-digest:<inviter id>:<last_invite_notice_at or 0>`, `renewal-<days>:<id>:<expires_at>`. What an email says is computed from `created_at` of the delivery row, which a re-claim does not move, so a retry sends the same content (Resend refuses a reused key with a different body). The worker prunes delivery rows older than seven days with `sent_at` set.

### 5. Removal without login

- Each email to a reservation carries `https://vici.app/waitlist/remove?r=<id>&t=<token>`, where the token is `peppered('waitlist-remove\n' + id)`: nothing extra is stored, and the link is the same in every email.
- The link opens a public page, `src/routes/waitlist/remove/+page.svelte`, that states what will be deleted and has one button. Only the button's `POST` deletes: mail scanners that open links cannot remove anyone.
- Deletion removes the row, releases the handle at once and, in the later parts, takes the stored taps, the challenge links issued from them and the invite counters with it. Once the person has an account (W3) the reservation only carries their admission, and the same link turns off further waitlist mail instead of deleting it; the account is deleted through the app.

### 6. The code, Turnstile and limits

- 6 digits from `generateOtp`, stored as `peppered('waitlist\n' + email_key + '\n' + code)`, so a waitlist hash can never equal a sign-in hash; compared with `constantTimeEqual`.
- `WAITLIST_CODE_TTL_MS`: ten minutes, which is also the pending hold. `WAITLIST_CODE_MAX_ATTEMPTS`: five, spent before the compare. One live code per mailbox: a fresh request replaces it.
- `WAITLIST_SENDS_PER_DAY`: five mails per mailbox per 24-hour window across 4.1, 4.3 and 4.4, counted in `rate_limit_windows`.
- Every code request carries a fresh Turnstile token for its own action (`waitlist_code`, a constant mirrored in `src/lib/constants/turnstile.constants.ts` and pinned by the drift suite). Production without `TURNSTILE_SECRET_KEY` refuses, never opens.
- Named constants at the top of `backend/src/routes/waitlist.ts`, windows from `backend/src/lib/time.ts`:

| Constant                                 | Value                              | Keyed by                                                         |
| ---------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `WAITLIST_CODE_LIMIT_PER_TEN_MINUTES`    | 5                                  | IP                                                               |
| `WAITLIST_CONFIRM_LIMIT_PER_TEN_MINUTES` | 15                                 | IP                                                               |
| `WAITLIST_STATUS_LIMIT_PER_TEN_MINUTES`  | 30                                 | IP                                                               |
| `WAITLIST_REMOVE_LIMIT_PER_TEN_MINUTES`  | 10                                 | IP                                                               |
| `WAITLIST_CODE_GLOBAL_LIMIT_PER_HOUR`    | 600 (open question 3 may lower it) | all callers: a breaker on the email bill, shared across machines |

### 7. Returning visitors

`confirm` returns a random status token, stored hashed. The service keeps it with the handle in `localStorage` (key in `src/lib/constants/waitlist.constants.ts`) as a cache of a server result. On load the capsule calls `restore()`: `not_found` clears the cache, so a removed or lapsed reservation never shows as held. Clearing the browser loses only the cache.

### 8. Retention and privacy

- **Never confirmed:** deleted 24 hours after the last code request by a worker job (`waitlist-prune`, hourly, a plain dated `delete`), which also prunes sent `waitlist_email_deliveries` rows.
- **Confirmed:** held twelve months from the first confirmation (`WAITLIST_HOLD_MONTHS`); W6 asks the person to re-confirm before the end and removes those who do not answer.
- **Account deleted:** `purgeExpiredAccount` deletes the reservation whose `account_user_id` is the purged account.
- **The consent sentence** sits beside the email field with a link to the Privacy Policy; there is no checkbox. `consent_at` is the server time of the code request and `privacy_version` is `PRIVACY_POLICY_VERSION`, a constant added next to the policy in `legal-docs.constants.ts` and bumped with its "Last updated" line.
- **The policy text** gains the waitlist: what is collected (email, handle, language, the times above; in later parts the calls tapped on the landing and who invited whom), why, for how long, and that every email carries a removal link. The wording is counsel's (open question 6); the implementation PR carries it.
- **No marketing.** The address is used for the waitlist's own emails only; there is no opt-in box and no list export.
- Analytics carry no email and no handle.

### 9. The app side

- `src/lib/web2/client.ts`: `requestWaitlistCode`, `confirmWaitlistCode`, `readWaitlistStatus`, `removeWaitlistReservation`.
- `src/lib/services/waitlist.services.ts`: the adapter the landing injects into the capsule. Web2 build only.
- `src/routes/waitlist/remove/+page.svelte` and its path in `src/lib/constants/routes.constants.ts` (public).
- The capsule skips the live probe for the handle whose pending hold this browser owns, so stepping back from the code field does not show the visitor's own handle as taken.
- i18n keys in every catalog: the capsule's added error lines (`landing.claim.*`), the consent sentence, the removal page (`waitlist.remove.*`).

### Out of scope

- Admission, the gate and its editor, the admin list: W2. The claim and onboarding: W3. Landing calls and "Challenge a friend": W4. List order and inviter emails: W5. The twelve-month re-confirmation: W6.
- The handle rule itself, the reserved list on the server, renaming existing handles: R1 and its follow-ups. The owner supplies brand, product and staff names for `RESERVED_HANDLES` before go-live; they land wherever that list lives at the time.
- The capsule's layout, steps and motion: the landing page PR.
- Turnstile on the sign-in code request: its own PR (`claude/landing-xgugio-email-code-turnstile`).
- Localising the sign-in and school code emails.
- Moving the rate limiter to a shared store.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open: #1176, #1142, #1091, #1034, #759, #543). None covers a waitlist or handle reservation. #543 (anti-farm hardening of the new-account mint surface) is adjacent: this part creates no account and mints nothing. No issue is linked.

## Analytics

Instrument, server-side, with three additions to the taxonomy, each in `src/lib/types/analytics-event.ts`, `src/lib/schema/analytics-event.schema.ts`, and `ANALYTICS_EVENT_NAMES` plus `SERVER_ANALYTICS_EVENT_NAMES` in `backend/src/analytics/taxonomy.ts`:

| Event                     | When                                           | Props                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waitlist_code_requested` | a code request passed validation and Turnstile | `source` (entry point), `locale`                                                                                                                                                                    |
| `waitlist_joined`         | a confirmation succeeded                       | `source` (entry point), `label` (`new` or `handle_changed`), `ok` (arrived through an invite or challenge link), `locale`                                                                           |
| `waitlist_join_refused`   | a request or confirmation was refused          | `label`, one of `handle_taken`, `handle_invalid`, `email_invalid`, `email_not_accepted`, `bot_check_failed`, `rate_limited`, `invalid_code`, `expired_code`, `already_registered`, `legacy_account` |

Captured with `captureServerEvents` and no `userId`. `already_registered` and `legacy_account` are recorded here although the visitor is not told. `signed_up` is not emitted: nobody signed up. No email, handle, IP or code is sent.

Client-side steps of the capsule belong to the landing analytics PR and reuse existing names (`onboarding_started`, `handle_checked`, `onboarding_step` with `source: 'landing_claim'`).

## Technical requirements (satellite / backend: mandatory)

- **Performance.** Two writes per joiner, each one transaction with three advisory locks and a handful of indexed lookups. The handle probe gains one indexed `exists` on `waitlist_reservations`; it is the hot path, capped by the probe's own limits. One Turnstile round trip and one email per code request, one more email per confirmation. The disposable check is a set lookup in memory. No satellite or engine call.
- **Memory and storage.** One row per mailbox, about 500 bytes with its indexes: 100,000 reservations are about 50 MB. The disposable list is a few megabytes in memory. `waitlist_send_caps` holds one small row per mailbox that asked for a code in the last day.
- **Scalability.** At 10 and 100 times the expected list the lookups stay index-only (`email_key`, `handle`, `pending_handle`). The per-instance limiter under-counts across app machines by the machine count; the send cap and the hold are in Postgres and do not.
- **Upgrade and compatibility.** One forward-only migration, `backend/src/db/migrations/NNNN_waitlist_reservations.sql` (the next free number at implementation time; sibling branches add migrations too), `create table if not exists` and `create index if not exists`. The previous release does not read the tables, so during a deploy an old machine does not see holds for a few seconds; the confirmation re-checks under the lock and the profile index stays the last resort. No `.did`, no bindings, nothing breaking.
- **Security.** Public unauthenticated writes: IP limits, Turnstile on the one that sends mail, a per-mailbox cap, bounded strings, the global body cap, the same-origin guard. Codes and the status token are hashed at rest with the session pepper; the removal token is an HMAC under it. No response distinguishes a known mailbox. Protected paths touched: `backend/src/db/**`, `backend/src/profiles/nickname.ts` and `profile-write.ts`, `backend/src/account/lifecycle.ts`, `backend/src/lib/email.ts` if a header or helper is added, the admin route. `backend/src/auth/**` is read and not changed.
- **Parameters.** Handle bounds and pattern: R1's constants. Code length: `generateOtp`. Locales: `backend/src/markets/locales.ts`. Everything introduced here is a named constant under `backend/src/waitlist/` or at the top of the route module; the figures in this spec are proposals for those constants.

## Implementation outline

1. **Migration** with the why at the top: the two tables and `waitlist_email_deliveries`, the unique indexes, an index on `pending_handle`, the `source` and `locale` checks.
2. **Domain** under `backend/src/waitlist/`: `mailbox.ts` (`emailMailboxKey`, the disposable set, the setting overlay), `reservations.ts` (constants, `requestWaitlistCode`, `confirmWaitlistCode`, `readWaitlistStatus`, `removeWaitlistReservation`, `pruneWaitlist`, `lockHandleKey`, `class WaitlistError`), `emails.ts`, `email-copy/` and `delivery.ts` (`deliverOnce`); the optional `idempotencyKey` on `EmailMessage` in `backend/src/lib/email.ts`.
3. **Validator**: the reservation clause and `excludeReservationKey` in `checkNicknameAvailability`; `lockHandleKey` before `assertValidNickname` when a write sets a handle.
4. **Routes**, mounted in `backend/src/index.ts`.
5. **Purge and worker**: the reservation delete in `purgeExpiredAccount`; `waitlist-prune` in `backend/src/worker.ts`.
6. **List tooling**: `backend/scripts/update-disposable-domains.ts`, the first generated file, the scheduled workflow.
7. **App**: section 9.
8. **Docs in the same PR**: `PRODUCT.md` (a "Waitlist: reserve a handle" entry; "Onboarding: one screen" notes that a reserved handle reads as taken; "Privacy: what survives an account's deletion" lists the reservation among what is removed), `backend/README.md` (routes, constants, the setting, the mirrored Turnstile action, the emails), `docs/ai/backend/reusability.md`, `docs/ai/backend/patterns.md` (localised email copy), `docs/ai/frontend/reusability.md`, `docs/ai/frontend/web2-backend-mode.md`.

**Tests**

- `backend/tests/waitlist.test.ts` (real Postgres, `setEmailTransport`, `setTurnstileSeam`, `resetRateLimits`, collision-free fixtures): the happy path creates no `users`, `auth_identities` or `sessions` row and sends the code then the receipt; a code works once, five wrong codes lock it, an expired one answers `expired_code`; a waitlist code is refused by `/auth/otp/verify` and a sign-in code by `/waitlist/confirm`; a handle held by a profile, by a profile lookalike (`a.b` against `ab`), by a reservation and by another mailbox's live pending hold all answer `handle_taken`; an expired pending hold frees the handle; two concurrent confirmations for one handle yield one winner; the same mailbox with another handle replaces the first and frees it; a mailbox with an account and a legacy mailbox get `200`, no row, no hold, and exactly the private email, in the requested language; a reserved name answers `handle_invalid`; each Turnstile verdict; each limit with its `Retry-After`; the send cap across the three mails; the status token round trip; the remove link (a wrong token removes nothing and answers the same, a right one deletes, frees the handle and sends 4.5); the admin delete (401, 403, deleted, absent).
- `backend/tests/waitlist-mailbox.test.ts` (pure): the key for plus tags, Gmail dots, `googlemail.com`, case; a listed domain, a subdomain of one, the `allow` and `block` overlay.
- `backend/tests/waitlist-emails.test.ts` (pure): every live locale has every key; each builder names the handle or code it was given and, where due, the remove link; an unknown locale falls back to English.
- `backend/tests/waitlist-delivery.test.ts` (real Postgres, `setEmailTransport`): two concurrent runs send once; a run that stops after the claim and before the send is retried once the lease ends; a run that stops after the send and before the stamp re-sends with the same idempotency key and the same content; a returned error is retried on the next run; a sent key is never claimed again.
- `backend/tests/nickname.test.ts`, `profile-guards.test.ts`: a held handle is refused on the profile write and by both probes.
- `backend/tests/account-lifecycle.test.ts`: a purge removes the account's reservation. Worker: one prune run deletes stale rows, a second does nothing.
- `backend/tests/shared-drift/`: the Turnstile action, the `source` vocabulary.
- App: `src/tests/lib/services/waitlist.services.spec.ts` (wire code to adapter code, the cache cleared on `not_found`).
- E2E (`e2e-web2/waitlist.spec.ts`): join from the landing, reload and see the handle, a second browser sees it as taken, the signed-in handle editor refuses it, the remove link frees it.

**Rollout.** The migration ships dark: nothing calls the routes until the landing does. Go-live needs R1 merged, `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` and `RESEND_API_KEY` in production, the policy text published, the owner's reserved names in the list, and the beta gate in the state W2 describes. Rollback is the previous image; the tables stay, and reservations made meanwhile stop being honoured by the handle checks until the code returns.

**Risks**

- **A reservation is a promise.** Once the landing says "Handle claimed", a later collision (the legacy import, R1's rename of existing handles) is a broken promise. Open questions 1 and 2 must be closed before go-live.
- **A visitor with an account waits for a code that never comes.** That is the price of an identical page; the private email explains, and it must arrive fast.
- **Folding can merge two real mailboxes** on a provider where `+` is not a tag. Rare; the admin delete and the allow-list of the gate are the remedy.
- **The disposable list goes stale between reviews**, and an over-eager entry refuses a real person. The setting's `allow` fixes one at once.
- **Mail abuse.** The endpoint sends mail to an address its owner may not have typed. Turnstile, the IP limit, the per-mailbox cap and the global breaker bound it.
- **Deliverability and translation quality** now carry a public form in seven languages.
- **Two protected paths change** (the handle validator and the profile write guard): a regression there affects every sign-up.

## Acceptance criteria

- [ ] Joining needs a handle that passes the app's rule, an email and the 6-digit code sent to it; the done state appears only after the server has confirmed.
- [ ] No account, session, profile or VXP exists after joining.
- [ ] Two mailboxes cannot hold the same handle, nor a lookalike of a handle an existing profile holds, from two browsers at the same moment.
- [ ] A held handle reads as taken in the anonymous probe, the signed-in probe, onboarding and the handle editor, and the profile write refuses it; that includes the ten minutes a code is live.
- [ ] A mailbox holds one handle; confirming another replaces and releases the first.
- [ ] `name+tag@`, dotted Gmail variants and `googlemail.com` count as one mailbox; a disposable domain is refused with its own code.
- [ ] For a mailbox with a vici.app account or a legacy account the page behaves exactly as for anyone else, no reservation is created, and the mailbox receives the matching private email.
- [ ] A waitlist code cannot sign anyone in, and a sign-in code cannot confirm a reservation.
- [ ] Every waitlist email is in the language the visitor used, in every live locale, and those sent to a reservation carry a link that removes it without login.
- [ ] Opening the removal link deletes nothing; pressing its button deletes the reservation and releases the handle.
- [ ] The row stores the consent time, the policy version and the language, and none of: IP, user agent, plaintext code.
- [ ] An unconfirmed row is gone 24 hours after its last code request.
- [ ] A returning visitor's cached handle is checked against the server and cleared when the reservation is gone.
- [ ] `PRODUCT.md`, `backend/README.md` and the reusability pages describe the shipped behaviour; `bun run typecheck && bun test` in `backend/`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Are all legacy handles in `profiles` in production, and what does the final import do on a collision** with a reservation made meanwhile? The answer decides whether the waitlist must also check an export of legacy handles.
2. **R1's follow-up renames existing handles to the rule** (R2). Does its planner treat reserved handles as taken when it picks a renamed handle? It must, or a rename can land on a reserved handle.
3. **Resend plan limits** (per second, per day, per month) against the expected arrival rate: they set `WAITLIST_CODE_GLOBAL_LIMIT_PER_HOUR`.
4. **Does `upsertMyProfile` take any lock today that could cycle with the handle lock?**
5. **Can a signed-out visitor open `/info/privacy` on the web2 build**, or does the route sit behind the app gate?
6. **Counsel**: the consent sentence, the policy paragraph, the legal basis, the receipt and removal emails, and whether refusing disposable addresses or folding aliases needs a line in the policy.
7. **The disposable list's licence and upstream location**, and whether the repository's workflows may open PRs on a schedule.
8. **The capsule's adapter type as built**, and whether it already passes the entry point and has lines for `email_not_accepted`.
9. **Who translates the email copy** into the six other live locales, and who reviews it.
10. **How many app machines run in production**, to judge the per-instance limits.

## Decisions

Owner decisions (27 Nov 2026):

- **Steps and done line.** Handle, email, 6-digit code, done; "Handle claimed. You're on the waitlist.". No account is created and nobody plays before admission.
- **The handle is held for the ten minutes the code lives.**
- **One handle per email.** A newly confirmed handle replaces the earlier one, which is released.
- **A mailbox that already has a vici.app account** sees the same page as everyone else and gets a private email: "You already have a VICI account with this address. Sign in here." No reservation.
- **A mailbox with a legacy vici.market account** sees the same page and gets a private email: "Your VICI account moves to vici.app automatically, with your handle. Keep playing on vici.market meanwhile." No reservation.
- **Blocked names** are a server-side list plus admin removal on report; the owner provides brand, product and staff names before go-live.
- **A reservation lasts 12 months**, then a re-confirm email; no answer releases it (W6).
- **Consent** is a sentence with the Privacy Policy link, no checkbox; the time and the policy version are stored.
- **A receipt email** follows the confirmation: "@handle is yours, you're on the waitlist".
- **A "remove me" link in every waitlist email**, working without login, deletes the reservation and its data.
- **Returning visitors are verified against the server** through a private token in the browser.
- **Aliases fold to one mailbox** (`+tag`, Gmail dots) **and known disposable-mail domains are refused**, from a maintained list.
- **Invite and challenge credit is recorded on the reservation** and applied at account creation (W3).
- **Three server events**: `waitlist_code_requested`, `waitlist_joined`, `waitlist_join_refused` with a bounded reason.
- **No marketing opt-in.**
- **The handle rule is the app-wide one of R1**: lowercase a to z and 0 to 9, 3 to 15, with a key that ignores case, accents and `.`, `_`, `-`; accents are transliterated on input.
- **Every email goes out in the visitor's language**; the landing's locale is stored with the reservation (decided with W2).

Author's choices that follow from them (a reviewer may overrule):

- **"The same page" is implemented at the code request**, before anything is proven: the response is identical, no code is sent, and the private email takes its place. Showing the done state to someone who gets no reservation would be a false statement, and deciding after the code would make the confirmation's answer the oracle.
- **The code lives on the reservation row, not in `otp_codes`.** A row there is a sign-in code; keeping that table untouched makes cross-use impossible by construction and puts the handle and its code in one row.
- **A fresh Turnstile token per code request**, not the probe's reusable proof: the request that sends mail is the costly act.
- **The removal token is derived, not stored**, and the link needs a button press, because mail scanners follow links.
- **The mailbox key is used wherever the waitlist matches a person** (uniqueness, cap, gate, claim, invite count), so someone who joined as `name+vici@` and signs in as `name@` is recognised.
- **The disposable list is a reviewed file plus a setting overlay**: a file alone cannot be corrected without a release, a setting alone has no history.
- **Wire error codes are the adapter's** (`email_invalid`, not the sign-in route's `invalid_email`).
- **No IP on any row.**
