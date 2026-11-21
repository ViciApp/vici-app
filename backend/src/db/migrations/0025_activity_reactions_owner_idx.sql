-- The like-received inbox lists the newest likes on one author's activities.
-- The owner sits on `activities`, so with only the global `created_at` index
-- the planner walks every newer like across all authors and filters them
-- one by one: for an author with many activities and few likes that is a
-- scan of the whole table. An activity key is `${user_id}#${timestamp}#${type}`
-- (`activityKey` in src/social/activities.ts, also for imported rows), so
-- the key's first segment is the activity owner, and this index reads one
-- author's likes directly, newest first.
--
-- An index only: no column changes and existing rows are indexed as they
-- are, so the previous release keeps working. `if not exists` makes a second
-- run a no-op.

create index if not exists activity_reactions_owner_created_idx
  on activity_reactions (split_part(activity_key, '#', 1), created_at desc);
