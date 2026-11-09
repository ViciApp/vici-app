# Web2 API structure

The folder list is in [`backend/README.md` "Layout"](../../../backend/README.md#layout) and `ls backend/src`. This page holds what the listing cannot say: where new code goes and which way imports point.

## Layers and the direction of imports

```text
src/index.ts ── mounts ──> src/routes/<area>.ts ──> src/<domain>/*.ts ──> src/db/client.ts
src/worker.ts ── calls ──────────────────────────────> src/<domain>/*.ts ──> src/engine/*, src/chains/*
                                                                         └─> src/lib/*, src/env.ts
```

- **`src/routes/<area>.ts`** is the only HTTP layer: one `new Elysia({ prefix: '/api/v1/<area>' })` per file, mounted in `src/index.ts`. It parses the request, gates it, calls domain functions and maps domain errors to status codes. No SQL here.
- **`src/<domain>/`** (`account`, `admin`, `analytics`, `auth`, `chains`, `custody`, `leagues`, `markets`, `profiles`, `school`, `social`, `tournaments`, `vxp`, `worlds`) owns the logic and the SQL of its concern. Files are kebab-case nouns (`leagues/battle-resolution.ts`); there is no `*.service.ts` / `*.repo.ts` split, so do not introduce one.
- **`src/engine/`** wraps the icdc-core canisters (actors, typed clearing and registry calls, the TTL cache, serialization). **`src/chains/`** holds one adapter folder per chain (`ic`, `evm`, `sol`, `btc`) behind `chains/types.ts`.
- **`src/lib/`** is cross-domain infrastructure and imports nothing but `../env`. Keep it that way: a helper that needs a domain belongs in that domain.
- **`src/env.ts`** is the only reader of `process.env`.
- **Nothing imports `src/routes/`** except `src/index.ts`. Domains never import routes.

## Where new code goes

| You are adding...                                          | Put it in                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| An endpoint                                                | the route file of its area; a new area gets a new file, mounted in `index.ts` |
| Business logic or SQL for an existing concern              | the owning `src/<domain>/` file                                               |
| A helper used by two or more domains, no domain dependency | `src/lib/` (and a row in [`reusability.md`](./reusability.md))                |
| A canister call                                            | `src/engine/clearing.ts` or `registry.ts`, behind the actor provider          |
| A chain capability                                         | the adapter under `src/chains/<chain>/`, through the `ChainAdapter` interface |
| A background job                                           | the domain function in its domain, registered in `src/worker.ts`              |
| A schema change                                            | a new `src/db/migrations/NNNN_name.sql`                                       |
| An env var                                                 | `src/env.ts` plus the table in `backend/README.md`                            |
| A test                                                     | `backend/tests/<topic>.test.ts`, never next to the source                     |
| A new top-level domain folder                              | ask first (closed taxonomy)                                                   |

## Known deviations (do not copy)

- `routes/auth.ts` (around line 96) and `routes/wallet.ts` (the `/balances` join, around line 149) run SQL directly. New routes go through a domain function.
