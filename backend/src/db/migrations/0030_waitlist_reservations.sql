-- The handle waitlist: a signed-out visitor reserves a handle for a mailbox
-- they prove with a six-digit code, with no account behind it.
--
-- waitlist_reservations holds one row per mailbox (email_key unique, the
-- key of `emailMailboxKey`: no +tag, no Gmail dots): the address as typed
-- (where mail goes), the confirmed handle and the one a code was last
-- requested for, that code hashed with its expiry and spent attempts, the
-- status token hashed, the language every email is written in, when the
-- consent sentence was accepted and which policy version it linked, the
-- landing entry point, and the invite or challenge link the visitor arrived
-- through. No IP, no user agent, no plaintext code or token. Two mailboxes
-- never hold one handle (the partial unique index); the live pending hold is
-- checked under the handle's advisory lock (`lockHandleKey`), because no
-- index reads the clock, and the profile write checks reservations under the
-- same lock. hold_ended_at and account_user_id are written when an account
-- takes the handle.
--
-- waitlist_email_deliveries makes an email a worker job sends go out once:
-- a leased claim before the send, the stamp after it (src/waitlist/delivery.ts).
--
-- The per-mailbox send cap needs no table of its own: it is a window of
-- rate_limit_windows (0027).

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
