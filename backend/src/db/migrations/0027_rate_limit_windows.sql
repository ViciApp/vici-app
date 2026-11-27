-- Rate-limit windows shared by every API machine.
--
-- The limiter in src/lib/rate-limit.ts keeps its windows in process memory,
-- so with several API machines each one counts on its own and a limit is
-- worth one budget per machine. A limit that guards someone other than the
-- caller (the per-inbox cap on sign-in code emails) must hold across machines,
-- so its fixed window lives here: one row per limit key, bumped by a single
-- upsert that restarts the window once `reset_at` has passed
-- (`enforceSharedLimit`). A row past `reset_at` is dead weight and is pruned
-- opportunistically by the same module.
--
-- A new table only: nothing existing changes, so the previous release keeps
-- working, and `if not exists` makes a second run a no-op.

create table if not exists rate_limit_windows (
  key text primary key,
  count int not null check (count >= 0),
  reset_at timestamptz not null
);

create index if not exists rate_limit_windows_reset_at_idx on rate_limit_windows (reset_at);
