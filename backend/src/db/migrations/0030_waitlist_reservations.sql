-- The handle waitlist: a signed-out visitor reserves a handle for a mailbox
-- they prove with a six-digit code, with no account behind it.
--
-- email_mailbox_key(address) is the SQL twin of `otpMailboxKey`
-- (src/auth/otp.ts, re-exported as `emailMailboxKey` by
-- src/waitlist/mailbox.ts): lowercased and trimmed, without a `+tag`, and for
-- Gmail without dots and on gmail.com. tests/waitlist-mailbox.test.ts pins the
-- two against each other. The waitlist matches a person by mailbox, so the
-- address columns of the sign-in identities and the legacy identities carry
-- the key as generated columns: every writer, past and future, fills them
-- without knowing they exist, and existing rows get theirs here.
--
-- waitlist_reservations holds one row per mailbox (email_key unique): the
-- address as typed (where mail goes), the confirmed handle and the one a
-- code was last requested for, that code hashed with its expiry and spent
-- attempts, the status token hashed, the language every email is written
-- in, when the consent sentence was accepted and which policy version it
-- linked, the landing entry point, and the invite or challenge link the
-- visitor arrived through. No IP, no user agent, no plaintext code or token.
-- Two mailboxes never hold one handle (the partial unique index); the live
-- pending hold and the profiles side are checked under the handle's advisory
-- lock (`lockHandleKey`), because no index spans two tables or reads the
-- clock. hold_ended_at and account_user_id are written when an account takes
-- the handle.
--
-- waitlist_email_deliveries makes an email a worker job sends go out once:
-- a leased claim before the send, the stamp after it (src/waitlist/delivery.ts).
--
-- The per-mailbox send cap needs no table of its own: it is a window of
-- rate_limit_windows (0027).

create or replace function email_mailbox_key(address text) returns text
language plpgsql immutable parallel safe as $$
declare
  e text := lower(btrim(address, E' \t\n\r\f\v'));
  at_index int;
  local_part text;
  domain text;
  untagged text;
begin
  if e is null or position('@' in e) = 0 then
    return e;
  end if;

  at_index := length(e) - position('@' in reverse(e)) + 1;

  if at_index <= 1 then
    return e;
  end if;

  local_part := substr(e, 1, at_index - 1);
  domain := substr(e, at_index + 1);
  untagged := split_part(local_part, '+', 1);

  if untagged = '' then
    return e;
  end if;

  if domain in ('gmail.com', 'googlemail.com') then
    return replace(untagged, '.', '') || '@gmail.com';
  end if;

  return untagged || '@' || domain;
end;
$$;

alter table auth_identities
  add column if not exists email_mailbox_key text
  generated always as (email_mailbox_key(email)) stored;

create index if not exists auth_identities_email_mailbox_key_idx
  on auth_identities (email_mailbox_key)
  where email_mailbox_key is not null;

alter table legacy_auth_identities
  add column if not exists openid_email_mailbox_key text
  generated always as (email_mailbox_key(openid_email)) stored;

alter table legacy_auth_identities
  add column if not exists profile_email_mailbox_key text
  generated always as (email_mailbox_key(profile_email)) stored;

create index if not exists legacy_auth_identities_openid_mailbox_key_idx
  on legacy_auth_identities (openid_email_mailbox_key)
  where openid_email_mailbox_key is not null;

create index if not exists legacy_auth_identities_profile_mailbox_key_idx
  on legacy_auth_identities (profile_email_mailbox_key)
  where profile_email_mailbox_key is not null;

create table if not exists waitlist_reservations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_key text not null unique,
  handle text check (handle is null or handle ~ '^[a-z0-9]{3,15}$'),
  pending_handle text check (pending_handle is null or pending_handle ~ '^[a-z0-9]{3,15}$'),
  code_hash text,
  code_expires_at timestamptz,
  code_attempts int not null default 0,
  status_token_hash text,
  locale text not null,
  consent_at timestamptz not null,
  privacy_version text not null,
  source text not null check (source in ('nav', 'markets', 'footer', 'call')),
  invited_referral_code text,
  invited_challenge_id text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz,
  hold_ended_at timestamptz,
  account_user_id uuid references users (id) on delete cascade,
  check (invited_referral_code is null or invited_challenge_id is null)
);

create unique index if not exists waitlist_reservations_held_handle_uniq
  on waitlist_reservations (handle)
  where handle is not null and hold_ended_at is null;

create index if not exists waitlist_reservations_pending_handle_idx
  on waitlist_reservations (pending_handle)
  where pending_handle is not null;

create unique index if not exists waitlist_reservations_status_token_uniq
  on waitlist_reservations (status_token_hash)
  where status_token_hash is not null;

create index if not exists waitlist_reservations_unconfirmed_idx
  on waitlist_reservations (code_expires_at)
  where confirmed_at is null;

create index if not exists waitlist_reservations_account_idx
  on waitlist_reservations (account_user_id)
  where account_user_id is not null;

create table if not exists waitlist_email_deliveries (
  delivery_key text primary key,
  created_at timestamptz not null default now(),
  claimed_at timestamptz not null,
  sent_at timestamptz
);
