-- One row per client-chosen deposit / withdrawal id on the clearing bridge.
-- Clearing is only idempotent for sequential replays of an id: two overlapping
-- calls with the same id can both reach its finalise step and credit twice, so
-- the API claims the id here before signing anything.
create table if not exists collateral_operations (
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdraw')),
  operation_id text not null,
  state text not null default 'pending' check (state in ('pending', 'done')),
  claimed_at timestamptz not null default now(),
  primary key (user_id, kind, operation_id)
);
