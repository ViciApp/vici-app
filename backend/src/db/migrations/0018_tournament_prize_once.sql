-- One tournament prize per user per tournament.
--
-- Tournament prize rows are keyed <tournamentId>_place_<n>, so the
-- (user_id, award_type, award_key) unique index only stops a second award for
-- the same place: a user could still hold place 1 and place 2 of one
-- tournament. This index keys the prize on the tournament alone (the part of
-- the key before '_place_'), so two grants for different places of the same
-- tournament collide in the database, including two concurrent ones, and the
-- grant's conflict clause turns the second into a no-op.
--
-- Only rows this backend grants (origin 'live') are covered: rows imported
-- from the legacy on-chain app keep whatever they held there, and the
-- importer's own upsert must not trip over them. The grant path also refuses a
-- user who already holds an imported prize for the tournament.
--
-- Building the index fails if a user already holds two live prizes for one
-- tournament; those rows need an operator's decision before this can run.

create unique index if not exists vxp_awards_tournament_prize_once_idx
  on vxp_awards (user_id, split_part(award_key, '_place_', 1))
  where award_type = 'tournament_prize' and origin = 'live';
