# Custody: deposits and withdrawals

The rules of the deposit watcher and the withdrawal path in `backend/src/chains/` and `backend/src/custody/`. Read this page before touching either: none of it is discoverable from one adapter, and each rule guards a lost, doubled or unintended movement of funds.

> Higher up the chain: [`AGENTS.md`](../../../AGENTS.md) → [API README](./README.md).

## Deposit watcher and withdrawal contract

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
- **A `tx` deposit's key names one transfer, not one transaction.** Deposits
  dedupe on `(account_id, asset_id, tx_ref)`, and one evm transaction can carry
  several ERC-20 Transfer logs to one address, so a token log is keyed
  `<txHash>:<logIndex>`. The first such log of a transaction to an address
  keeps the bare hash: rows booked before the log index was in the key carry
  it, and a rescan must collide with them, not credit them again.
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
- **A retried request is the withdrawal it already filed.** The client sends
  a fresh `idempotencyKey` for each withdrawal the user asks for and resends
  it on every retry. `requestWithdrawal` looks the key up under the account
  lock, before the balance (the first hold already spent it), and returns
  that row as it stands, with no second hold: the route answers 201 with it
  and runs the first attempt again, and since only one claim of the row
  wins, the transfer still goes out at most once. The same key for another asset, amount, destination
  or `selfCustody` answers 409 `idempotency_key_reused`; the fee is not
  compared, since the route reads it fresh. The key is unique per user
  (partial index on `withdrawals (user_id, idempotency_key)`) and the insert
  is `on conflict do nothing`, so a concurrent request the lock does not
  serialise (another chain's account) still files one row and one hold. A
  request without a key keeps filing a new withdrawal each time, for older
  clients.
- **The destination is checked before the hold.** The route refuses an
  address `adapter.isValidAddress` rejects with `invalid_destination`. An
  address the chain cannot parse fails inside the transfer as an unknown
  outcome, so the hold would sit until a human settles it.
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
- **Every ICRC send carries a memo unique to what it pays** (`withdrawal:<id>`,
  `vxp:<type>:<key>`). The ledger deduplicates identical transfers and
  `created_at_time` has millisecond resolution, so two payouts of one amount to
  one account in one millisecond would otherwise collapse into one block. A
  VXP award counts a `Duplicate` (or a history match) as paid only when it
  replays its own earlier send and no other award holds that block; otherwise
  nothing moved for it and it goes back to pending.
