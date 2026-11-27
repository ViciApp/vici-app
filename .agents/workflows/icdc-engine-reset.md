---
description: fresh reset of the icdc-core registry + Vici engine (local, staging, or production)
---

Use this workflow when the registry state is corrupt, after a schema migration, or when
onboarding a new environment. It wipes all engines, role grants, oracles, and series, then
re-registers the Vici engine and reseeds demo markets.

icdc-core runs two deployments (see
[engine-integration.md](../../docs/engine-integration.md), "icdc-core deployments: staging
and production"): the `staging` dfx network → icdc-core staging, and the `ic` network
(via `--production`) → icdc-core production.

> [!WARNING]
> `--mode reinstall` **erases all registry state** for the target network: engines, role
> grants, oracles, and series are all wiped. Only run it when this is explicitly acceptable.
> The Production section below operates on the live production registry.

## Local

Assumes the local replica is running (see [deployment.md](./deployment.md)).

1. Reinstall the registry canister (wipes engine + role + oracle + series state):
   // turbo

```bash
dfx deploy --mode reinstall registry
```

2. Re-register the Vici engine + reseed markets. Optionally export
   `DEV_CREATOR_PRINCIPAL` so your signed-in II user is auto-granted `Creator` +
   `OracleAdmin` on `eng_0` (see
   [../../docs/engine-integration.md](../../docs/engine-integration.md), "Persistence
   across registry reinstalls"):
   // turbo

```bash
export DEV_CREATOR_PRINCIPAL="<your-II-principal>"   # optional, local-only
npm run init:icdc
```

3. Verify the engine is wired correctly:
   // turbo

```bash
npm run test:engine-sync
```

## Staging

Targets icdc-core's **staging** deployment (dfx network `staging`, registry
`5p3j2-miaaa-…`). The canister IDs are wired in [`dfx.json`](../../dfx.json) `remote.id`. The
`dfx` identity running this workflow must be a controller of the staging registry.

1. Reinstall the registry **from the icdc-core repo**. Here the registry is `remote` on
   `staging` and `ic`, and this repo's scripts that reinstall canisters, mint or set fixed
   prices refuse any network but `local` (the callers of `require_local_network` in
   [`scripts/lib/utils.sh`](../../scripts/lib/utils.sh)); icdc-core's own `dfx.json` deploys
   it. `init:icdc-engine`, `init:registry` (with `deploy-markets.sh`) and `test:engine-sync`
   below are meant to run against `staging` or `ic`:

```bash
# in icdc-core
dfx deploy registry --network staging --mode reinstall
```

2. Register the Vici engine, explicitly pointing at the **production satellite principal**
   (the satellite that Juno Console deploys to):

```bash
VICI_JUNO_SATELLITE_PRINCIPAL="$(npx tsx scripts/lib/satellite-id.ts production)" \
  npm run init:icdc-engine -- --staging
```

3. Reseed oracles + demo markets:

```bash
npm run init:registry -- --staging
```

4. Re-apply the app's roles: the API mirrors each role assignment onto the engine
   registry with its service admin identity (`backend/src/admin/engine-sync.ts`), so
   re-save the roles through the API admin routes once the engine exists again.

## Production

> [!CAUTION]
> This operates on icdc-core **production** (dfx network `ic`, registry `g5pxl-pyaaa-…`), the
> deployment the live Vici frontend talks to. A reinstall wipes production engine / role /
> oracle / series state.

Identical to the Staging steps, but with `--network ic` / `--production` (the
`--production` flag is an alias for `--ic`; see
[`scripts/lib/utils.sh`](../../scripts/lib/utils.sh)). The `dfx` identity must be a
controller of the production registry. The reinstall again runs from the icdc-core repo:

```bash
# in icdc-core
dfx deploy registry --network ic --mode reinstall
```

Then, in this repo:

```bash
VICI_JUNO_SATELLITE_PRINCIPAL="$(npx tsx scripts/lib/satellite-id.ts production)" \
  npm run init:icdc-engine -- --production
npm run init:registry -- --production
```

Then re-apply the roles through the API (step 4 above).

## Post-reset sanity check

Read the engine record back from the registry and check that the Vici engine exists at
`eng_0`, that the API's service admin identity is in `admins`, and that `allowed_roles`
contains both `Creator` and `OracleAdmin`. If anything is off, see
[icdc-engine-operations.md](./icdc-engine-operations.md) for manual reconciliation steps.
