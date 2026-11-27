# Spec: Team-only sign-in on the API

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress

Part 1 of 2. Part 2 is [`2026-11-27-feat-team-only-signin-app.md`](./2026-11-27-feat-team-only-signin-app.md) (the app's routes and entry points). The two build in parallel: this part is the boundary, part 2 only removes the doors.

## Goal

vici.app is a new product. Until the waitlist admits people, only the VICI team can sign in. The API refuses to start or finish a sign-in, and refuses to create an account, for any email that is not on a team allowlist held in server config, and it refuses any session whose account carries no allowlisted email. A team member signs in, uses the app and `/admin` exactly as today.

## Context

- **Sign-in points.** `backend/src/routes/auth.ts`: `POST /auth/otp/request` (sends the code), `POST /auth/otp/verify` (mints the session; `verifyOtp` in `backend/src/auth/otp.ts` calls `resolveIdentity`, which creates the account), `GET /auth/google/callback` and `POST /auth/apple/callback` (call `resolveIdentity`, then mint the session). The OAuth start routes (`GET /auth/google`, `GET /auth/apple`) never see an email. These are the only callers of `resolveIdentity` and `rotateSession`.
- **The beta gate.** `betaGateVerdict` (`backend/src/auth/beta-gate.ts`) already runs at those four points, reading the admin-editable `beta_gate` app setting. Its refusal is `403 { error: 'beta_closed' }`, one body for every address, and `/signin?e=beta` on the OAuth redirects. It is a rollout valve over sign-in only; established sessions are untouched, and it is off unless an admin turns it on.
- **Sessions.** `requireUser` (`backend/src/auth/guard.ts`) is the one place a session cookie resolves to a user; every authenticated route and `/me` goes through it.
- **Env.** `loadEnv` (`backend/src/env.ts`) is the one reader of `process.env`; tests mutate `env` groups with `Object.assign` (`backend/tests/beta-gate.test.ts`).
- **E2E.** `playwright.web2.config.ts` boots the API with `NODE_ENV=test`; specs sign in with per-run addresses on `E2E_EMAIL_DOMAIN` (`backend/e2e/fixtures.ts`) through `uniqueEmail`.

## Scope

1. **Config.** `env.teamSignin = { enforced, emails, domains }` from one var, `TEAM_SIGNIN_EMAILS`: comma-separated entries, each an exact address (`name@vici.app`) or a whole domain written `@vici.app`. Entries are trimmed and lowercased (`normalizeEmail`); empty entries are dropped. A malformed entry (no `@`, or more than one) fails boot. Enforcement: on whenever the var has an entry; in production also on when the var is unset or empty, which admits nobody (fails closed). Outside production an unset var leaves the gate off, so local dev and the existing suites keep working.
2. **One predicate.** `isTeamEmail(email)` in a new `backend/src/auth/team-gate.ts`, the only reader of `env.teamSignin`: true when the gate is off, or the normalized address is listed, or its domain is listed. No mailbox folding (no `+tag` or Gmail-dot stripping): the allowlist names exact inboxes.
3. **Sign-in refusal.** At the four points that learn the email, the team check runs first, before the beta gate and before any code is issued, any identity is resolved or any account is created. A refusal is the beta gate's own: `403 { error: 'beta_closed' }` for the OTP routes, a redirect to the sign-in screen with `?e=beta` for the OAuth callbacks. A non-team caller therefore gets the same answer as any other gated refusal, and never `legacy_account_pending` (which would reveal a legacy account). The OTP request refuses before the per-inbox rate limit, so a stranger spends no inbox budget.
4. **Session refusal.** `requireUser` resolves a session only when its account has at least one `auth_identities` row whose email passes the allowlist (gate off: unchanged). An existing session of a non-team account reads as signed out (`401 unauthenticated`), on every route and `/me`; the row is left to expire, so a later allowlist change restores it without a new sign-in.
5. **Refusal landing path.** The OAuth refusal and the sign-in error redirects land on the team sign-in path that part 2 adds, `/team` (`TEAM_SIGNIN_PATH` in `backend/src/auth/team-gate.ts`), since `/signin` becomes a redirect to `/` for the public.
6. **Docs.** `backend/README.md` (env table + a "Team-only sign-in" section next to "Beta access gate"), `docs/ai/PRODUCT.md`, `docs/ai/backend/reusability.md` (`isTeamEmail`).
7. **E2E.** `playwright.web2.config.ts` sets `TEAM_SIGNIN_EMAILS=@vici-e2e.test` (from `E2E_EMAIL_DOMAIN`), so every existing spec signs in with an allowlisted address; a new spec checks that an address on another domain gets the neutral refusal and never a code.

### Out of scope

- The app's routes and entry points (part 2).
- Admitting waitlisters. The waitlist admission spec (`2026-11-27-feat-waitlist-admission.md`) lets admitted people through the beta gate; while the team gate is enforced they stay out. Opening the door for them is a change to this gate, decided when admission ships.
- Removing or merging the beta gate. It stays as is behind the team gate; whether one valve replaces the other is a later call.
- Gating the OAuth start: it carries no email to check.

## Linked issues

No open issue covers this (searched `sign in`, `allowlist`, `team`, `beta gate`).

## Analytics

None. The refusals are 403s on anonymous calls and carry an email (PII); the only people past the gate are the team, whose usage is not product signal. Counting refusals would measure strangers poking an unlinked page.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** The sign-in check is in memory (an array lookup over a few entries), no query. The session check adds one `exists` over `auth_identities` to the `requireUser` query, which already joins `sessions` and `users` on every authenticated request. `auth_identities` has no index on `user_id`; the exact-address arm matches the existing `lower(email)` index, and the table holds one to three rows per account (hundreds today), so the probe stays sub-millisecond. With the gate off the clause short-circuits on a bound boolean.
- **Memory & storage.** No migration, no new table. The allowlist lives in process memory, a few entries.
- **Scalability.** At 10× / 100× accounts the `@domain` arm scans more identity rows per request; an index on `auth_identities (user_id)` is the fix if it ever shows (not added here: no measurable cost at today's size, and migration numbers are contended by open PRs).
- **Upgrade & compatibility.** Not breaking for the wire: refusals reuse `beta_closed` and `?e=beta`, which the app already renders. Deploying without the secret in production refuses every sign-in and every session, by design; the secret must be set before or with the deploy.
- **Security.** This is the boundary the app's hidden path relies on: the app can be bypassed, the API cannot. The allowlist is never sent to the client; `/auth/providers` is unchanged. The refusal is identical for every non-team address and for every other gated refusal.
- **Parameters.** The allowlist is `TEAM_SIGNIN_EMAILS`; the landing path is `TEAM_SIGNIN_PATH`. Nothing restated elsewhere.

## Implementation outline

1. `backend/src/env.ts`: `TeamSigninEnv`, parsed from `TEAM_SIGNIN_EMAILS` as above; `backend/tests/env.test.ts` covers the parsing and the production default.
2. `backend/src/auth/team-gate.ts`: `isTeamEmail`, `TEAM_SIGNIN_PATH`, and the SQL parameters `requireUser` binds.
3. `backend/src/routes/auth.ts`: the team check at the four points; refusal paths on `TEAM_SIGNIN_PATH`.
4. `backend/src/auth/guard.ts`: the identity clause in `requireUser`.
5. `backend/tests/team-gate.test.ts`: predicate, each sign-in point refused and admitted, no code mailed and no account created on refusal, an existing non-team session refused, a team session (and `/admin`) still served, gate off unchanged.
6. E2E config and `e2e-web2/team-gate.spec.ts`.

## Acceptance criteria

- [ ] With `TEAM_SIGNIN_EMAILS` set, a non-listed address gets `403 beta_closed` from `POST /auth/otp/request` and no email is sent.
- [ ] `POST /auth/otp/verify` with a valid code for a non-listed address answers `403 beta_closed` and creates no user.
- [ ] Google and Apple callbacks for a non-listed address redirect to `/team?e=beta`, create no user and set no session cookie.
- [ ] A listed address and an address on a listed `@domain` sign in through every provider as today; an admin among them reaches `/api/v1/admin/*`.
- [ ] A session whose account has no listed email answers `401 unauthenticated` on `/me` and every authenticated route.
- [ ] In production an unset or empty `TEAM_SIGNIN_EMAILS` admits nobody; outside production it leaves sign-in as today.
- [ ] A malformed entry fails boot.
- [ ] The web2 E2E suite passes with the allowlist on.

## Decisions

- **Server config, one var.** The allowlist is the Fly secret `TEAM_SIGNIN_EMAILS`, read once in `env.ts` and only through `isTeamEmail`; it is never in the app bundle. Chosen over the admin-editable `beta_gate` setting because a setting can be emptied from the app it protects, and over a hard-coded list because the team changes without a release.
- **Enforced on the backend at every point that learns the email, and on sessions.** The owner's decision: refuse to start or finish a sign-in, refuse to create an account, refuse existing non-team sessions. The app-side redirects (part 2) are convenience, not protection.
- **Same neutral answer as any other refusal.** `beta_closed` / `?e=beta`, so a stranger learns nothing about the allowlist or about legacy accounts.
- **Fails closed in production.** A missing secret admits nobody rather than everybody; outside production it is off so dev and the existing tests need no setup.
- **`@domain` entries.** Lets the E2E suite keep per-run addresses, and lets the owner admit the whole `@vici.app` workspace if they choose; exact addresses remain the default and the recommendation.
- **Exact inbox match, no folding.** A team member signs in with the address on the list; folding `+tags` would let anyone who can receive mail at `name+x@` of a listed Gmail inbox in, which is the same person, but the rule is simpler to audit without it.
- **Non-team sessions read as signed out, not deleted.** Reversible: re-listing an address restores its sessions.
