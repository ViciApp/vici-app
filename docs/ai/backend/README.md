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
script. It also runs on `main`, where drift opens a
`bot-update-bindings` PR instead, and can be dispatched by hand on any
branch (commit) or on `main` (PR). On fork PRs and the merge queue it
fails instead. Locally:

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

## Deposit watcher and withdrawal contract (`backend/src/chains/`, `backend/src/custody/`)

Not discoverable from one adapter, and each rule guards a lost, doubled or
unintended movement of funds:

- **`watchScope` decides who may be batched.** `address` adapters are paged
  across ticks. A `chain` adapter walks a position it never revisits, so an
  address missing from one pass loses its deposits for good: it gets every
  address, and bounds its own pass (`MAX_BLOCKS_PER_TICK`).
- **`watchDeposits` only reads.** A pass past its deadline is abandoned while
  it runs. Persisted state moves in the returned `commit`, which the watcher
  calls after every event is credited.
- **Timeouts wrap the watch pass, never the adapter's shared `rpc`.** `transfer`
  uses that `rpc` too: a broadcast cut short there has an unknown outcome, and
  on a chain that cannot deduplicate that withdrawal then needs a human.
- **`balance` deposits are keyed by credit number, never by balance.** An
  account can return to an amount it held before, and a balance key then drops
  the deposit on the unique conflict. Replays are stopped by the delta, not the
  key. Read the credit count in the same statement as the internal balance: a
  count fresher than the balance gives a stale delta a key nobody else holds,
  and it double-credits.
- **`transferStatus` answers `failed` only on a definite on-chain failure.**
  The `withdrawal-confirmations` job refunds a `failed` withdrawal, so a
  transfer the chain does not know yet, or a status read that errors or times
  out, stays `pending`: refunding one that later lands pays the user twice.
  Every `submitted` row counts as in flight in the `balance` delta, so a chain
  must eventually answer `confirmed` (ic does at once: a block index is final).
- **The deposit watcher never books VXP, and withdrawals never accept it:
  two separate guards.** The watcher skips VXP (`isVxp` in `backend/src/custody/assets.ts`)
  because its balance is read live from the ledger. `requestWithdrawal`
  rejects it with `AssetNotWithdrawableError` before reading any balance, and
  `POST /api/v1/wallet/withdrawals` answers 400 with
  `{ error: 'asset_not_withdrawable' }`. Do not lean on an empty internal VXP
  balance to keep it on the platform: a new credit path would quietly open the
  exit. `GET /api/v1/wallet/assets` reports the same rule as `withdrawable`.

## Withdrawal execution contract (`backend/src/chains/withdrawal-execution.ts`)

The request route and the `withdrawal-recovery` worker job share one execution
path. Each rule guards a withdrawal paid twice or stuck forever:

- **Refund only on a definite rejection.** `transfer` throws
  `TransferRejectedError` only when the chain proves the funds did not move.
  Any other error, or a timeout, leaves the row `processing`: refunding a
  transfer that landed pays the user twice.
- **Dedup fields are fixed at the claim, before any send.** `claimWithdrawal`
  (requested -> processing) stamps `transfer_memo` and `transfer_created_at_ns`
  once; every attempt resends exactly those. Never regenerate them for a row
  that may have been sent.
- **Only a `replaySafe` adapter is resent.** On an ICRC ledger a resend inside
  the dedup window answers `Duplicate` with the original block, which counts as
  success. A replay's rejection proves nothing landed only when the ledger
  checks it after the duplicate lookup (`InsufficientFunds`); a replay answered
  `TooOld` throws `TransferUnverifiableError` and waits for a human, as does
  every stale `processing` row on a chain that cannot deduplicate, sent without
  the fields, or past `DEDUP_SAFE_WINDOW_MS`.
- **Resend only after every earlier send resolved.** `PROCESSING_GRACE_MS`
  outlasts the IC ingress expiry and the route's transfer timeout, so a resend
  answered `InsufficientFunds` cannot refund a first send still about to land.
- **The network fee is held with the amount and fixed at the request.** An
  ICRC ledger charges its fee from the sender on top of the amount, and the
  ic watcher credits any surplus of on-chain over internal as a deposit, so
  the books must drop by exactly what the chain does. The route reads
  `adapter.withdrawalFee` (uncached; `/wallet/assets` quotes a cached copy),
  `requestWithdrawal` stores it as `withdrawals.fee`, checks the balance
  against amount + fee and holds both in one event: the amount to `external`,
  the fee to the chain's `network_fee` account. The refund reverses the same
  legs under the same event key, and the watcher counts amount + fee of every
  in-flight row. Every send carries the stored fee explicitly: a ledger whose
  fee moved answers `BadFee`, a refund on a first send and proof of nothing
  on a replay (the ledger checks the fee before the duplicate lookup). A row
  with `fee = 0` predates the hold and is sent without a fee, so its resend
  stays identical to the first send. evm, sol and btc report a zero fee:
  their fees are priced at send time in ways one stored number cannot hold.
- **The ICRC helpers live in `chains/ic/icrc.ts`** (memo encoding, error
  variants, the dedup window), shared with the VXP award payouts. Do not add a
  second copy.

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
