-- Core plumbing every later migration relies on.

-- gen_random_uuid() for uuid primary keys across all future tables.
create extension if not exists pgcrypto;

-- Mirrors the runner's bootstrap (db/migrate.ts) so a hand-applied schema and
-- a runner-applied one converge on the same tables.
create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- Small operational key/value surface: schema markers, cutover flags, one-off
-- operational switches that must survive deploys without a dedicated table.
create table if not exists app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
