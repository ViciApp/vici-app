-- VXP award provenance and replay-safe transfers, ahead of turning the
-- treasury on.
--
-- origin: 'live' rows were granted by this backend and are the only rows it
-- may ever pay. 'etl' rows were imported from the legacy on-chain app, which
-- already paid them to the recipients' legacy principals (or left them in a
-- state, such as a transfer that landed before its bookkeeping write, that
-- cannot be told apart from paid). The settlement claim refuses anything but
-- 'live', so an imported row is never transferred again whatever its status.
--
-- transfer_memo / transfer_created_at_ns: fixed at the first claim and reused
-- by every later attempt on the same row. The ledger deduplicates identical
-- transfers that carry created_at_time, so a reclaimed row whose earlier
-- transfer landed (the process died before marking it paid) answers
-- Duplicate instead of paying twice.

alter table vxp_awards
  add column if not exists origin text not null default 'live'
    check (origin in ('live', 'etl'));

alter table vxp_awards add column if not exists transfer_memo text;

alter table vxp_awards add column if not exists transfer_created_at_ns bigint;

-- Rows already in the table carry no provenance, so it is reconstructed from
-- how each writer stamps them. A live grant is a single autocommit insert
-- stamping earned_at_ms from the clock at insert time, so its created_at is
-- unique and within moments of earned_at_ms. The importer writes a whole
-- collection in one transaction (created_at is the transaction start, shared
-- by every row of that run) and carries the legacy earned time, which
-- precedes the import. Imported paid / failed rows also never went through
-- the claim, so processing_at is null. Any one of those marks a row as
-- imported; the only live rows that can match are streak backfill top-ups
-- (they carry the original earned time), and misreading one of those as
-- imported leaves it unpaid rather than paying anything twice.
update vxp_awards a
set origin = 'etl'
where a.origin = 'live'
  and (
    exists (
      select 1 from vxp_awards b
      where b.created_at = a.created_at and b.id <> a.id
    )
    or a.earned_at_ms < (extract(epoch from a.created_at) * 1000)::bigint - 600000
    or (a.status in ('paid', 'failed') and a.processing_at is null)
  );

-- Live rows recorded before the memo was stored with the row: give the two
-- award types whose grant memo differs from the generic vxp:<type>:<key> the
-- memo their grant path uses, so the catch-up payouts read on the ledger
-- exactly like the ones paid at grant time.
update vxp_awards
set transfer_memo = case
    when award_type = 'onboarding' then 'vxp:new-user:' || award_key
    when user_id::text = award_key then 'vxp:referral:referee'
    else 'vxp:referral:referrer'
  end
where origin = 'live'
  and transfer_memo is null
  and status in ('pending', 'processing')
  and award_type in ('onboarding', 'referral');
