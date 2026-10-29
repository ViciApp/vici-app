# Backend AI Guide (pointer)

> **The Rust risk engine does not live in this repo.** The on-chain
> Clearing + Registry canisters that Vici depends on live in the
> [`icdc-core`](https://github.com/AntonioVentilii/icdc-core) repo
> (typically checked out at [`../icdc-core/`](../../../../icdc-core/)).
> When in doubt, open that repo and obey **its**
> [`AGENTS.md`](../../../../icdc-core/AGENTS.md).

This page exists so agents have a default rule and a clear place to
land when they are about to "edit the backend".

## Default rule for agents

Unless the user prompt explicitly says "edit the backend":

- **Do not modify** any Rust file. There aren't any in this repo today
  (`src/declarations/**` is generated TypeScript), but the rule covers
  any future Rust under `src/`.
- **Do not** add a Cargo workspace, `Cargo.toml`, or `dfx.json` Rust
  canister wiring here.
- **Do not** edit the upstream `../icdc-core/**` from this repo. Open
  the icdc-core repo as its own workspace and PR there.

You may **read** any of these files to understand context for a frontend
or satellite change:

- `../icdc-core/src/registry/**` — the Vici registry interface.
- `../icdc-core/src/clearing/**` — the clearing canister interface.
- `../icdc-core/src/shared/**` — shared types.
- `../icdc-core/src/registry/registry.did` and the equivalent `.did`
  for clearing — the public Candid surface that this repo's
  declarations are generated from.

## Engine integration

Vici registers as an **Engine** on the icdc-core registry. The
architecture, role mapping, and engine-id pinning are documented at
[`docs/engine-integration.md`](../../engine-integration.md). Read that
before you write any code that:

- Calls `add_series` / `fork_series` / `manage_oracle_principals`.
- Mirrors anything from Juno into the Vici engine on `eng_0`.
- Resets or reseeds the registry locally, on staging, or on production (see
  [`engine-integration.md`](../../engine-integration.md) — "icdc-core deployments: staging
  and production").

Day-2 ops runbooks (grant / revoke / audit / kill-switch / rotate
admins):

- [`.agents/workflows/icdc-engine-reset.md`](../../../.agents/workflows/icdc-engine-reset.md)
- [`.agents/workflows/icdc-engine-operations.md`](../../../.agents/workflows/icdc-engine-operations.md)

## Regenerating

The bindings follow the icdc-core release pinned by `ICDC_CORE_VERSION`
in `scripts/build/download.icdc.common.sh`, never icdc-core `main`. To
pick up an upstream change, bump that pin to the new tag. You rarely
bump it by hand: `update-icdc-core.yml` opens a version-only PR every
Monday (or on manual dispatch) when a newer release exists.

The `Bindings` workflow (`bindings.yml`) regenerates the bindings from
the pin on every PR and commits any drift back onto same-repo PR
branches, so a bump PR gets its bindings without anyone running the
script. It can also be dispatched by hand on a branch, which commits the
same way. On fork PRs, `main` and the merge queue it fails instead.
Locally:

```bash
npm run did
```

This script (`scripts/did.sh`) downloads the `.did` files at the pinned
tag, runs `@icp-sdk/bindgen`, writes the generated TypeScript + Candid
to `src/declarations/<canister>/`, and copies `clearing/**` and
`registry/**` to the vendored `backend/src/declarations/` (the backend
shared-drift test pins them byte-for-byte). Commit both trees together
with the FE wiring change.

If you regenerated against a new icdc-core tag / commit, mention it in
the PR `# Motivation` so a reviewer can sequence the deploy. See
[`pr-and-ci.md#cross-repo-changes-icdc-core`](../pr-and-ci.md#9-cross-repo-changes-icdc-core).

## If the prompt **does** ask you to work on icdc-core

Switch context: open `../icdc-core/` as the working directory and obey
**its** `AGENTS.md` / `CLAUDE.md` / governance system. The icdc-core repo
has its own multi-layer governance (`.policies/`, `.boundaries/`,
`.capabilities/`, `.workflows/`) — respect it.

When you come back to this repo to wire the frontend / satellite to the
new upstream method, do that work in a **separate PR here** referencing
the icdc-core PR / commit.

## Future structure (if Rust ever lands here)

If at some future point this repo grows its own Rust crate (e.g. a
Vici-specific oracle, or a custom canister that doesn't fit
icdc-core), this page will expand to mirror `../icdc-core/.agents/`:

- `structure.md` — crate layout, module conventions.
- `patterns.md` — Rust patterns (handler split, error types, …).
- `testing.md` — `cargo test`, integration tests, pocket-ic.
- `workflows/` — common workflows (new endpoint, new migration, …).

Until that happens, this page is intentionally a pointer.
