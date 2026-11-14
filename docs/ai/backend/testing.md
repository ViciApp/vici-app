# Web2 API testing

Paths are under `backend/`.

## Where and how

- **Every test is `tests/<topic>.test.ts`** (one suite per domain or behaviour), run by `bun test`. Nothing sits next to the source. Mirror-pair checks live in `tests/shared-drift/`.
- **Real Postgres, no DB mocks.** `bunfig.toml` preloads `tests/helpers/setup.ts`, which points `DATABASE_URL` at `TEST_DATABASE_URL` (default: the docker-compose database), pins `ROOT_SECRET`, and exports `dbAvailable`. A DB-backed suite is `describe.if(dbAvailable)(...)` and calls `ensureMigrated()` in `beforeAll`: `tests/guard.test.ts`.
- **HTTP behaviour** is tested through the real app: `app.handle(new Request('http://localhost/api/v1/...'))` with a `vici_session` cookie from `createSession` (`tests/guard.test.ts`).
- **External systems go through seams, never module mocks:** `setEngineActorProvider` (canisters), `setVxpLedgerProvider` / `stubVxpLedger` (VXP ledger), `setEmailTransport` (email), plus `resetRateLimits` and `clearCache` between tests.

## Helpers (`tests/helpers/`)

| File             | Exports                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `setup.ts`       | `dbAvailable` (preloaded)                                                                                      |
| `auth.ts`        | `ensureMigrated`, `uniqueEmail`, `uniquePrincipal`, `createTestUser(role?)`                                    |
| `profiles.ts`    | `createTestProfile`, `softDeleteProfile`, `hibernateProfile`, `uniqueNickname`                                 |
| `adoption.ts`    | `seedImportedAccount`, `linkOf`, `claimPendingOf`, `userCount`                                                 |
| `vxp.ts`         | `stubVxpLedger`, `readAwardRow`                                                                                |
| `repo-source.ts` | `readRepoFile`, `readRepoSource`, `importRepoModule`, `extract*` literal extractors for the shared-drift suite |

## Rules learnt the hard way

- **The database is never reset between runs.** Locally the same Postgres serves every run, and suites share it within one. Fixtures must be collision-free: unique ids from the helpers (`uniqueEmail`, `uniqueNickname`, ...), values drawn from a reserved range rather than at random (#1429), and a suite that seeds global state cleans exactly its own rows (#1434). A test that passes once and fails on the second run is a bug in the test.
- **CI sets `REQUIRE_DB_TESTS=1`** so a missing database fails instead of skipping every DB suite. Run with Postgres up locally too, or the suite proves nothing.
- **A shared-drift failure means the two sides disagree**: fix the side that is wrong, never the extractor, unless the app module was refactored on purpose.

## Commands

```bash
cd backend
docker compose up -d         # local Postgres 16
bun run typecheck
bun test                     # whole suite
bun test tests/withdrawals   # one file or prefix
```

The API test-only E2E server (`e2e/`, fake engine, in-memory email) drives the Playwright suite in `e2e-web2/`: see [`frontend/testing.md`](../frontend/testing.md#e2e-against-the-web2-backend).
