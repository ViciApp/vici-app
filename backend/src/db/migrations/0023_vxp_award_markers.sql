-- Anonymous markers of the one-time awards a hard-deleted account was paid.
--
-- The hard delete removes the account's vxp_awards rows, and a later sign-in
-- with the same identity provisions a new account under a new user id, so
-- without a trace the same person could collect the registration grant, the
-- referee bonus and every other one-time award again. The purge writes one
-- row here per paid one-time award and per sign-in identity of the account,
-- and the grant path refuses a one-time award whose marker exists.
--
-- A row holds no personal data and no user id: identity_digest is a keyed
-- one-way digest of the identity (src/vxp/award-markers.ts), award_type and
-- award_key name the award, with the account's own id written as 'self'.
-- The primary key makes a re-run of the purge a no-op.
--
-- New table, nothing to backfill: accounts purged before it existed left no
-- trace to rebuild one from.

create table if not exists vxp_award_markers (
  identity_digest text not null,
  award_type text not null,
  award_key text not null,
  created_at timestamptz not null default now(),
  primary key (identity_digest, award_type, award_key)
);
