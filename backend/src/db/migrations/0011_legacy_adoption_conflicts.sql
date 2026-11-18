-- Provisional-account adoption leftovers. The importer creates one
-- claim_pending account per legacy principal, so a person who used several
-- principals (e.g. Google plus a passkey) owns several provisional accounts.
-- Login and claim adopt at most one of them into a signed-in account and
-- never merge two populated accounts automatically: user ids are embedded in
-- activity and relation keys, and VXP already sits on each account's own
-- derived principal. Every provisional account left behind that way is
-- recorded here for an admin to resolve by hand.

create table if not exists legacy_adoption_conflicts (
  principal text not null,
  -- The provisional account still holding that principal's imported data.
  provisional_user_id uuid not null references users (id) on delete cascade,
  -- The signed-in account the same person ended up with.
  matched_user_id uuid not null references users (id) on delete cascade,
  -- multiple_matches: the login email matched several provisional accounts
  -- and another one was adopted. account_not_empty: a claim was refused
  -- because the caller's account already holds its own data.
  reason text not null check (reason in ('multiple_matches', 'account_not_empty')),
  noted_at timestamptz not null default now(),
  primary key (principal, matched_user_id)
);

create index if not exists legacy_adoption_conflicts_provisional_idx
  on legacy_adoption_conflicts (provisional_user_id);
