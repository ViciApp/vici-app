-- Market curation and product analytics: per-series editorial metadata, the
-- tag reverse index derived from the 3-layer taxonomy, per-locale translation
-- overlays, and the behavioural event log with its daily rollups.

-- One editorial row per series. `tags` keeps the ordered flat list the client
-- understands (first micro = primary classification, unknown values are free
-- tags); the queryable per-tag view lives in market_tag_index.
create table if not exists market_metadata (
  series_id text primary key,
  why_now jsonb,
  events jsonb not null default '[]',
  tags jsonb not null default '[]',
  suggested boolean not null default false,
  subtitle text,
  updated_at_ms bigint not null default 0,
  updated_by uuid references users (id) on delete set null
);

-- Reverse index `bucket -> series`: one row per (bucket, series). Bucket keys
-- are the closed taxonomy (a micro id, or a macro id derived from a micro);
-- Layer-3 free tags are never indexed. Maintained transactionally with each
-- metadata write and rebuildable from scratch by the admin corrective.
create table if not exists market_tag_index (
  tag text not null,
  series_id text not null references market_metadata (series_id) on delete cascade,
  primary key (tag, series_id)
);

-- Per-locale translation overlay. Independent of market_metadata: a series
-- can carry translations without editorial metadata and vice versa. The
-- locale value is validated against the registered locale ids in code.
create table if not exists market_translations (
  series_id text not null,
  locale text not null,
  title text not null default '',
  description text not null default '',
  resolution text not null default '',
  outcomes jsonb not null default '[]',
  updated_at_ms bigint not null default 0,
  updated_by uuid references users (id) on delete set null,
  primary key (series_id, locale)
);

-- Append-only behavioural event log. `key` starts with a monotonic ns stamp
-- ('${stamp}-${sessionId}-${index}' from client ingest,
-- '${stamp}-server-${seq}-${index}' from server capture), so key order is
-- chronological and the warehouse keyset export pages by key exactly like the
-- drain contract expects. user_id is the pseudonymous link to the session
-- user (absent before sign-in); rows carry no PII beyond it.
create table if not exists analytics_events (
  key text primary key,
  name text not null,
  ts_ms bigint not null,
  session_id text not null,
  user_id uuid references users (id) on delete set null,
  path text,
  props jsonb,
  created_at timestamptz not null default now()
);

-- Daily per-event-name counters, bumped in the same transaction as the event
-- writes so the summary never drifts from the log it aggregates.
create table if not exists analytics_event_rollups (
  epoch_day bigint not null,
  name text not null,
  count bigint not null default 0 check (count >= 0),
  updated_at_ms bigint not null default 0,
  primary key (epoch_day, name)
);
