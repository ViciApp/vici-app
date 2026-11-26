-- Challenge links: a short, unguessable link a user shares for their own call
-- on one binary market, read publicly by whoever opens it.
--
-- The web2 API stores no prediction row: a call is a set of executed fills in
-- the engine. A link therefore binds to a (user, series) and keeps the
-- position the engine says that user holds there now: side, side-framed entry
-- price and the engine time of the fill that opened the held run. The trade
-- trigger rewrites them on every trade activity and clears them together
-- when the position goes flat; nothing a client sends can set them.
-- `created_side` is the side held when the link was created, so a reader can
-- be told the challenger changed their mind.
--
-- `entry_price_bps` is the side-framed probability in basis points, rounded
-- from the engine's fixed-point price so no float is stored.
--
-- One active link per (user, series), enforced by the partial unique index:
-- creating again refreshes that row. A revoked link keeps its row until the
-- retention prune deletes it; a later create issues a new id.
--
-- `series_expiry_ms` copies the registry expiry, which is part of the series
-- id and never changes. `market_closed_at_ms` is stamped by the prune job the
-- first time it sees the market past expiry or settled, so retention counts
-- from the close without a registry read per row.
--
-- `show_identity` is the challenger's consent, per link, to show their handle
-- and avatar with the call on the public read.
--
-- `challenge_answers` holds one engine-verified answer per (link, user) and
-- goes with its link.
--
-- `referrals.challenge_id` names the link a redemption came through: a
-- challenge link is a referral channel, so it writes the same single row per
-- referee. Plain text with no foreign key, so pruning a link never touches
-- referral history. Null for every existing row and every other channel; the
-- previous release ignores it.

create table if not exists challenge_links (
  id text primary key check (id ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$'),
  challenger_user_id uuid not null references users (id) on delete cascade,
  series_id text not null,
  series_expiry_ms bigint not null,
  created_side text not null check (created_side in ('YES', 'NO')),
  side text check (side in ('YES', 'NO')),
  entry_price_bps int check (entry_price_bps between 1 and 9999),
  called_at_ms bigint,
  show_identity boolean not null default true,
  status text not null default 'active' check (status in ('active', 'revoked')),
  status_changed_at_ms bigint,
  market_closed_at_ms bigint,
  position_synced_at_ms bigint not null,
  created_at_ms bigint not null,
  check (
    (side is null and entry_price_bps is null and called_at_ms is null)
    or (side is not null and entry_price_bps is not null and called_at_ms is not null)
  ),
  check ((status = 'revoked') = (status_changed_at_ms is not null))
);

create unique index if not exists challenge_links_active_series_idx
  on challenge_links (challenger_user_id, series_id)
  where status = 'active';

create index if not exists challenge_links_challenger_created_idx
  on challenge_links (challenger_user_id, created_at_ms desc);

-- The prune job's three scans: links on markets it has not seen close yet,
-- closed markets past retention, revoked links past retention.
create index if not exists challenge_links_open_expiry_idx
  on challenge_links (series_expiry_ms)
  where market_closed_at_ms is null;

create index if not exists challenge_links_closed_idx
  on challenge_links (market_closed_at_ms)
  where market_closed_at_ms is not null;

create index if not exists challenge_links_revoked_idx
  on challenge_links (status_changed_at_ms)
  where status = 'revoked';

create table if not exists challenge_answers (
  challenge_id text not null references challenge_links (id) on delete cascade,
  answerer_user_id uuid not null references users (id) on delete cascade,
  side text not null check (side in ('YES', 'NO')),
  entry_price_bps int not null check (entry_price_bps between 1 and 9999),
  answered_at_ms bigint not null,
  primary key (challenge_id, answerer_user_id)
);

-- The hard delete clears the answers an account gave.
create index if not exists challenge_answers_answerer_idx
  on challenge_answers (answerer_user_id);

alter table referrals add column if not exists challenge_id text;
