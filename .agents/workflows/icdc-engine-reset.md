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

Assumes the Juno emulator is running (see [deployment.md](./deployment.md)).

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

1. Reinstall the registry:

```bash
dfx deploy --network staging --mode reinstall registry
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

4. Rebuild and upgrade the satellite so the new `syncRoleToEngine` hooks are live:

```bash
npm run juno:functions:build
```

Then upgrade the satellite via the Juno Console (no CLI equivalent today).

5. Smoke-test:

```bash
npm run test:engine-sync -- --staging
```

## Production

> [!CAUTION]
> This operates on icdc-core **production** (dfx network `ic`, registry `g5pxl-pyaaa-…`), the
> deployment the live Vici frontend talks to. A reinstall wipes production engine / role /
> oracle / series state.

Identical to the Staging steps, but with `--network ic` / `--production` (the
`--production` flag is an alias for `--ic`; see
[`scripts/lib/utils.sh`](../../scripts/lib/utils.sh)). The `dfx` identity must be a
controller of the production registry.

```bash
dfx deploy --network ic --mode reinstall registry

VICI_JUNO_SATELLITE_PRINCIPAL="$(npx tsx scripts/lib/satellite-id.ts production)" \
  npm run init:icdc-engine -- --production
npm run init:registry -- --production
npm run juno:functions:build   # then upgrade the satellite via the Juno Console
npm run test:engine-sync -- --production
```

## Post-reset sanity check

`npm run test:engine-sync` verifies:

- The Vici engine exists at `eng_0`.
- The satellite principal is in `admins`.
- `allowed_roles` contains both `Creator` and `OracleAdmin`.
- `grant_engine_role` / `revoke_engine_role` round-trip works (local only).

If the script fails, see [icdc-engine-operations.md](./icdc-engine-operations.md) for
manual reconciliation steps.
