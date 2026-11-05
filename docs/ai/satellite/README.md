# Juno Satellite AI Guide

If you are about to touch anything under `src/satellite/`, this is your
starting point. Read it once per session.

> Higher up the chain: [`AGENTS.md`](../../../AGENTS.md) → [`docs/ai/`](../README.md).

## What the satellite is (and isn't)

The Juno satellite is a Rust canister, deployed and managed by Juno, that
runs **TypeScript hooks, assertions, and typed query / update functions**
authored under [`src/satellite/`](../../../src/satellite/). The TypeScript
is compiled by `juno functions build` into a Wasm extension that the
satellite loads.

It **is**:

- A trust boundary. Hooks run after datastore writes and can call other
  canisters with the satellite's principal.
- The single place that mirrors Juno role docs into the icdc-core Vici
  engine ([`engine-sync.services.ts`](../../../src/satellite/services/engine-sync.services.ts)).
- The home of typed read endpoints (`defineQuery`) and authenticated
  write endpoints (`defineUpdate`) that don't fit the datastore model.

It **is not**:

- The on-chain risk engine. That's the Rust canisters in
  [`../icdc-core/`](../../../../icdc-core/) (Clearing + Registry).
- A general-purpose backend — keep logic close to data; if it doesn't
  need to be on-canister, it belongs in `#lib/services/` instead.

## Satellite-specific things to check (every change)

Generic agent hygiene (read first, run lint/check, atomic PRs) is in
[`AGENTS.md`](../../../AGENTS.md) and [`pr-and-ci.md`](../pr-and-ci.md).
What is specific to the satellite:

- [ ] **Wire-up:** if I added a hook, I registered it through `defineHook` /
      `defineAssert` in [`src/satellite/index.ts`](../../../src/satellite/index.ts).
- [ ] **Schema regen:** if I added a `defineQuery` / `defineUpdate`, the
      Candid surface regenerated cleanly via `npm run juno:functions:build`.
- [ ] **Collection rules:** if my change reads / writes a Juno collection,
      I confirmed the rules in
      [`juno.config.ts`](../../../juno.config.ts) match what the hook
      assumes.
- [ ] **Engine sync:** if my change mirrors writes into icdc-core, I
      followed [`workflows/engine-sync.md`](./workflows/engine-sync.md).
- [ ] **Meta-update:** if I introduced a new pattern or reusable helper,
      I updated this area's pages in the same PR
      ([meta-update rule](../governance.md#meta-update-rule)).

## Non-obvious satellite gotchas

The stack is `src/satellite/package.json` and the layout is `ls src/satellite/`.
What the code will not tell you:

- **`@junobuild/core` is FE-only.** Never import it from the satellite —
  satellite code uses `@junobuild/functions` primitives directly.
- **The satellite has its own [`tsconfig.json`](../../../src/satellite/tsconfig.json)** —
  no DOM-only imports from `#lib/`.
- **`src/satellite/api-schemas.ts`, `satellite.did`, `satellite_extension.did`
  are generated** by `npm run juno:functions:build`. Don't hand-edit.

Full taxonomy: [`structure.md`](./structure.md). Idioms: [`patterns.md`](./patterns.md).

## Local development

- **Replica:** `juno emulator start` — the Juno emulator is the only
  local replica (never `dfx start`, see
  [`AGENTS.md`](../../../AGENTS.md)).
- **Local Console:** [http://localhost:5866](http://localhost:5866).
- **Vite plugin:** [`@junobuild/vite-plugin`](../../../vite.config.ts)
  injects the satellite ID / container URL into the FE env.
- **Build hooks:** `npm run juno:functions:build` compiles the
  TypeScript hooks/asserts/endpoints into the satellite extension
  Wasm.
- **Satellite IDs:** pinned in [`juno.config.ts`](../../../juno.config.ts)
  (dev + prod). That file is the source of truth — don't copy them
  elsewhere.

## Where to look

| You're about to…                                            | Read first                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Add or move a satellite file                                | [`structure.md`](./structure.md)                                                                               |
| Pick the right idiom (hook, assert, endpoint)               | [`patterns.md`](./patterns.md)                                                                                 |
| Touch VXP awards / economy parameters                       | [`economy.md`](./economy.md)                                                                                   |
| Add a hook (`onSetDoc` / `onDeleteDoc`)                     | [`workflows/new-hook.md`](./workflows/new-hook.md)                                                             |
| Add a typed query / update                                  | [`workflows/new-endpoint.md`](./workflows/new-endpoint.md)                                                     |
| Sync writes into the Vici engine on icdc-core               | [`workflows/engine-sync.md`](./workflows/engine-sync.md)                                                       |
| Reset the registry + engine on local / staging / production | [`../../../.agents/workflows/icdc-engine-reset.md`](../../../.agents/workflows/icdc-engine-reset.md)           |
| Day-2 ops on the Vici engine                                | [`../../../.agents/workflows/icdc-engine-operations.md`](../../../.agents/workflows/icdc-engine-operations.md) |
