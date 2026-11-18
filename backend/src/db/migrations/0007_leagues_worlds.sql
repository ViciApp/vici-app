-- Leagues, battles, Worlds affiliations and the monthly tournament: the
-- social-competition surface. League and battle ids stay the client-minted
-- text slugs so imported rows keep their identity; battle sides are league
-- ids (kind='league') or user uuids as text (kind='duel'), matching the
-- dual-shape side fields the state machine reasons about.

create table if not exists leagues (
  id text primary key,
  name text not null check (char_length(name) between 3 and 40),
  description text check (char_length(description) <= 240),
  -- Six uppercase alphanumerics; write-once and unique so the join-by-code
  -- flow resolves at most one league per code for the league's lifetime.
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  owner_user_id uuid not null references users (id) on delete cascade,
  created_at_ms bigint not null,
  accent_color text,
  emblem text,
  -- Privacy gates discovery only, never the join: 'open' is publicly listed,
  -- 'private' is invite-code-only.
  privacy text not null default 'open' check (privacy in ('open', 'private')),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leagues_owner_idx on leagues (owner_user_id);

-- One row per (league, member); the composite key is the membership identity,
-- so duplicate joins collide naturally.
create table if not exists league_members (
  league_id text not null references leagues (id) on delete cascade,
  member_user_id uuid not null references users (id) on delete cascade,
  joined_at_ms bigint not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  primary key (league_id, member_user_id)
);

create index if not exists league_members_member_idx on league_members (member_user_id);

-- Rolling per-league counters fanned out from member profile / stats writes.
-- Lifetime only: battles and tournament rounds score windows as the delta
-- between a frozen start snapshot and the current row.
create table if not exists league_stats (
  league_id text primary key references leagues (id) on delete cascade,
  total_calls int not null default 0 check (total_calls >= 0),
  wins int not null default 0 check (wins >= 0),
  categories jsonb not null default '{}',
  updated_at_ms bigint not null default 0,
  check (wins <= total_calls)
);

-- Battles: time-bound competitions, league-vs-league or user-vs-user (duel).
-- The forward-only state machine and all field write-once rules live in the
-- battles service; columns are nullable where the satellite fields were
-- optional (stamped on later transitions).
create table if not exists battles (
  id text primary key,
  kind text not null check (kind in ('league', 'duel')),
  side_a text not null,
  side_b text not null,
  proposer_user_id uuid not null references users (id) on delete cascade,
  state text not null check (state in
    ('proposed', 'accepted', 'in_flight', 'resolved', 'declined', 'expired')),
  kickoff_ms bigint not null,
  settle_ms bigint not null,
  scope text,
  wager int check (wager between 0 and 500),
  trash_talk text check (char_length(trash_talk) <= 60),
  respond_by_ms bigint,
  responded_at_ms bigint,
  baseline_a jsonb,
  baseline_b jsonb,
  score_a int check (score_a between 0 and 100),
  score_b int check (score_b between 0 and 100),
  calls_a int check (calls_a >= 0),
  calls_b int check (calls_b >= 0),
  winner text check (winner in ('A', 'B', 'draw')),
  resolved_at_ms bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kickoff_ms < settle_ms)
);

create index if not exists battles_side_a_idx on battles (side_a);
create index if not exists battles_side_b_idx on battles (side_b);
create index if not exists battles_state_idx on battles (state);

-- Worlds affiliations: one university and/or one country slot per user, each
-- carrying the 90-day switch lock. The (member, kind) primary key enforces the
-- one-slot-per-kind model at the schema level: switching identifiers is a
-- delete-then-insert of the single slot, never a second row. The leave path is
-- gated on locked_until_ms.
create table if not exists affiliations (
  member_user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('university', 'country')),
  affiliation_identifier text not null check (affiliation_identifier <> ''),
  joined_at_ms bigint not null,
  locked_until_ms bigint not null,
  primary key (member_user_id, kind)
);

create index if not exists affiliations_kind_identifier_idx
  on affiliations (kind, affiliation_identifier);

-- Frozen monthly Worlds snapshots: one immutable row per (kind, affiliation,
-- closed month), written by the freeze the first time a closed month's podium
-- is needed. Write-once is enforced by the primary key plus the service-level
-- all-or-nothing month gate; the live windows are recomputed on read and are
-- never persisted here.
create table if not exists affiliation_stats (
  kind text not null check (kind in ('university', 'country')),
  affiliation_identifier text not null,
  month_anchor text not null check (month_anchor ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  total_calls int not null default 0 check (total_calls >= 0),
  wins int not null default 0 check (wins >= 0),
  month_total_calls int not null default 0 check (month_total_calls >= 0),
  month_wins int not null default 0 check (month_wins >= 0),
  updated_at_ms bigint not null default 0,
  primary key (kind, affiliation_identifier, month_anchor),
  check (wins <= total_calls),
  check (month_wins <= month_total_calls)
);

create index if not exists affiliation_stats_month_idx
  on affiliation_stats (kind, month_anchor);

-- Monthly tournament: one row per month (the YYYY-MM primary key makes the
-- draw idempotent by collision) plus one row per bracket slot.
create table if not exists tournaments (
  id text primary key check (id ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  month_start_ms bigint not null,
  month_end_ms bigint not null,
  bracket_size int not null,
  state text not null check (state in ('in_flight', 'concluded')),
  seeded_league_ids jsonb not null,
  created_at_ms bigint not null
);

create table if not exists tournament_matches (
  tournament_id text not null references tournaments (id) on delete cascade,
  round text not null check (round in ('r1', 'quarter', 'semifinal', 'final')),
  index int not null check (index >= 0),
  from_league_id text,
  to_league_id text,
  -- Start-of-window league counters, frozen when a league is assigned to the
  -- slot; the round window delta is current league_stats minus these.
  from_start_calls int,
  from_start_wins int,
  to_start_calls int,
  to_start_wins int,
  from_acc double precision,
  to_acc double precision,
  winner_league_id text,
  start_ms bigint not null,
  end_ms bigint not null,
  primary key (tournament_id, round, index),
  check (end_ms > start_ms)
);
