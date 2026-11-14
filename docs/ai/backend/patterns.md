# Web2 API patterns

The patterns the API really uses, each with one example to copy. All paths are under `backend/`. Shared helpers are listed in [`reusability.md`](./reusability.md).

## Routes and validation

- One Elysia instance per area with a prefix: `src/routes/wallet.ts` (`walletRoutes`). Mounted with `.use(...)` on `app` in `src/index.ts`.
- Request shapes are Elysia `t` schemas in the route options (`src/routes/wallet.ts`, the `body` of `POST /withdrawals`). Zod is not used in the API; do not add it.
- A handler gates first, then calls a domain function, then shapes the response: `src/routes/wallet.ts` (`/balances`).
- Responses that carry candid values (bigint, `Principal`, bytes) go through `toJson` (`src/engine/serialize.ts`); never hand-convert.

## Auth guards

- `requireUser(request)` (`src/auth/guard.ts`) returns the `AuthedUser` or `null`; on `null` return `unauthenticated(set)` (401). Admin endpoints check `requireUser` first and then `requireAdmin` (same file) with `forbidden(set)` (403), so the 401/403 split stays honest: `src/routes/vxp.ts` (`/admin/treasury`).
- Sessions are cookies; never read a user id from the body or the query.

## Errors

- The wire envelope is always `{ error: string }`, with a stable snake_case code (`insufficient_balance`, `chain_unavailable`). The frontend switches on that code through `Web2ApiError.code`, so a code is a contract: renaming one is a breaking change.
- A 400 with a code is `badRequest(set, code)` from `src/lib/http.ts`; its `StatusContext` is the one type for Elysia's `set` in a helper signature.
- Domain failures are `class XError extends Error {}` in the domain (`src/leagues/leagues.ts` `LeagueError`); the route maps them with `instanceof` and rethrows anything else: `src/routes/wallet.ts` `refusedWithdrawal`.
- Everything unmapped falls to the global `onError` handler in `src/index.ts` (404 `not found`, 400 `bad request`, 503 `unavailable` when the database is down, 500 `internal`). Do not catch-and-500 in a route.
- Engine order rejections have their own code table: [`backend/README.md` "Order rejections"](../../../backend/README.md#order-rejections).

## Database

- `pg` with raw parameterized SQL through `query<T>(text, params)` (`src/db/client.ts`); no ORM. Always `$1` placeholders, never string interpolation of values.
- Multi-statement writes run in `tx(fn)` (`src/db/client.ts`). A domain function that may run inside a caller's transaction takes `q: TxQuery = query` as its last parameter (`src/leagues/battles.ts` `getBattle`) and the caller passes the transaction's query (`src/custody/ledger.ts` `postLedgerEvent`).
- Idempotency lives in the schema: a unique key (`vxp_awards`, deposit `tx_ref`) plus `on conflict`, not an in-memory check.
- A capped counter (code attempts) is spent with one conditional `update ... set n = n + 1 where id = $1 and n < $2 returning ...` before the check it guards, never read-then-increment, so concurrent requests cannot all pass the cap: `src/auth/otp.ts` (`verifyOtp`), `src/school/verification.ts` (`verifySchoolCode`).
- Schema changes are forward-only migrations: [`workflows/new-migration.md`](./workflows/new-migration.md).

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

- `enforceLimit({ set, name, ip, limit, windowMs })` (`src/lib/rate-limit.ts`) with `clientIp(request)` from `src/lib/http.ts`, on every unauthenticated endpoint that sends email, issues a session, writes rows or can be enumerated. A signed-in endpoint that checks a guessable code keys it by the account instead (`ip: user.id`, `src/routes/school.ts` `/verify`), so a shared campus network does not pool users. In-memory, per instance.
- An endpoint that writes what an anonymous caller sends also bounds its size: `maxItems` on the body array and a length cap on every free string, both as named constants in the domain (`MAX_EVENTS_PER_BATCH`, `MAX_PATH_LENGTH` in `src/analytics/events.ts`). Under that, `MAX_REQUEST_BODY_BYTES` (`src/index.ts`) caps every request body in the server.
