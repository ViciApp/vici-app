-- The network fee a withdrawal costs the sender.
--
-- An ICRC ledger charges its transfer fee on top of the amount, from the
-- sender: a withdrawal of `amount` lowers the custodial balance by
-- `amount + fee`. The fee is fixed when the withdrawal is requested, held from
-- the user together with the amount and sent explicitly with every attempt,
-- so the internal balance keeps tracking the on-chain one (the ic deposit
-- watcher credits any surplus of on-chain over internal as a deposit).
--
-- Rows from before this column hold 0: their hold covered the amount alone,
-- and their transfer was sent without a fee, so a resend keeps omitting it to
-- stay byte-identical for the ledger's deduplication.

alter table withdrawals add column if not exists fee numeric not null default 0
  check (fee >= 0);

-- The fee leg of every withdrawal hold lands in a per-chain `network_fee`
-- account, kept apart from `external` so the fees paid stay visible.
alter table custody_accounts drop constraint if exists custody_accounts_kind_check;

alter table custody_accounts add constraint custody_accounts_kind_check
  check (kind in ('user', 'treasury', 'external', 'network_fee'));
