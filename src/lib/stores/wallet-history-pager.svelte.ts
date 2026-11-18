import {
	getTransactionsPage,
	type WalletTransactionsCursors,
	type WalletTransactionsDone
} from '#lib/services/wallet.services.ts';
import type { Transaction } from '#lib/types/wallet.ts';
import { mergeTransactionsPage } from '#lib/utils/transactions.utils.ts';

/** Page sizes the history tab offers. */
export const WALLET_HISTORY_BATCH_SIZES: readonly bigint[] = [10n, 20n, 50n];

const DEFAULT_BATCH_SIZE = 20n;

/**
 * The paged ICRC ledger history behind a wallet history tab, one instance per
 * page. `initialDone` marks the index legs a surface never pages (the admin
 * VXP console starts ICP and ckUSDC as done, so `getTransactionsPage` never
 * queries them); a reset restores it.
 */
export class WalletHistoryPager {
	transactions = $state<Transaction[]>([]);
	batchSize = $state<bigint>(DEFAULT_BATCH_SIZE);
	loading = $state(false);
	hasMore = $state(true);

	#cursors: WalletTransactionsCursors = {};
	#done: WalletTransactionsDone;
	readonly #initialDone: () => WalletTransactionsDone;

	constructor({
		initialDone = () => ({ icp: false, ckUsdc: false, vxp: false })
	}: { initialDone?: () => WalletTransactionsDone } = {}) {
		this.#initialDone = initialDone;
		this.#done = initialDone();
	}

	reset = (): void => {
		this.transactions = [];
		this.#cursors = {};
		this.#done = this.#initialDone();
		this.hasMore = true;
		this.loading = false;
	};

	loadNext = async (): Promise<void> => {
		if (this.loading || !this.hasMore) {
			return;
		}

		this.loading = true;

		try {
			const { transactions, cursors, done, hasMore } = await getTransactionsPage({
				batchSize: this.batchSize,
				cursors: this.#cursors,
				done: this.#done
			});

			this.transactions = mergeTransactionsPage({
				transactions: this.transactions,
				page: transactions
			});
			this.#cursors = cursors;
			this.#done = done;
			this.hasMore = hasMore;
		} finally {
			this.loading = false;
		}
	};

	reload = async (): Promise<void> => {
		this.reset();
		await this.loadNext();
	};

	setBatchSize = async (batchSize: bigint): Promise<void> => {
		this.batchSize = batchSize;
		await this.reload();
	};
}
