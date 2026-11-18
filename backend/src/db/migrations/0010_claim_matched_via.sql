-- Account claim: a signed principal handoff from the legacy on-chain app can
-- link a principal to the calling account. The link rows it writes carry
-- matched_via = 'claim', so the check constraint (last extended by 0009)
-- gains the value.

alter table legacy_principals
  drop constraint if exists legacy_principals_matched_via_check;

alter table legacy_principals
  add constraint legacy_principals_matched_via_check
  check (matched_via in ('openid_email', 'profile_email', 'etl', 'claim'));
