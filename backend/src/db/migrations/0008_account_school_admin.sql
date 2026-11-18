-- Account lifecycle, referral graph, school verification, roles and runtime
-- settings: the final ported satellite domains.

-- Grantable roles beyond admin: solver (oracle settlement) and creator
-- (series authoring). 'user' stays the canonical no-role state; the
-- controller concept is an infrastructure-level notion and never grantable.
alter table users drop constraint if exists users_role_check;
alter table users
  add constraint users_role_check check (role in ('user', 'admin', 'solver', 'creator'));

-- The users row survives hard deletion as the identity anchor; this stamp is
-- the explicit terminal marker so payout paths can refuse a dead account
-- without conflating it with a never-onboarded one.
alter table users add column if not exists hard_deleted_at timestamptz;

-- Referral codes: reverse-indexed like the original collection (the code is
-- the key, the owner the value); one code per user, write-once. The format
-- is 8 chars of Crockford base32 (no I, L, O, U).
create table if not exists referral_codes (
  code text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  owner_user_id uuid not null unique references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Anonymous churn-feedback log written by account deletion. Deliberately no
-- user reference: the row outlives the account that generated it while
-- staying unlinkable. Append-only by service contract (no update path).
create table if not exists exit_signals (
  id uuid primary key default gen_random_uuid(),
  reason text not null check (reason in
    ('not-for-me', 'too-busy', 'privacy', 'duplicate', 'bugs', 'other')),
  note text not null default '' check (char_length(note) <= 240),
  created_at_ms bigint not null,
  created_at timestamptz not null default now()
);

-- School-email verification submissions: one immutable row per code send
-- (a resend is a new row, never an overwrite of a possibly-verified prior
-- attempt). Only the salted digest of the 6-digit code is stored; the
-- plaintext lives solely in the outbound email. Guessing is bounded by the
-- attempt cap + TTL + the per-user / per-email daily rate limit.
create table if not exists school_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  email text not null,
  school_id text not null,
  school_name text not null,
  country text,
  domains text[] not null default '{}',
  is_new boolean not null default false,
  code_hash text not null,
  salt text not null,
  expires_at_ms bigint not null,
  attempts int not null default 0 check (attempts >= 0),
  status text not null default 'awaiting' check (status in ('awaiting', 'verified', 'expired')),
  created_at_ms bigint not null,
  verified_at_ms bigint,
  created_at timestamptz not null default now()
);

-- The rolling-24h rate limit scans by user and by email; the registry
-- recompute scans a school's verified rows.
create index if not exists school_submissions_user_created_idx
  on school_submissions (user_id, created_at desc);

create index if not exists school_submissions_email_created_idx
  on school_submissions (email, created_at desc);

create index if not exists school_submissions_school_verified_idx
  on school_submissions (school_id)
  where status = 'verified';

-- School registry: one row per school that has at least one verified member
-- (or was seeded by an admin). verified_member_count is recomputed from the
-- verified submissions (distinct members), never incremented, so concurrent
-- verifications cannot drift the count; a school goes public at 3.
create table if not exists schools (
  school_id text primary key,
  name text not null,
  country text,
  domains text[] not null default '{}',
  verified_member_count int not null default 0 check (verified_member_count >= 0),
  status text not null default 'pending' check (status in ('pending', 'public')),
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  created_at timestamptz not null default now()
);

-- Runtime configuration outside the repo (feature kill switches, operational
-- toggles), admin-managed. Values are free-shape JSON per key.
create table if not exists app_settings (
  key text primary key check (key <> ''),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
