---
description: local deployment of the engine canisters
---

The app reads mainnet by default (the API's `IC_HOST`). This workflow stands up the engine
and ledger canisters on a local replica for engine work.

1. Start a local replica on the port `dfx.json` names (`127.0.0.1:5987`):
   // turbo

```bash
dfx start --clean --background
```

2. Deploy the custom canisters:
   // turbo

```bash
npm run deploy
```

3. Initialize the registry and register the Vici engine on icdc-core:
   // turbo

```bash
npm run init:icdc
```

This runs `init:clearing` → `init:icdc-engine` (registers the Vici engine with its admins) → `init:registry` (seeds the oracle and demo markets tagged with `engine_id`) → `init:icdc-dev-bootstrap` (grants `DEV_CREATOR_PRINCIPAL`, when set, `Creator` + `OracleAdmin` on the engine; a no-op otherwise).

4. Start the API against the replica (`IC_HOST=http://127.0.0.1:5987`, see [`backend/README.md`](../../backend/README.md)) and the SvelteKit development server:

```bash
npm run dev
```

See also:

- [icdc-engine-reset.md](./icdc-engine-reset.md): fresh registry reset on local, staging, or production.
- [icdc-engine-operations.md](./icdc-engine-operations.md): grant/revoke/audit role grants.
- [../../docs/engine-integration.md](../../docs/engine-integration.md): architecture.
- [../../docs/ai/README.md](../../docs/ai/README.md): AI agent docs index.
