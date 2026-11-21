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
 * queries them); a reset restores it. `loadPage` is the page source, the
 * ledger indexes unless a caller supplies another.
 */
export class WalletHistoryPager {
	transactions = $state<Transaction[]>([]);
	batchSize = $state<bigint>(DEFAULT_BATCH_SIZE);
	loading = $state(false);
	hasMore = $state(true);

	#cursors: WalletTransactionsCursors = {};
	#done: WalletTransactionsDone;
	// Bumped by every reset: a page that was in flight when the history was
	// reset (reload, batch-size change) belongs to the old history and must
	// not write its cursors, rows or loading flag over the new one.
	#generation = 0;
	readonly #initialDone: () => WalletTransactionsDone;
	readonly #loadPage: typeof getTransactionsPage;

	constructor({
		initialDone = () => ({ icp: false, ckUsdc: false, vxp: false }),
		loadPage = getTransactionsPage
	}: {
		initialDone?: () => WalletTransactionsDone;
		loadPage?: typeof getTransactionsPage;
	} = {}) {
		this.#initialDone = initialDone;
		this.#done = initialDone();
		this.#loadPage = loadPage;
	}

	reset = (): void => {
		this.#generation++;
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
		const generation = this.#generation;

		try {
			const { transactions, cursors, done, hasMore } = await this.#loadPage({
				batchSize: this.batchSize,
				cursors: this.#cursors,
				done: this.#done
			});

			if (generation !== this.#generation) {
				return;
			}

			this.transactions = mergeTransactionsPage({
				transactions: this.transactions,
				page: transactions
			});
			this.#cursors = cursors;
			this.#done = done;
			this.hasMore = hasMore;
		} finally {
			if (generation === this.#generation) {
				this.loading = false;
			}
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
