---
description: local deployment workflow using Juno emulator
---

This workflow ensures that custom canisters and the Juno satellite share the same port and environment, avoiding 404 and CORS errors.

1. Stop any running replicas or emulators.
   // turbo
2. Start the Juno emulator:

```bash
juno emulator start
```

3. In a new terminal, deploy the custom canisters targeting the Juno port:
   // turbo

```bash
npm run deploy
```

4. Initialize the registry and register the Vici engine on icdc-core:
   // turbo

```bash
npm run init:icdc
```

This runs clearing init → `init:icdc-engine` (registers the Vici engine with the satellite + human admins) → `init:registry` (seeds the oracle and demo markets tagged with `engine_id`).

5. (Optional) smoke-test the engine wiring:
   // turbo

```bash
npm run test:engine-sync
```

6. Start the SvelteKit development server:

```bash
npm run dev
```

> [!IMPORTANT]
> Do NOT run `dfx start`. The Juno emulator acts as the only local replica.

See also:

- [icdc-engine-reset.md](./icdc-engine-reset.md): fresh registry reset on local, staging, or production.
- [icdc-engine-operations.md](./icdc-engine-operations.md): grant/revoke/audit role grants.
- [../../docs/engine-integration.md](../../docs/engine-integration.md): architecture.
- [../../docs/ai/satellite/workflows/engine-sync.md](../../docs/ai/satellite/workflows/engine-sync.md): satellite-side engine syncing.
- [../../docs/ai/README.md](../../docs/ai/README.md): AI agent docs index.
