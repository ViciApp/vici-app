-- The days on which a user did something the server itself recorded.
--
-- The daily-streak milestones and the comeback restore used to read the
-- profile's dailyStreak and lastActiveDay, which the client writes freely, so
-- one profile write could declare any streak or any absence. Those awards now
-- read this table instead. A row is a UTC calendar day (server time) on which
-- the user made an executed fill in the engine (its fill timestamp) or a Flow
-- swipe the API recorded (the server clock at the swipe). The primary key makes
-- every write an idempotent upsert: a day is recorded once however often it is
-- seen, and the engine fills can be replayed into it at will.
--
-- New table, no backfill here: each user's fill days are recorded from the
-- engine on their next trade, and Flow swipes count from now on.

create table if not exists activity_days (
  user_id uuid not null references users (id) on delete cascade,
  day_key text not null check (day_key ~ '^\d{4}-\d{2}-\d{2}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, day_key)
);
