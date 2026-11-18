-- A client-chosen key per withdrawal request.
--
-- A client that lost the response to `POST /wallet/withdrawals` cannot tell
-- whether its withdrawal was filed, and a plain retry files a second one with
-- a second hold of the same funds. A retry that carries the first request's
-- key answers with the withdrawal that key already holds instead.
--
-- The key is unique per user, so two concurrent requests with one key collide
-- in the database and only one of them inserts a row and posts a hold. Rows
-- from before this column, and requests sent without a key, hold null and are
-- not covered: the index only spans keyed rows.

alter table withdrawals add column if not exists idempotency_key text;

create unique index if not exists withdrawals_user_idempotency_key_idx
  on withdrawals (user_id, idempotency_key)
  where idempotency_key is not null;
