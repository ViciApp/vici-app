-- Auth and identity: users, provider identities, sessions, one-time codes,
-- and the legacy principal linkage that maps on-chain identities to accounts.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  role text not null default 'user' check (role in ('user', 'admin')),
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- One row per (provider, provider-subject). The email provider uses the
-- normalized address as its subject; OAuth providers use their stable sub
-- claim so a later email change at the provider cannot detach the account.
create table if not exists auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null check (provider in ('google', 'apple', 'email')),
  subject text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);

-- The email provider keys accounts by address, so the address must be unique
-- within that provider (case-insensitive). OAuth providers key by subject and
-- may legitimately re-report a changed email, so no uniqueness there.
create unique index if not exists auth_identities_email_provider_uniq
  on auth_identities (lower(email))
  where provider = 'email';

-- Cross-provider account linking looks identities up by verified address.
create index if not exists auth_identities_lower_email_idx
  on auth_identities (lower(email));

-- The id column stores HMAC-SHA256(token, SESSION_SECRET), never the token:
-- a database leak alone cannot forge a session cookie.
create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_user_id_idx on sessions (user_id);

-- Email one-time codes, hashed at rest with the same server pepper.
-- Single-use, short TTL, attempt-limited; see src/auth/otp.ts.
create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists otp_codes_lower_email_idx on otp_codes (lower(email));

-- Link between a web2 account and the on-chain principal(s) it owned on the
-- legacy stack. Filled automatically on login by email match (see
-- src/auth/identity.ts) and later by the data-migration tooling.
create table if not exists legacy_principals (
  principal text primary key,
  user_id uuid not null references users (id) on delete cascade,
  matched_via text not null check (matched_via in ('openid_email', 'profile_email')),
  linked_at timestamptz not null default now()
);

create index if not exists legacy_principals_user_id_idx on legacy_principals (user_id);

-- Exported snapshot of the legacy authentication identities: which principal
-- signed in with which provider and which email addresses it exposed. Empty
-- until the export tooling populates it; the login auto-match reads it.
create table if not exists legacy_auth_identities (
  principal text primary key,
  provider text,
  openid_email text,
  profile_email text,
  exported_at timestamptz not null default now()
);

create index if not exists legacy_auth_identities_openid_email_idx
  on legacy_auth_identities (lower(openid_email))
  where openid_email is not null;

create index if not exists legacy_auth_identities_profile_email_idx
  on legacy_auth_identities (lower(profile_email))
  where profile_email is not null;
