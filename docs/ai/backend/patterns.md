# Web2 API patterns

The patterns the API really uses, each with one example to copy. All paths are under `backend/`. Shared helpers are listed in [`reusability.md`](./reusability.md).

## Routes and validation

- One Elysia instance per area with a prefix: `src/routes/wallet.ts` (`walletRoutes`). Mounted with `.use(...)` on `app` in `src/index.ts`.
- Request shapes are Elysia `t` schemas in the route options (`src/routes/wallet.ts`, the `body` of `POST /withdrawals`). Zod is not used in the API; do not add it.
- A number that reaches an `int` or `bigint` column with no domain check before the write is `t.Integer` with its bounds (the domain's constants, or `Number.MAX_SAFE_INTEGER` for a `bigint` that must stay exact): Postgres refuses a fraction or an out-of-range value as a fault, so `t.Number` there turns bad input into a 500 (`src/routes/battles.ts`, `POST /`). A value the domain already checks as an integer, like the duel scores in `resolveDuel` (`src/leagues/battles.ts`), may stay `t.Number`; the same goes for the profile doc, whose integer counters `parseProfileInput` bounds to `[0, MAX_PROFILE_COUNTER]` (`src/profiles/profile-write.ts`).
- A sum that client figures feed into an `int` column (or an `int`-sized `jsonb` leaf) saturates at `PG_INT_MAX` (`src/lib/constants.ts`) instead of failing the write that carries it, and a client-sent lifetime count that feeds such a sum never decreases on write, so a drop and a rise back count once: `incrementAggregate` in `src/leagues/stats.ts`, `totalTrades` in `upsertMyProfile`, `storedCategoryStats` in `src/profiles/stats.ts`. The sum is taken inside the `on conflict do update`, on the row the upsert has locked, never read in one statement and written back in another, so concurrent writers all land: `fanoutCategoryDeltasToLeagueStats` (same file as `incrementAggregate`).
- An id from the path or the body that reaches a `uuid` column is checked with `UUID_RE` (`src/lib/constants.ts`) before the query: Postgres refuses text that is not a uuid as a fault, so the bind turns bad input into a 500. Answer it the way the route answers an id that names nothing (`unknown_asset` in `src/routes/wallet.ts`, `POST /withdrawals`; the not-found result in `src/routes/school.ts`, `/verify`), or with a `badRequest` code where the route has no such answer (`src/routes/leaderboard.ts`, `/rank/:userId`). A lookup that several routes share takes the check itself, so an id that is not a uuid reads as absent everywhere (`getLeagueMember` in `src/leagues/members.ts`).
- A handler gates first, then calls a domain function, then shapes the response: `src/routes/wallet.ts` (`/balances`).
- Responses that carry candid values (bigint, `Principal`, bytes) go through `toJson` (`src/engine/serialize.ts`); never hand-convert.

## Auth guards

- `requireUser(request)` (`src/auth/guard.ts`) returns the `AuthedUser` or `null`; on `null` return `unauthenticated(set)` (401). Admin endpoints check `requireUser` first and then `requireAdmin` (same file) with `forbidden(set)` (403), so the 401/403 split stays honest: `src/routes/vxp.ts` (`/admin/treasury`).
- Sessions are cookies; never read a user id from the body or the query.
- Every write (any method but `GET`, `HEAD`, `OPTIONS`) passes the guard `src/index.ts` runs on each request (`refuseUnsafeRequest`, `src/lib/same-origin.ts`): it must come from an origin of the CORS allowlist (a request without an `Origin` passes unless its fetch metadata says another site made it), and a JSON route takes a JSON body only, since the session cookie is `SameSite=Lax` and a sibling subdomain's form would otherwise post a body the route parses. A route that takes another body (a form, a multipart upload) gets an entry in `NON_JSON_ROUTES` (same file); one another site posts by design (`POST /auth/apple/callback`) is marked `crossSite` and carries its own check.

## Errors

- The wire envelope is always `{ error: string }`, with a stable snake_case code (`insufficient_balance`, `chain_unavailable`). The frontend switches on that code through `Web2ApiError.code`, so a code is a contract: renaming one is a breaking change.
- A 400 with a code is `badRequest(set, code)` from `src/lib/http.ts`; its `StatusContext` is the one type for Elysia's `set` in a helper signature.
- Domain failures are `class XError extends Error {}` in the domain (`src/leagues/leagues.ts` `LeagueError`); the route maps them with `instanceof` and rethrows anything else: `src/routes/wallet.ts` `refusedWithdrawal`.
- A create whose client-chosen id is already taken answers 409 with a `<thing>_exists` code, never the 500 of the raw unique violation: `insert ... on conflict (id) do nothing returning` and a typed error when no row comes back (`src/leagues/battles.ts` `BattleExistsError`, mapped in `src/routes/battles.ts`).
- Everything unmapped falls to the global `onError` handler in `src/index.ts` (404 `not found`, 400 `bad request`, 503 `unavailable` when the database is down, 500 `internal`). Do not catch-and-500 in a route.
- Engine order rejections have their own code table: [`backend/README.md` "Order rejections"](../../../backend/README.md#order-rejections).

## Database

- `pg` with raw parameterized SQL through `query<T>(text, params)` (`src/db/client.ts`); no ORM. Always `$1` placeholders, never string interpolation of values.
- Multi-statement writes run in `tx(fn)` (`src/db/client.ts`). A domain function that may run inside a caller's transaction takes `q: TxQuery = query` as its last parameter (`src/leagues/battles.ts` `getBattle`) and the caller passes the transaction's query (`src/custody/ledger.ts` `postLedgerEvent`).
- Idempotency lives in the schema: a unique key (`vxp_awards`, deposit `tx_ref`) plus `on conflict`, not an in-memory check.
- A capped counter (code attempts) is spent with one conditional `update ... set n = n + 1 where id = $1 and n < $2 returning ...` before the check it guards, never read-then-increment, so concurrent requests cannot all pass the cap: `src/auth/otp.ts` (`verifyOtp`), `src/school/verification.ts` (`verifySchoolCode`).
- A `jsonb` bag a client writes is shaped on write by the same function that shapes it on read (`sanitizePreferences` in `src/profiles/profile.ts`, called from `parseProfileInput`), so SQL never meets a leaf of the wrong type. SQL that filters on a leaf compares `jsonb` values instead of casting the text, so a row stored before that shaping cannot fail the query: `WORLDS_OPTED_IN` in `src/worlds/affiliation-stats.ts`.
- Schema changes are forward-only migrations: [`workflows/new-migration.md`](./workflows/new-migration.md).

## Email

- An email goes through `sendEmail` (`src/lib/email.ts`), tested through `setEmailTransport`. A delivery failure on an anonymous request is logged and never changes the answer, so the route says the same whether or not the provider took it: `requestOtp` in `src/auth/otp.ts`.
- An email a signed-out visitor receives is written in their language: one builder per email over a copy file per live locale, each typed against the English one so a missing line is a type error, and a test pins that every live locale has every key. Figures in the copy (a code's lifetime, a hold) are parameters from the constants the server enforces: `src/waitlist/emails.ts` over `src/waitlist/email-copy/`.
- An email a worker job sends goes through `deliverOnce` (`src/waitlist/delivery.ts`), so neither a crash before the send nor one after it loses or doubles it.

## Environment and logging

- Read config only from `env` (`src/env.ts`); add a var in `loadEnv` (same file) with `optional` / `requiredInProd` / `positiveInt`, and a row in the `backend/README.md` table. An optional integration exposes an `enabled` flag and degrades when off.
- Log through `logger` (`src/lib/logger.ts`); `console.*` is only for `src/db/`, which loads before the logger matters.

## Engine and chains

- Canister actors come from `src/engine/actors.ts` (`reader*`, `user*`, `admin*` factories) behind `setEngineActorProvider` (same file), the seam tests and the E2E server swap. Never build an actor inline.
- Typed wrappers unwrap `Ok`/`Err` with `expectOk` (`src/engine/result.ts`); public reads are cached with `cached({ key, ttlMs, load })` (`src/engine/cache.ts`) for `PUBLIC_READ_TTL_MS`.
- Chain code follows the `ChainAdapter` interface in `src/chains/types.ts`; the money rules are in [`custody.md`](./custody.md).

## Background jobs

- A `WorkerJob { name, run, everyNthTick? }` entry in `jobs` in `src/worker.ts`; `run` calls an idempotent function exported by its domain. One failing job is logged and never stalls the others (`tick` in the same file). Recipe: [`workflows/new-worker-job.md`](./workflows/new-worker-job.md).

## Rate limiting

- `enforceLimit({ set, name, ip, limit, windowMs })` (`src/lib/rate-limit.ts`) with `clientIp(request)` from `src/lib/http.ts`, on every unauthenticated endpoint that sends email, issues a session, writes rows or can be enumerated. A signed-in endpoint that checks a guessable code, or fans out costly work on every call, keys it by the account instead (`ip: user.id`, `src/routes/school.ts` `/verify`, the trade activity in `src/routes/social.ts`), so a shared campus network does not pool users. In-memory, per instance: each API machine counts on its own, which is fine for a limit on the caller.
- An endpoint that writes what an anonymous caller sends also bounds its size: `maxItems` on the body array and a length cap on every free string, both as named constants in the domain (`MAX_EVENTS_PER_BATCH`, `MAX_PATH_LENGTH` in `src/analytics/events.ts`), and drops what only the server may write (`SERVER_ANALYTICS_EVENT_NAMES` in `src/analytics/taxonomy.ts`). Under that, `MAX_REQUEST_BODY_BYTES` (`src/index.ts`) caps every request body in the server.
- An anonymous endpoint that a bot could farm (one a sign-up surface probes on every keystroke, say) also sits behind Cloudflare Turnstile, without a solve per call: one route verifies a token with `verifyTurnstileToken` (`src/lib/turnstile.ts`) and answers a short-lived proof from `issueHumanProof` (`src/lib/human-proof.ts`), bound to the caller's IP and a scope; the per-call route checks it with `verifyHumanProof` and answers `403 human_proof_required` otherwise. Both routes keep their IP limits. A server without `TURNSTILE_SECRET_KEY` skips the check outside production and refuses it in production (`503 turnstile_unconfigured`), never opens up: `/nickname-check-proof` and `/public-nickname-availability` in `src/routes/profiles.ts`.
- An anonymous endpoint that sends an email (or any other per-call cost a bot could run up) verifies a fresh Turnstile token on every call instead, with its own action so a token solved for another surface does not open it, and answers the verdict through `turnstileRefusal` (`src/lib/turnstile.ts`). It also limits per recipient across every IP, keyed so aliases of one inbox share a window and counted only after the bot check passes, so a stranger cannot spend someone else's budget. That limit protects someone other than the caller, so it uses `enforceSharedLimit({ set, name, key, limit, windowMs })` (`src/lib/rate-limit.ts`), whose window is one row of `rate_limit_windows` bumped by a single upsert, shared by every API machine; a per-instance window would give an attacker one budget per machine: `/auth/otp/request` in `src/routes/auth.ts` (`otpMailboxKey` in `src/auth/otp.ts`).
- Each limit is a named constant at the top of its route module, with its window in the name (`OTP_VERIFY_LIMIT_PER_TEN_MINUTES` in `src/routes/auth.ts`, `INGEST_LIMIT_PER_MINUTE` in `src/routes/events.ts`), and the window is a duration from `src/lib/time.ts`; never an inline number in the `enforceLimit` call.
