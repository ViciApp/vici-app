# VICI backend

Bun + Elysia + Postgres API for the VICI app. Purely additive for now: the production app keeps running on the current stack while the domains are ported here phase by phase.

## Local development

Requirements: [Bun](https://bun.sh) >= 1.3 and Docker.

```bash
cd backend
docker compose up -d      # local Postgres 16 (db/user/password: vici)
bun install
bun run migrate           # apply src/db/migrations/*.sql
bun dev                   # API on http://localhost:8787 (watch mode)
bun run worker            # background worker loop (optional locally)
```

Checks:

```bash
bun run typecheck         # tsc --noEmit
bun test                  # unit + DB-backed tests (skip DB suites if Postgres is down)
```

Tests connect to `TEST_DATABASE_URL` (default: the docker-compose Postgres). CI sets `REQUIRE_DB_TESTS=1` so a missing database fails the build instead of silently skipping the DB-backed suites.

## Environment

Validated fail-fast in `src/env.ts`. In production the required vars abort boot when missing; in dev everything has a local default. Optional integrations added by later phases degrade instead of crashing when unconfigured (email logs to console, storage falls back to local disk in dev).

| Var                       | Required (prod) | Default (dev)                                | Purpose                                                                                     |
| ------------------------- | --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | yes             | `postgres://vici:vici@localhost:5432/vici`   | Postgres connection string                                                                  |
| `SESSION_SECRET`          | yes             | dev placeholder                              | HMAC pepper for session token hashes                                                        |
| `PORT`                    | no              | `8787`                                       | API listen port                                                                             |
| `PUBLIC_APP_URL`          | no              | `http://localhost:5173`                      | SPA origin: credentialed CORS allowlist (+ www/apex twin)                                   |
| `API_BASE_URL`            | no              | `http://localhost:<port>`                    | This server's public origin (absolute callback URLs)                                        |
| `LOG_LEVEL`               | no              | `info`                                       | `debug` / `info` / `warn` / `error`                                                         |
| `WORKER_POLL_INTERVAL_MS` | no              | `60000`                                      | Worker loop poll interval                                                                   |
| `SESSION_TTL_HOURS`       | no              | `720`                                        | Session lifetime (30 days)                                                                  |
| `COOKIE_DOMAIN`           | no              | empty (host-only)                            | Cookie Domain attribute for prod cross-subdomain sessions                                   |
| `GOOGLE_CLIENT_ID`        | no              | empty (google disabled)                      | Google OAuth client id                                                                      |
| `GOOGLE_CLIENT_SECRET`    | no              | empty (google disabled)                      | Google OAuth client secret                                                                  |
| `GOOGLE_REDIRECT_URI`     | no              | `<API_BASE_URL>/api/v1/auth/google/callback` | Override for the Google callback URL                                                        |
| `APPLE_CLIENT_ID`         | no              | empty (apple disabled)                       | Sign in with Apple services id                                                              |
| `APPLE_TEAM_ID`           | no              | empty (apple disabled)                       | Apple developer team id                                                                     |
| `APPLE_KEY_ID`            | no              | empty (apple disabled)                       | Key id of the .p8 signing key                                                               |
| `APPLE_PRIVATE_KEY`       | no              | empty (apple disabled)                       | .p8 PKCS#8 PEM (literal or \n-escaped newlines)                                             |
| `APPLE_REDIRECT_URI`      | no              | `<API_BASE_URL>/api/v1/auth/apple/callback`  | Override for the Apple callback URL                                                         |
| `RESEND_API_KEY`          | no              | empty (email logs to console)                | Resend API key for transactional email                                                      |
| `EMAIL_FROM`              | no              | `VICI <no-reply@vici.app>`                   | From header for transactional email                                                         |
| `ROOT_SECRET`             | yes             | dev placeholder                              | HKDF root for per-user per-chain custody keys (rotating it rotates every custodial address) |
| `TREASURY_PEM`            | no              | empty (svc-derived key)                      | PEM override for the treasury IC identity                                                   |
| `ADMIN_PEM`               | no              | empty (svc-derived key)                      | PEM override for the admin IC identity                                                      |
| `CUSTODY_ENABLED_ASSETS`  | no              | empty (all ic assets)                        | Comma list of `symbol` or `chain:symbol` to enable                                          |
| `VXP_TREASURY_DISABLED`   | no              | empty (transfers live)                       | `1` = record-only mode: awards are recorded, no ledger transfer fires                       |
| `IC_HOST`                 | no              | `https://icp-api.io`                         | IC API host (adapter enabled by default)                                                    |
| `CLEARING_CANISTER_ID`    | no              | mainnet id                                   | Clearing canister id                                                                        |
| `REGISTRY_CANISTER_ID`    | no              | mainnet id                                   | Registry canister id                                                                        |
| `EVM_RPC_URL`             | no              | empty (evm disabled)                         | EVM JSON-RPC endpoint                                                                       |
| `EVM_CHAIN_ID`            | no              | `1`                                          | EVM chain id for EIP-1559 signing                                                           |
| `EVM_CONFIRMATIONS`       | no              | `12`                                         | Deposit confirmation depth                                                                  |
| `SOL_RPC_URL`             | no              | empty (sol disabled)                         | Solana JSON-RPC endpoint                                                                    |
| `SOL_COMMITMENT`          | no              | `finalized`                                  | Solana commitment level                                                                     |
| `BTC_ESPLORA_URL`         | no              | empty (btc disabled)                         | Esplora-compatible API base (e.g. mempool.space/api)                                        |
| `BTC_NETWORK`             | no              | `mainnet`                                    | `mainnet` / `testnet` / `regtest`                                                           |
| `BTC_CONFIRMATIONS`       | no              | `2`                                          | Deposit confirmation depth                                                                  |

ETL-only vars (read by `scripts/etl/*`, never by the server):

| Var                       | Purpose                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `ETL_SATELLITE_PEM`       | Path to the satellite ADMIN identity key file (PKCS#8 Ed25519 or secp256k1 PEM) |
| `ETL_SATELLITE_ID`        | Satellite canister id to drain                                                  |
| `ETL_SATELLITE_CONTAINER` | Optional emulator URL for a local satellite; unset targets production           |

## Auth

Sessions are opaque 256-bit tokens in the HttpOnly `vici_session` cookie (SameSite=Lax, Secure in prod, Domain from `COOKIE_DOMAIN`); the database stores only `HMAC-SHA256(token, SESSION_SECRET)`. Login always rotates the token; logout revokes it server-side.

Endpoints under `/api/v1`:

- `GET /auth/providers`: which sign-in methods are live. A provider whose env is not configured reports `coming_soon` (the FE renders a disabled button) and its endpoints answer `503 { "error": "provider_unavailable" }`.
- `POST /auth/otp/request` + `POST /auth/otp/verify`: email one-time codes (10 min TTL, single-use, 5-attempt lockout, hashed at rest, identical responses for known and unknown addresses).
- `GET /auth/google` + `GET /auth/google/callback`: Google OAuth code flow with an HMAC-signed state cookie.
- `GET /auth/apple` + `POST /auth/apple/callback`: Sign in with Apple (ES256 client secret from the .p8 key, `form_post` callback, SameSite=None state cookie).
- `POST /auth/logout`, `GET /me`.

### Beta access gate

Sign-in can be limited to an allowlist through the `beta_gate` app setting, managed with the generic admin settings CRUD (no dedicated endpoint):

```
PUT /api/v1/admin/settings/beta_gate
{ "value": { "enabled": true, "emails": ["founder@example.com", "tester@example.com"] } }
```

While `enabled` is `true`, only the listed addresses (case-insensitive) can sign in: a non-allowlisted email gets `403 { "error": "beta_closed" }` from `POST /auth/otp/request` and `POST /auth/otp/verify`, and the OAuth callbacks bounce to `/signin?e=beta` (the screen that renders the refusal) instead of minting a session. The refusal is identical for every address, so it leaks nothing about whether an account exists. Setting absent or `enabled: false` (or deleting the key) turns the gate off and everyone passes. An enabled gate with a missing or malformed `emails` list admits no one, and a single non-string entry fails the whole list closed rather than honouring the well-formed ones. The gate guards sign-in only: sessions established before it flips on keep working. It is a rollout valve, not a security boundary.

First verified login auto-links legacy on-chain identities: when the account has no `legacy_principals` row yet and the exported `legacy_auth_identities` table contains a row whose `openid_email` (first) or `profile_email` (fallback) matches the verified address, the principal links with the corresponding `matched_via`. The export tooling that fills `legacy_auth_identities` lands in a later phase; until then the table is empty and logins simply skip the match.

## Custody

Every user gets deterministic per-chain custodial keys, HKDF-SHA256 derived from `ROOT_SECRET` with the info string `user:<userId>:<chain>` (ed25519 for `ic`/`sol`, secp256k1 for `evm`/`btc`); the database stores addresses only, never key material. Treasury/admin service identities derive under a disjoint `svc:` prefix, or come from `TREASURY_PEM` / `ADMIN_PEM`.

Balances live on a double-entry ledger (`ledger_entries` + the `custody_balances` view): every event posts legs summing to zero per asset, keyed for idempotent replay. Withdrawals hold the amount at request time and refund on failure/rejection through the state machine `requested -> processing -> submitted -> confirmed` (with `failed` / `rejected` exits); self-custody exits are the same flow with a user-controlled destination. Deposits are credited by per-chain watchers running from the worker loop; only chains whose adapter is enabled are polled.

Chain adapters live under `src/chains/` behind one interface (`chains/types.ts`). The `ic` adapter is enabled by default (mainnet host); `evm`, `sol` and `btc` enable through their env vars and answer `503 { "error": "chain_unavailable" }` until configured. Asset seeding is in migration `0003_custody.sql`; the `CUSTODY_ENABLED_ASSETS` allowlist is re-applied at boot.

## Engine bridge

`src/engine/` wraps the on-chain clearing + registry canisters with the same method surface the app consumes, over candid bindings vendored under `src/declarations/` (verbatim copies of the app's generated bindings; refresh by re-copying, never hand-edit). Public market reads run anonymously behind a 15s in-memory TTL cache; account-scoped calls (orders, collateral, positions) sign with the calling user's derived custodial IC identity; settlement-grade calls sign with the admin identity. Routes: `routes/engine.ts` (public reads + session-gated trading) and `routes/wallet.ts` (balances, deposit addresses, withdrawals).

## Markets and analytics

`src/markets/` carries the market curation surface: per-series editorial metadata (`market_metadata`), per-locale translation overlays (`market_translations`, validated against the registered locale ids), and the tag reverse index (`market_tag_index`) derived from the closed 3-layer taxonomy (micros plus their macros; free tags are never indexed). Writes go through the curator gate: an admin may edit any series, the series creator their own, where the creator principal from the registry is matched against the caller's derived custodial identity or a linked legacy principal. The index is maintained in the same transaction as each metadata write and can be rebuilt from scratch via the admin corrective (`POST /api/v1/markets/tags/rebuild`).

`src/analytics/` is the behavioural event pipeline: `POST /api/v1/events` ingests client batches (public: anonymous visitors track too; a session adds the pseudonymous user link), capped at 100 events per call with server-authoritative timestamps, and bumps the per-day rollup counters in the same transaction. `captureServerEvents` is the internal bridge other domains call for server-originated events (VXP payouts, settlements). Admin endpoints mirror the warehouse contract: daily summary, keyset event export with an idempotent drain delete, the registered-account count, and the profile-created export.

## VXP economy

`src/vxp/` is the server-fired award economy. Every award funnels through one grant path (`vxp/awards.ts`): a `vxp_awards` row is inserted `pending` under the `(user, award_type, award_key)` unique index, so a duplicate trigger collides instead of double-crediting; the treasury then transfers real VXP (ICRC-1, signed by the treasury identity, one automatic retry on `BadFee` with the ledger-reported fee) and the row transitions `paid` (with `paid_at_ms` + `block_index`) or `failed` (terminal, with the error recorded). The pending-to-paid transition emits `vxp_awarded` (and `streak_milestone` for streaks) through the analytics bridge, exactly once per award.

With `VXP_TREASURY_DISABLED=1` the economy runs record-only: awards are recorded `pending` and no transfer fires, the parallel-run safety before cutover. `reconcileUnpaidAwards` (worker job + `POST /api/v1/vxp/admin/reconcile`) pays recorded-unpaid awards once the treasury is live, and doubles as the retry for grants that died between insert and transfer.

Award triggers mirror the post-write hook model: routes fire them AFTER the domain write commits, best-effort (an award hiccup never fails the write), and only for client-driven writes. Profile upserts drive the onboarding registration grant (m1, the full 1,500 VXP starter), streak milestones (3/7/14/30 at 50/150/400/1000 VXP), flow lifetime milestones (10/100/500/1000 at 50/100/250/500 VXP), achievement unlocks (catalog XP as real VXP) and the one-time comeback restore (top-up to 250 VXP after a 7-day absence below the 100 VXP floor, ledger-balance gated). Trade activities drive the onboarding call-count milestones and the referral settlement (flat 500 VXP referee bonus + the diminishing referrer curve 500/250/100/50 with the 1000-redemption hard cap, nothing pays before the referee's first prediction). The flow-swipe endpoint mints the 25 VXP overtime bonus at the daily hard cap, once per day key, bounded by a rolling 7-day cap of 8 counted off server-stamped creation times. The calibration claim (`POST /api/v1/vxp/calibration/claim`) pays 20 VXP for a correct call on a finalised Vici binary market while the caller's balance sits below the 100 VXP recovery floor, rate-limited 6/hour and 15/day. `grantLeagueFounderAward` / `settleFounderAwards` (100 VXP per league, 100 per account) and the worlds-podium / tournament-prize grant helpers (`vxp/prizes.ts`) expose the payment side for the leagues, worlds and tournaments domain.

## Mirrored constants

While both stacks coexist, some contracts are deliberately duplicated between the app code under `src/` and this backend. The drift suite (`tests/shared-drift/`) pins each mirror pair so a change on either side fails `bun test`; the backend CI workflow also triggers on the app-side files, so the suite runs whichever side a PR touches. The pairs:

| Backend                                      | App source                                                                                                                                                                                                                                                                                                                                                                                         | Compared                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/markets/locales.ts`                     | `src/lib/constants/locale.constants.ts`                                                                                                                                                                                                                                                                                                                                                            | registered locale ids (module import)                                           |
| `src/markets/taxonomy.ts`                    | `src/lib/constants/market-taxonomy.constants.ts`                                                                                                                                                                                                                                                                                                                                                   | macro/micro vocabulary (static extraction)                                      |
| `src/analytics/taxonomy.ts`                  | `src/lib/types/analytics-event.ts` + `src/lib/schema/analytics-event.schema.ts`                                                                                                                                                                                                                                                                                                                    | event names (union + Zod enum, static extraction) and prop keys (module import) |
| `src/vxp/constants.ts` + `src/vxp/awards.ts` | `src/lib/types/vxp-award.ts`, `src/lib/schema/vxp-award.schema.ts`, `src/lib/constants/vxp-economy.constants.ts`, `src/lib/constants/vxp-onboarding.constants.ts`, `src/lib/constants/achievements.constants.ts`, `src/lib/constants/referral.constants.ts`, `src/lib/constants/tokens/tokens.ic.constants.ts`, `src/lib/types/tournament.ts`, `src/satellite/services/vxp-onboarding.services.ts` | award-type set and every award amount in base units (mostly static extraction)  |
| `src/declarations/**`                        | `src/declarations/**`                                                                                                                                                                                                                                                                                                                                                                              | vendored candid files, byte-for-byte                                            |
| `src/db/migrations/0003_custody.sql`         | `src/lib/constants/canisters.constants.ts`                                                                                                                                                                                                                                                                                                                                                         | IC ledger canister ids of the seeded assets (SQL regex vs static extraction)    |

App modules are imported directly only when they have no value imports (importing anything else would need the repo root `node_modules`, which the backend CI job does not install); everything else is pinned by reading the source text and extracting the declared literals (`tests/helpers/repo-source.ts`). Extraction throws loudly when a marker disappears, so a refactor of a mirrored app module fails the suite instead of silently comparing nothing.

## Worker

`src/worker.ts` (the Fly `worker` process) is a single poll loop over a registry of named jobs, interval-driven by `WORKER_POLL_INTERVAL_MS`. Each entry is a `WorkerJob { name, run, everyNthTick? }`: `run` must be idempotent (dedupe lives in the domain, e.g. the `vxp_awards` unique key or the deposits `tx_ref` key) and failures are caught and logged per job so one bad job never stalls the rest; `everyNthTick` throttles cheap-to-skip sweeps. A later phase adds a job by replacing its no-op placeholder slot with the domain's exported function, keeping the name stable for the logs. Current registry: deposit watchers (every tick), VXP award reconciliation (every tick, no-op in record-only mode), resolved-results pruning and the streak underpayment backfill (hourly), plus placeholder slots for the deletion sweep and the tournament draw/resolve ticks.

## Data migration (ETL)

`scripts/etl/` moves the legacy satellite data into Postgres. Every script is idempotent and re-runnable: writes upsert on the stable legacy identifiers, so re-running any step (including a full re-export) converges instead of duplicating. That property IS the cutover plan: an initial bulk run while the legacy stack is still live, then one final delta run during the write freeze.

Scripts (also exposed as `bun run etl:*`):

- `drain-auth-identities.ts`: calls the satellite's admin-gated auth-identity export and upserts into `legacy_auth_identities` (the table the login auto-match reads). Resumable: the keyset cursor persists in `etl_cursors` after every page, and clears on completion so the next run re-walks from the start.
- `export-collections.ts [dir] [--fresh] [collection ...]`: drains every datastore collection into `<dir>/<collection>.jsonl` via the datastore list API signed with the admin identity, keyset-paged on doc keys. Resumable per collection through a `<collection>.cursor` sidecar file (`done` once complete); `--fresh` wipes and re-exports, which is how the delta pass re-pulls.
- `import-collections.ts [dir] [collection ...]`: transforms the JSONL into the relational tables, one transaction per collection, in dependency order. Principals resolve through `legacy_principals`; an unmatched principal gets a provisional `users` row flagged `claim_pending` plus an `'etl'`-provenance link, claimed later by the login auto-match on a verified email.
- `migrate-league-images.ts [--dry-run]`: downloads league covers still pointing at legacy storage URLs, re-encodes them through the standard 256px cover path (S3 or local disk) and rewrites the rows to this API's serving URL.
- `verify-parity.ts [dir] [--sample N] [--offline] [collection ...]`: per-collection counts (satellite vs JSONL vs Postgres, mapping-aware) plus N random spot checks probing exported docs for their target rows.

Mapping notes (the transforms in `scripts/etl/transforms.ts` are the authority):

- `roles` only fills `users.role` while it is still `user`; roles granted on this stack are never clobbered, and `controller` (infrastructure, not grantable) is skipped.
- `vxp_awards` keeps the exported status verbatim; an existing row only updates while still `pending`, so a payout recorded on either stack is never demoted or re-fired. Referral award keys are rewritten from the referee principal to the referee user id, matching the settlement path's idempotency key.
- `vxp_onboarding` has no table of its own: each non-`none` milestone becomes a `vxp_awards` row (`onboarding`, `m1|m2|m3`) so the onboarding trigger collides instead of re-granting. `referrals` likewise synthesizes both payout-side award rows from the doc's payout states.
- `school_submissions` is skipped by design: rows are ephemeral verification codes (salted digests with a short TTL); the durable outcome already lands via `schools` and `profiles.school_status`.
- `events` / `event_rollups` are skipped: the behavioural history was already drained to the warehouse through the analytics export contract, and rollups rebuild from fresh ingest.
- `chats` / `comments` are skipped: dormant surfaces with no target tables.

Runbook (bulk run, repeatable):

```bash
cd backend
export DATABASE_URL=...                      # target Postgres
export ETL_SATELLITE_PEM=/path/to/admin.pem  # satellite ADMIN identity
export ETL_SATELLITE_ID=<satellite-id>

bun run migrate                              # 1. schema up to date
bun run etl:drain-auth                       # 2. legacy_auth_identities (login auto-match)
bun run etl:export -- ./etl-export           # 3. raw JSONL snapshot per collection
bun run etl:import -- ./etl-export           # 4. transform into the tables
bun run etl:images                           # 5. re-host league covers
bun run etl:verify -- ./etl-export           # 6. parity report + spot checks
```

Cutover delta run: freeze legacy writes, then repeat steps 2-6 with a fresh export (`bun run etl:export -- ./etl-export-delta --fresh`, then import/verify against that directory). Because every import upserts and award/referral progress is never demoted, the delta pass only applies what changed since the bulk run.

## Deploy (Fly.io)

Two Fly apps, both in `ams`:

- `vici-app-backend` (`backend/fly.toml`): the API plus a `worker` process. DB migrations run atomically as the `release_command` before traffic shifts, so a failed migration aborts the deploy.
- `vici-app-web` (`fly.web.toml` at the repo root): the static SPA behind nginx (`Dockerfile.web`, `nginx.web.conf`) with SPA fallback and immutable asset caching.

Neither app exists yet. First-time setup:

```bash
cd backend && fly launch --no-deploy            # creates vici-app-backend
fly secrets set DATABASE_URL=... SESSION_SECRET=...
cd .. && fly launch --no-deploy --config fly.web.toml   # creates vici-app-web
```

Deploys go through `.github/workflows/web2-deploy.yml` (manual `workflow_dispatch` only). It needs the repo secrets `FLY_API_TOKEN_WEB2_BACKEND` and `FLY_API_TOKEN_WEB2_WEB`, one `fly tokens create deploy` token per app. Manual fallback: `flyctl deploy --remote-only` from `backend/`, and `flyctl deploy --config fly.web.toml --remote-only` from the repo root.

`GET /health` answers 200 with `{ ok: true, db: 'connected' }` when the bounded (2.5s) DB probe succeeds, 503 otherwise; three consecutive failures exit the process for a supervised restart with a fresh pool.

## Layout

```
backend/
  src/
    index.ts        # Elysia app: security headers, CORS, error mapping, /health
    worker.ts       # background job loop (registry of idempotent named jobs)
    env.ts          # validated environment
    analytics/      # behavioural event ingest, rollups, warehouse export + drain
    auth/           # sessions, guards, identity resolution, OTP, Google, Apple
    chains/         # chain adapters (ic/evm/sol/btc) + registry + deposit watchers
    custody/        # assets, custody accounts, double-entry ledger, withdrawals
    markets/        # market metadata, translations, tag index, curator gate
    vxp/            # award economy: grant core, payout, triggers, calibration, referral settlement
    declarations/   # vendored candid bindings for clearing + registry + satellite (generated, never hand-edited)
    engine/         # actor provider, TTL cache, typed clearing/registry wrappers
    routes/         # /api/v1 route modules (auth, wallet, engine, markets, events, ...)
    lib/            # logger, crypto, keys (HKDF derivation), ic-agent, cookies, email, rate limiting
    db/
      client.ts     # pg pool, query/tx helpers, isDbUnavailable
      migrate.ts    # forward-only migration runner (_migrations tracking)
      migrations/   # NNNN_name.sql, lexical order, never edited after merge
  tests/            # bun test suites (real Postgres, no mocks for DB paths)
  scripts/
    etl/            # data-migration tooling: drain, export, import, image re-host, parity
```
