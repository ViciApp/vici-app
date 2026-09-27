-- VXP award provenance and replay-safe transfers, ahead of turning the
-- treasury on.
--
-- origin: 'live' rows are the only rows this backend may ever pay. 'etl'
-- rows are not paid here: rows imported from the legacy on-chain app were
-- already settled to the recipients' legacy principals (or sit in a state,
-- such as a transfer that landed before its bookkeeping write, that cannot
-- be told apart from paid), and the importer keeps stamping future imports
-- 'etl'. The settlement claim refuses anything but 'live'.
--
-- transfer_memo / transfer_created_at_ns: fixed for a row and reused by every
-- later attempt, so the ledger deduplicates a replay of a transfer that
-- already landed (within its 24-hour window) instead of paying twice.
-- transfer_attempts bounds how often a transfer the ledger history proves
-- never landed is sent again.
--
-- needs_ledger_check: a row whose transfer may have landed but was never
-- confirmed (an ambiguous error, a failed replay, or a stale claim whose
-- stamp is past the dedup window). It is not payable until the ledger
-- history settles it: found means paid, provably absent means send again,
-- anything less certain means it stays put.

alter table vxp_awards
  add column if not exists origin text not null default 'live'
    check (origin in ('live', 'etl'));

alter table vxp_awards add column if not exists transfer_memo text;

alter table vxp_awards add column if not exists transfer_created_at_ns bigint;

alter table vxp_awards
  add column if not exists transfer_attempts integer not null default 0;

alter table vxp_awards drop constraint if exists vxp_awards_status_check;

alter table vxp_awards
  add constraint vxp_awards_status_check
  check (status in ('pending', 'processing', 'paid', 'failed', 'needs_ledger_check'));

drop index if exists vxp_awards_status_idx;

create index if not exists vxp_awards_status_idx
  on vxp_awards (status)
  where status in ('pending', 'processing', 'needs_ledger_check');

-- Every row that exists when this migration runs is non-payable, whatever
-- its status. Rows imported before the origin stamp existed cannot be told
-- apart from live grants with certainty, and pre-migration 'processing' rows
-- were sent without created_at_time, so the ledger could not deduplicate a
-- replay of a transfer that landed before a crash. At this point production
-- had a single real sign-in on this stack, so nothing genuinely owed is lost
-- by this: any such award shows in the admin treasury backlog
-- (importedUnsettledCount) for manual handling, and nothing that predates
-- this migration is ever paid automatically.
update vxp_awards set origin = 'etl' where origin <> 'etl';
