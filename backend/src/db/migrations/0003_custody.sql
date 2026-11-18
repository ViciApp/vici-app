-- Custody core: supported assets, per-user per-chain custody accounts, the
-- double-entry internal ledger, withdrawals and deposits.

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  chain text not null check (chain in ('ic', 'evm', 'sol', 'btc')),
  symbol text not null,
  decimals int not null check (decimals >= 0),
  -- Chain-level asset locator: ICRC ledger canister id on ic, ERC-20 contract
  -- address on evm, SPL mint on sol; null for a chain's native asset.
  ledger_ref text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chain, symbol)
);

-- One account per (user, chain) plus internal accounts (treasury and the
-- external world) with no user. Every ledger entry references an account, so
-- internal moves and user moves live in one uniform double-entry space.
create table if not exists custody_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete restrict,
  chain text not null check (chain in ('ic', 'evm', 'sol', 'btc')),
  address text not null,
  kind text not null default 'user' check (kind in ('user', 'treasury', 'external')),
  created_at timestamptz not null default now()
);

create unique index if not exists custody_accounts_user_chain_uniq
  on custody_accounts (user_id, chain)
  where user_id is not null;

create unique index if not exists custody_accounts_internal_uniq
  on custody_accounts (kind, chain)
  where user_id is null;

-- Double-entry ledger: every business event posts two or more legs that sum
-- to zero per asset. `event_key` groups the legs of one event; the per-leg
-- `idempotency_key` (event_key plus leg index) makes replays collide instead
-- of double-crediting.
create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references custody_accounts (id) on delete restrict,
  asset_id uuid not null references assets (id) on delete restrict,
  delta numeric not null,
  kind text not null,
  event_key text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_account_asset_idx
  on ledger_entries (account_id, asset_id);

create index if not exists ledger_entries_event_key_idx
  on ledger_entries (event_key);

create or replace view custody_balances as
  select account_id, asset_id, sum(delta) as balance
  from ledger_entries
  group by account_id, asset_id;

-- Withdrawal requests, including the self-custody exit (destination is an
-- address the user controls). State machine enforced in
-- src/custody/withdrawals.ts: requested -> processing -> submitted ->
-- confirmed, with failed/rejected exits and a compensating refund event.
create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  asset_id uuid not null references assets (id) on delete restrict,
  amount numeric not null check (amount > 0),
  destination text not null,
  self_custody boolean not null default false,
  state text not null default 'requested'
    check (state in ('requested', 'processing', 'submitted', 'confirmed', 'failed', 'rejected')),
  tx_ref text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists withdrawals_user_id_idx on withdrawals (user_id);
create index if not exists withdrawals_state_idx on withdrawals (state);

-- On-chain deposits detected by the watchers. The uniqueness key makes each
-- watcher tick idempotent: re-seeing a transaction is a no-op.
create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references custody_accounts (id) on delete restrict,
  asset_id uuid not null references assets (id) on delete restrict,
  amount numeric not null check (amount > 0),
  tx_ref text not null,
  confirmations int not null default 0,
  state text not null default 'seen' check (state in ('seen', 'confirmed', 'credited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, asset_id, tx_ref)
);

create index if not exists deposits_state_idx on deposits (state);

-- Watcher cursors keyed by an adapter-chosen string: one row per chain for
-- block-scanning adapters (key = chain name), one row per watched address
-- where the chain needs it (e.g. sol:<address>). A restart resumes from the
-- stored cursor instead of rescanning from genesis.
create table if not exists chain_cursors (
  chain text primary key,
  cursor text not null,
  updated_at timestamptz not null default now()
);

-- Seed the supported assets. The enabled flags below are the default
-- allowlist (ic only); boot re-applies CUSTODY_ENABLED_ASSETS on top
-- (src/custody/assets.ts), so env stays the source of truth.
insert into assets (chain, symbol, decimals, ledger_ref, enabled) values
  ('ic', 'VXP', 4, 's7ux4-yyaaa-aaaam-qidha-cai', true),
  ('ic', 'ICP', 8, 'ryjl3-tyaaa-aaaaa-aaaba-cai', true),
  ('ic', 'ckUSDC', 6, 'xevnm-gaaaa-aaaar-qafnq-cai', true),
  ('ic', 'ckBTC', 8, 'mxz4u-wiaaa-aaaar-qaada-cai', true),
  ('ic', 'ckETH', 18, 'ss2fx-dyaaa-aaaar-qacoa-cai', true),
  ('evm', 'ETH', 18, null, false),
  ('evm', 'USDC', 6, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', false),
  ('sol', 'SOL', 9, null, false),
  ('btc', 'BTC', 8, null, false)
on conflict (chain, symbol) do nothing;
