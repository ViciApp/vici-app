-- The optional VXP amount on a battle, renamed from `wager` to `amount`.
--
-- The column holds the VXP a proposer puts on a battle (0 to 500, null when
-- none); its old name came from betting vocabulary, which the product does
-- not use. A rename keeps every existing value in place, and the range check
-- moves with the column; its constraint is renamed too so the name matches.
--
-- Both steps are guarded, so a run on a database that already has `amount`
-- changes nothing.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'battles' and column_name = 'wager'
  ) then
    alter table battles rename column wager to amount;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'battles'::regclass and conname = 'battles_wager_check'
  ) then
    alter table battles rename constraint battles_wager_check to battles_amount_check;
  end if;
end
$$;
