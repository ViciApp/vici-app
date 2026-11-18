-- Data-migration (ETL) support: provisional accounts for principals whose
-- owner has not signed in on this stack yet, an extra provenance value for
-- ETL-created principal links, and the cursor store the drain scripts resume
-- from.

-- A provisional user is created by the importer for a principal with no
-- legacy_principals link: it owns the imported rows until the real person
-- signs in with a matching email and the login auto-match claims it. The flag
-- marks the account as "no verified sign-in identity yet".
alter table users
  add column if not exists claim_pending boolean not null default false;

-- ETL-created links carry their own provenance so a claim flow can tell an
-- email-verified match from a provisional import link.
alter table legacy_principals drop constraint if exists legacy_principals_matched_via_check;
alter table legacy_principals
  add constraint legacy_principals_matched_via_check
  check (matched_via in ('openid_email', 'profile_email', 'etl'));

-- Keyset cursors for the resumable drain scripts. One row per script; the
-- cursor is the last fully processed page key, deleted on completion so the
-- next invocation re-walks from the start (that re-walk is the cutover delta
-- pass, kept cheap by upsert semantics downstream).
create table if not exists etl_cursors (
  id text primary key check (id <> ''),
  cursor text not null,
  updated_at timestamptz not null default now()
);
