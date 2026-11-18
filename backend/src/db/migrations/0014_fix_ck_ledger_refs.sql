-- 0003 seeded ckBTC and ckETH with ids that fail the principal checksum, so
-- every read of either asset threw before leaving the process, and in the
-- deposit watcher that throw abandoned the whole ic pass, not just those two
-- assets. 0003 is applied and immutable, so the correction lives here; a fresh
-- database replays this right after the seed and ends up with the same rows.
--
-- The ckETH value cannot be repaired by recomputing its checksum: its bytes
-- belong to the ckETH minter, not the ledger. Both replacements come from the
-- IC dashboard API, which names them "ckBTC Ledger" and "ckETH Ledger".
--
-- Matching on the bad value keeps this idempotent and leaves alone any row
-- that was already corrected by hand.
update assets
set ledger_ref = 'mxzaz-hqaaa-aaaar-qaada-cai'
where chain = 'ic' and symbol = 'ckBTC' and ledger_ref = 'mxz4u-wiaaa-aaaar-qaada-cai';

update assets
set ledger_ref = 'ss2fx-dyaaa-aaaar-qacoq-cai'
where chain = 'ic' and symbol = 'ckETH' and ledger_ref = 'ss2fx-dyaaa-aaaar-qacoa-cai';
