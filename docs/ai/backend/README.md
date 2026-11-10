# Web2 API AI Guide

If you are about to touch anything under `backend/`, this is your starting point. Read it once per session.

> Higher up the chain: [`AGENTS.md`](../../../AGENTS.md) → [`docs/ai/`](../README.md). The on-chain engine is a different area: [`../engine/README.md`](../engine/README.md).

## What the API is

A Bun + Elysia + Postgres HTTP API under `/api/v1/...`, deployed on Fly (`backend/fly.toml`) as two processes: the app (`src/index.ts`) and the worker loop (`src/worker.ts`). The frontend reaches it only in the `VITE_BACKEND=web2` build, through the typed client in `src/lib/web2/client.ts` (see [`frontend/web2-backend-mode.md`](../frontend/web2-backend-mode.md)). It talks to the icdc-core canisters through `@icp-sdk` actors and holds custody of user funds on four chains.

The operator-facing facts (local setup, every env var, auth, custody, engine bridge, ETL, deploy, layout) live in [`backend/README.md`](../../../backend/README.md). This folder does not restate them; it adds what an agent needs to write code that fits.

## Pages

| Page                                                           | Read it when you are about to...                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`structure.md`](./structure.md)                               | add or move a file, or decide which domain owns a change          |
| [`patterns.md`](./patterns.md)                                 | write a route, a domain function, an error, SQL or an engine call |
| [`reusability.md`](./reusability.md)                           | write any helper (check it does not exist first)                  |
| [`testing.md`](./testing.md)                                   | add or change a test                                              |
| [`custody.md`](./custody.md)                                   | touch deposits, withdrawals or a chain adapter                    |
| [`workflows/new-route.md`](./workflows/new-route.md)           | add an endpoint                                                   |
| [`workflows/new-migration.md`](./workflows/new-migration.md)   | change the schema                                                 |
| [`workflows/new-worker-job.md`](./workflows/new-worker-job.md) | add a background job                                              |

## API-specific things to check (every change)

- [ ] **Gates:** `cd backend && bun run typecheck && bun test` with Postgres up (`docker compose up -d`), plus the root `npm run lint` (ESLint covers `backend/**/*.ts` through `backend/tsconfig.json`).
- [ ] **Mirrors:** if I changed a value the app also holds (locales, market taxonomy, analytics taxonomy, VXP amounts, claim message, order-rejection codes, ledger ids), I changed both sides; `tests/shared-drift/` fails otherwise. The pairs are in [`backend/README.md` "Mirrored constants"](../../../backend/README.md#mirrored-constants).
- [ ] **Wire contract:** if a route's response shape changed, the typed wrapper in `src/lib/web2/client.ts` changed in the same PR.
- [ ] **Protected paths:** auth, custody, chains, VXP, engine, db, env and the value-moving routes are in the [boundaries table](../governance.md#boundaries). Call them out in the PR body.
- [ ] **Money is base units.** Amounts are `bigint` in code and `numeric` in SQL, never `number`; serialize with `toJson` (bigint becomes a string).
