-- Replay-safe withdrawal transfers.
--
-- transfer_memo / transfer_created_at_ns: fixed when a withdrawal first moves
-- to processing, before anything is sent, and resent unchanged on every later
-- attempt. On an ICRC ledger the pair makes a resend of a transfer that already
-- landed answer Duplicate with the original block (within the 24-hour dedup
-- window) instead of paying the user twice, so the recovery job can resend a
-- withdrawal whose first attempt ended without a definite answer.
--
-- Rows already in processing when this runs were sent without either field:
-- a resend could not be deduplicated, so they stay null and the recovery job
-- only reports them for a manual look, it never sends them again.

alter table withdrawals add column if not exists transfer_memo text;

alter table withdrawals add column if not exists transfer_created_at_ns bigint;
