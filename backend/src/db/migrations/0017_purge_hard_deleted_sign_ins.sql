-- Sign-in paths of accounts hard-deleted before the cascade removed them.
--
-- The hard delete now removes an account's auth identities, sessions and
-- pending one-time codes together with its domain rows, so the user id can
-- never be signed into again and its email does not outlive the account.
-- Accounts purged before that still hold those rows; this removes them.
-- Re-running finds nothing left to delete.

delete from otp_codes o
using auth_identities ai
join users u on u.id = ai.user_id
where u.hard_deleted_at is not null
  and ai.email is not null
  and lower(o.email) = lower(ai.email);

delete from auth_identities ai
using users u
where u.id = ai.user_id and u.hard_deleted_at is not null;

delete from sessions s
using users u
where u.id = s.user_id and u.hard_deleted_at is not null;
