-- VXP economy: server-fired award ledger plus the referral redemption
-- record the payout path settles against.

-- One row per server-fired VXP payout. The (user, award_type, award_key)
-- unique index IS the idempotency mechanism: a duplicate trigger collides
-- instead of double-crediting, exactly like the recipient/type/key doc-key
-- scheme the awards previously relied on. Amounts are VXP base units
-- (4 decimals) in numeric, never floats.
--
-- Status lifecycle is forward-only: pending -> processing -> paid | failed.
-- A pending row with no transfer yet is the record-only mode
-- (VXP_TREASURY_DISABLED=1); the reconciliation job pays those later.
-- 'processing' is the settlement claim: a runner must atomically win the
-- pending -> processing transition before it may transfer, so concurrent
-- settlers cannot double-pay. processing_at stamps the claim so the
-- reconciler can reclaim rows stranded by a crash mid-transfer.
create table if not exists vxp_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  award_type text not null check (award_type in (
    'onboarding',
    'streak',
    'calibration',
    'referral',
    'worlds_podium',
    'tournament_prize',
    'achievement',
    'comeback',
    'flow_milestone',
    'flow_overtime',
    'league_founder'
  )),
  award_key text not null,
  -- Base units are integers by definition; the trunc check rejects a
  -- fractional insert outright (a numeric(78,0) column would silently round
  -- instead), and readers BigInt() this column, which throws on fractions.
  amount_base_units numeric not null
    check (amount_base_units > 0 and amount_base_units = trunc(amount_base_units)),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed')),
  earned_at_ms bigint not null,
  processing_at timestamptz,
  paid_at_ms bigint,
  block_index text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (user_id, award_type, award_key)
);

-- Rolling-window caps (flow overtime, calibration) count a user's awards of
-- one type by creation time; reconciliation scans by status.
create index if not exists vxp_awards_user_type_created_idx
  on vxp_awards (user_id, award_type, created_at desc);

create index if not exists vxp_awards_status_idx
  on vxp_awards (status)
  where status in ('pending', 'processing');

-- Referral redemptions: one row per referee, written at redeem time (the
-- redeem endpoint itself lands with the account phase; the payout path here
-- settles whatever rows exist). A row's diminishing-curve tier is a pure
-- function of its redemption order (redeemed_at_ms, tie-broken by referee
-- id), never of settlement timing. within_referrer_cap is null until the
-- first settlement pass records whether that tier still pays, then
-- immutable.
create table if not exists referrals (
  referee_user_id uuid primary key references users (id) on delete cascade,
  referrer_user_id uuid not null references users (id) on delete cascade,
  code text not null,
  redeemed_at_ms bigint not null,
  within_referrer_cap boolean,
  created_at timestamptz not null default now(),
  check (referee_user_id <> referrer_user_id)
);

create index if not exists referrals_referrer_idx
  on referrals (referrer_user_id, redeemed_at_ms);
