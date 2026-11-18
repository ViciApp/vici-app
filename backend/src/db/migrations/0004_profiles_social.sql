-- Profiles and the social graph: user profiles (nickname authority, daily
-- Flow counter, soft-delete and hibernation markers), dashboard stat caches,
-- relations (friendships and follows), the activity feed with per-activity
-- reaction rollups, and the friend-readable resolved-results digest.

-- One profile row per user. Field set mirrors the client-synced profile doc:
-- server-enforced fields (nickname, daily goal counter, hidden markers,
-- handle-change stamp) are typed columns so the guards and rank queries can
-- index them; client-owned preference and achievement bags stay jsonb.
create table if not exists profiles (
  user_id uuid primary key references users (id) on delete cascade,
  nickname text not null default '',
  -- Case- and accent-insensitive uniqueness fold of nickname, maintained by
  -- the profile service on every write. The stored nickname keeps the
  -- owner's form; collisions are decided on this fold.
  nickname_key text not null default '',
  avatar text not null default '',
  avatar_parts text not null default '',
  email text not null default '',
  pnl double precision not null default 0,
  visibility text not null default 'friends_only'
    check (visibility in ('public', 'friends_and_followers', 'friends_only')),
  total_trades int not null default 0,
  win_rate double precision not null default 0,
  daily_streak int not null default 0,
  longest_streak int not null default 0,
  daily_goal_done int not null default 0 check (daily_goal_done >= 0),
  daily_goal_date text,
  streak int not null default 0,
  accuracy double precision not null default 0,
  points double precision not null default 0,
  level int not null default 1,
  archetype text not null default '',
  interests jsonb not null default '[]',
  last_active_day text,
  -- Presence = soft-deleted (wall-clock ms of the delete request); absence
  -- is the meaningful "active account" state.
  deleted_at_ms bigint,
  -- Presence = hibernated (the reversible sibling of soft-delete); absence
  -- is the meaningful "active account" state.
  hibernated_at_ms bigint,
  unlocked_achievements jsonb not null default '[]',
  contrarian_wins int not null default 0,
  best_upset_consensus double precision,
  on_fire_streak int not null default 0,
  comebacks int not null default 0,
  winning_categories int not null default 0,
  leagues_joined int not null default 0,
  bouts_won int not null default 0,
  leagues_founded int not null default 0,
  top_decile_streak int not null default 0,
  last_top_decile_day text,
  sharpest_eye_best_tier text,
  school_status text,
  -- Nullable on purpose: absence means "never seeded", which the client's
  -- celebration pipeline reads differently from an explicit empty array.
  earned_menagerie jsonb,
  handle_last_change_ms bigint,
  preferences jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nickname uniqueness on the fold; legacy imported rows may carry an empty
-- nickname, which never conflicts.
create unique index if not exists profiles_nickname_key_uniq
  on profiles (nickname_key)
  where nickname_key <> '';

-- Rank queries order the visible (non-hidden) population by points with the
-- user id as the deterministic tie-break.
create index if not exists profiles_rank_idx
  on profiles (points desc, user_id)
  where deleted_at_ms is null and hibernated_at_ms is null;

-- Per-user dashboard cache: per-category accuracy plus recent settlements,
-- written by the client's stats sync and structurally validated server-side.
create table if not exists user_stats (
  user_id uuid primary key references users (id) on delete cascade,
  category_stats jsonb not null default '{}',
  recent_settlements jsonb not null default '[]',
  computed_at_ms bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Per-user per-month gameplay counters driving the monthly album awards.
create table if not exists user_monthly_stats (
  user_id uuid not null references users (id) on delete cascade,
  month_anchor text not null check (month_anchor ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  month_calls int not null default 0 check (month_calls >= 0),
  month_wins int not null default 0 check (month_wins >= 0),
  month_consensus jsonb not null default '[]',
  updated_at_ms bigint not null default 0,
  primary key (user_id, month_anchor),
  check (month_wins <= month_calls)
);

-- The monthly leaderboard aggregates one month across all users.
create index if not exists user_monthly_stats_month_idx
  on user_monthly_stats (month_anchor);

-- Relations: friendships (one row per unordered pair, key = sorted user ids
-- joined by '#') and follows (one row per directed edge, key =
-- 'follow#sender#target'). participant_one is the sender / follower,
-- participant_two the target, matching the participants array order the
-- state machine reasons about. updated_at carries the rejected-cooldown
-- anchor (the reject write is the last write a REJECTED row receives).
create table if not exists relations (
  key text primary key,
  category text not null check (category in ('FRIEND', 'follow', 'GROUP')),
  state text not null check (state in ('PENDING', 'ACTIVE', 'REJECTED', 'BLOCKED')),
  participant_one uuid not null references users (id) on delete cascade,
  participant_two uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists relations_participant_one_idx
  on relations (participant_one, category, state);

create index if not exists relations_participant_two_idx
  on relations (participant_two, category, state);

-- Social feed. Key keeps the '${user}#${timestamp}#${type}' shape so
-- reactions can address an activity by one stable identifier.
create table if not exists activities (
  key text primary key,
  user_id uuid not null references users (id) on delete cascade,
  type text not null
    check (type in ('trade', 'settlement', 'comment', 'follow', 'upvote', 'downvote')),
  target_user uuid references users (id) on delete set null,
  market_id text,
  title text not null default '',
  details text,
  timestamp_ms bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists activities_created_idx
  on activities (created_at desc);

create index if not exists activities_type_created_idx
  on activities (type, created_at desc);

create index if not exists activities_user_idx
  on activities (user_id);

-- One row per (activity, liker). activity_title and market_id are
-- denormalized copies of the liked activity so the like-received inbox card
-- renders without re-fetching the activity.
create table if not exists activity_reactions (
  activity_key text not null,
  liker uuid not null references users (id) on delete cascade,
  timestamp_ms bigint not null,
  activity_title text not null default '',
  market_id text,
  created_at timestamptz not null default now(),
  primary key (activity_key, liker)
);

create index if not exists activity_reactions_created_idx
  on activity_reactions (created_at desc);

-- Per-activity like-count rollup, maintained transactionally with the
-- reaction writes; the admin recompute re-derives exact counts on demand.
create table if not exists activity_reaction_counts (
  activity_key text primary key,
  count int not null default 0 check (count >= 0),
  updated_at_ms bigint not null default 0
);

-- Per-participant resolved-result rows for the friend-readable results
-- digest. One row per (user, market); a settlement replay overwrites the
-- existing row instead of duplicating it. net_vxp is the signed realized
-- cashflow in USD-decimal base units.
create table if not exists resolved_results (
  user_id uuid not null references users (id) on delete cascade,
  market_id text not null,
  title text not null default '',
  side text not null default '',
  outcome text not null check (outcome in ('win', 'loss')),
  net_vxp numeric not null,
  resolved_at_ms bigint not null,
  primary key (user_id, market_id)
);

-- Retention pruning scans on the resolution time.
create index if not exists resolved_results_resolved_at_idx
  on resolved_results (resolved_at_ms);
