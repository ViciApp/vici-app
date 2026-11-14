-- The first judged calibration call per user and market.
--
-- A calibration claim pays only for a correct call, and a correct call is
-- recorded as a vxp_awards row keyed by the market. A wrong call left no row,
-- so the same market could be called again on the other side until it paid.
-- This table holds the side a user first called on a finalised market; a
-- later call on the other side is refused, and the primary key settles two
-- concurrent calls (the second insert collides and reads the first side).
--
-- New table, no existing rows to backfill: calls made before it existed are
-- judged afresh once, as before.

create table if not exists calibration_attempts (
  user_id uuid not null references users (id) on delete cascade,
  series_id text not null,
  chosen_side text not null check (chosen_side in ('YES', 'NO')),
  created_at timestamptz not null default now(),
  primary key (user_id, series_id)
);
