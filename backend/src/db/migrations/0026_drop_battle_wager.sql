-- The last step of the rename in 0021_battle_amount.sql: `battles.amount` is
-- the only column for a battle's optional VXP amount.
--
-- 0021 kept the old `wager` column and a trigger that filled `amount` from it
-- while machines of the release before the rename could still serve. The
-- release before this one stopped writing `wager`, so no machine that can
-- still serve reads or writes it. `amount` has been the column the code reads
-- since 0021 (which copied every old row into it), so nothing is copied back.
--
-- The trigger goes first because it reads `wager`. Every drop is guarded, so
-- a second run changes nothing.

drop trigger if exists battles_amount_from_wager on battles;

drop function if exists battles_amount_from_wager();

alter table battles drop column if exists wager;
