// Withdrawal confirmation tick, called from the worker loop. A withdrawal
// leaves `submitted` only here: `confirmed` once its chain reports the transfer
// final, `failed` (hold refunded) on a definite on-chain failure. The deposit
// watcher counts every `submitted` row as in flight, so one left there would
// keep that much of each later deposit to the same account uncredited.

import { isNullish } from '@dfinity/utils';
import type { Asset } from '../custody/assets';
import { transitionWithdrawal } from '../custody/withdrawals';
import { query } from '../db/client';
import type { Chain } from '../lib/keys';
import { logger } from '../lib/logger';
import { getAdapter } from './registry';
import type { ChainAdapter } from './types';
import { WatchTimeoutError, withTimeout } from './watchers';

/** Rows one tick reads; least recently checked first, so a backlog rotates. */
const BATCH = 50;
const STATUS_TIMEOUT_MS = 10_000;

interface SubmittedRow extends Asset {
	withdrawal_id: string;
	tx_ref: string;
}

export const tickWithdrawalConfirmations = async ({
	adapterFor = getAdapter,
	timeout_ms = STATUS_TIMEOUT_MS
}: {
	adapterFor?: (chain: Chain) => ChainAdapter;
	timeout_ms?: number;
} = {}): Promise<void> => {
	const rows = await query<SubmittedRow>(
		`select w.id as withdrawal_id, w.tx_ref,
			 a.id, a.chain, a.symbol, a.decimals, a.ledger_ref, a.enabled
		 from withdrawals w
		 join assets a on a.id = w.asset_id
		 where w.state = 'submitted' and w.tx_ref is not null
		 order by w.updated_at
		 limit $1`,
		[BATCH]
	);
	// A chain whose node stopped answering gets no more reads this tick, so the
	// worker's other jobs are held up by at most one timeout per chain.
	const stalled = new Set<Chain>();

	for (const { withdrawal_id: id, tx_ref: txRef, ...asset } of rows) {
		const adapter = adapterFor(asset.chain);

		if (adapter.enabled && !stalled.has(asset.chain)) {
			try {
				const status = await withTimeout({
					work: adapter.transferStatus({ txRef, asset }),
					timeout_ms,
					label: `${asset.chain} transfer status`
				});

				if (status === 'pending') {
					await query(`update withdrawals set updated_at = now() where id = $1`, [id]);
				} else {
					const moved = await transitionWithdrawal({
						id,
						from: 'submitted',
						to: status,
						failureReason: status === 'failed' ? `transfer ${txRef} failed on chain` : undefined
					});

					if (isNullish(moved)) {
						logger.warn(`withdrawal ${id} left submitted before it could be ${status}`);
					}
				}
			} catch (err: unknown) {
				if (err instanceof WatchTimeoutError) {
					stalled.add(asset.chain);
				}

				logger.error(`withdrawal ${id} status check failed:`, err);
			}
		}
	}
};
