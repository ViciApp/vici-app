-- A new league's invite code grows from six to ten uppercase alphanumerics,
-- so a code is far harder to guess; a league founded with a six-character
-- code keeps it and stays joinable.
--
-- The check on `leagues.invite_code` accepts both lengths. Every existing row
-- holds six characters and still passes. Fly runs this before the new API
-- machines take traffic, and an old machine keeps minting six-character
-- codes, which the widened check still accepts. The constraint is dropped
-- and added again, so a second run changes nothing.

alter table leagues drop constraint if exists leagues_invite_code_check;
alter table leagues add constraint leagues_invite_code_check
  check (invite_code ~ '^[A-Z0-9]{6}$|^[A-Z0-9]{10}$');
