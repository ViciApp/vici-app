import type { TransactionHistoryLedgerEntry } from '#lib/utils/transaction-history.utils.ts';

export interface VxpLedgerHistory {
	entries: TransactionHistoryLedgerEntry[];
	/** True when the walk hit the page cap before reaching the oldest tx. */
	truncated: boolean;
}

/**
 * The VXP ledger history of the signed-in user, or `undefined` when none can
 * be read, which the transactions page shows as its unavailable state. The
 * VXP index keys history by principal, which the browser does not hold (the
 * API keeps the custodial keys), and the API exposes no custodial transfer
 * feed yet, so there is no ledger history to walk.
 */
export const loadVxpLedgerHistory = (): Promise<VxpLedgerHistory | undefined> =>
	Promise.resolve(undefined);
