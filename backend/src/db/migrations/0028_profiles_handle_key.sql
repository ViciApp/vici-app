-- The lookalike key of every handle: `profiles.handle_key`.
--
-- Two handles are the same one when they hold the same letters and digits
-- once case, accents and everything else are ignored, so `antonio.ventilii`
-- and `antonioventilii` share the key `antonioventilii`. The availability
-- check and the profile write guard refuse a handle whose key another account
-- holds. `nickname_key` and its unique index stay: two lookalikes that predate
-- the rule share one `handle_key`, so this column cannot be unique.
--
-- `handle_fold` is the SQL twin of `handleUniqueKey`
-- (backend/src/profiles/nickname.ts), held to it by a parity test. Uppercase
-- forms of the letter table are spelled out because `lower` only folds ASCII
-- under the C locale.
--
-- Fly runs this before the new API machines take traffic, and the old ones
-- keep serving until the rollout ends. An old machine does not know the
-- column, so a trigger fills it from the nickname on insert, and on an update
-- that changes the nickname but leaves `handle_key` alone. A follow-up release,
-- once every handle follows the rule, drops the trigger, the function and the
-- column.
--
-- Every step is guarded or replaces itself, so a second run changes nothing.

create or replace function handle_fold(raw text) returns text
language sql immutable strict parallel safe as $$
  select regexp_replace(
    translate(
      replace(replace(replace(replace(replace(replace(replace(replace(
        lower(normalize(raw, NFKD)),
        'ß', 'ss'), 'ẞ', 'ss'),
        'æ', 'ae'), 'Æ', 'ae'),
        'œ', 'oe'), 'Œ', 'oe'),
        'þ', 'th'), 'Þ', 'th'),
      'øØłŁđĐðÐı', 'oollddddi'),
    '[^a-z0-9]', '', 'g')
$$;

alter table profiles add column if not exists handle_key text not null default '';

update profiles set handle_key = handle_fold(nickname) where handle_key is distinct from handle_fold(nickname);

create index if not exists profiles_handle_key_idx on profiles (handle_key) where handle_key <> '';

create or replace function profiles_handle_key_from_nickname() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.handle_key = '' then
      new.handle_key := handle_fold(new.nickname);
    end if;
  elsif new.nickname is distinct from old.nickname and new.handle_key is not distinct from old.handle_key then
    new.handle_key := handle_fold(new.nickname);
  end if;

  return new;
end
$$;

drop trigger if exists profiles_handle_key_from_nickname on profiles;
create trigger profiles_handle_key_from_nickname
  before insert or update on profiles
  for each row execute function profiles_handle_key_from_nickname();
