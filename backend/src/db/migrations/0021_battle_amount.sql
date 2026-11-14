-- The optional VXP amount on a battle moves from `wager` to a new `amount`
-- column.
--
-- The column holds the VXP a proposer puts on a battle (0 to 500, null when
-- none); its old name came from betting vocabulary, which the product does
-- not use. Fly runs this before the new API machines take traffic, and the
-- old ones keep serving until the rollout ends, so `wager` stays for now:
--
-- - `amount` gets the same range check and a copy of every existing `wager`.
-- - New code reads `amount` and writes both columns, so an old machine still
--   finds its value in `wager`.
-- - An old machine writes only `wager`; the trigger fills `amount` from it on
--   insert, and on an update that changes `wager` but leaves `amount` alone.
--
-- A follow-up release, once no machine of the previous release is left, drops
-- the trigger, its function and the `wager` column, and stops writing `wager`.
--
-- Every step is guarded or replaces itself, so a second run changes nothing.

alter table battles add column if not exists amount int;

alter table battles drop constraint if exists battles_amount_check;
alter table battles add constraint battles_amount_check check (amount between 0 and 500);

update battles set amount = wager where amount is null and wager is not null;

create or replace function battles_amount_from_wager() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is null then
      new.amount := new.wager;
    end if;
  elsif new.wager is distinct from old.wager and new.amount is not distinct from old.amount then
    new.amount := new.wager;
  end if;

  return new;
end
$$;

drop trigger if exists battles_amount_from_wager on battles;
create trigger battles_amount_from_wager
  before insert or update on battles
  for each row execute function battles_amount_from_wager();
