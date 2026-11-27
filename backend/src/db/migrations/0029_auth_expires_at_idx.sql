-- The expired-auth sweep (src/auth/expired-sweep.ts) picks a bounded batch of
-- rows by `expires_at` every hour. Without an index on it, finding that batch
-- reads the whole table, so the batch limit would bound the delete but not
-- the scan, and a table of mostly live rows would be read end to end on every
-- pass for nothing.
--
-- Indexes only: no column changes, so the previous release keeps working.
-- `if not exists` makes a second run a no-op.

create index if not exists sessions_expires_at_idx on sessions (expires_at);

create index if not exists otp_codes_expires_at_idx on otp_codes (expires_at);
