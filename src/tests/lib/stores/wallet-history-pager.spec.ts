import { ICP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type {
	WalletTransactionsCursors,
	WalletTransactionsDone
} from '#lib/services/wallet.services.ts';
import type { WalletHistoryPager as WalletHistoryPagerType } from '#lib/stores/wallet-history-pager.svelte.ts';
import type { Transaction } from '#lib/types/wallet.ts';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

interface Page {
	transactions: Transaction[];
	cursors: WalletTransactionsCursors;
	done: WalletTransactionsDone;
	hasMore: boolean;
}

interface PageRequest {
	batchSize: bigint;
	cursors?: WalletTransactionsCursors;
	resolve: (page: Page) => void;
}

const tx = (id: string): Transaction => ({
	id,
	user: 'aaaaa-aa',
	timestamp: BigInt(1),
	type: 'Receive',
	source: 'ledger',
	domain: 'wallet',
	amount: BigInt(1),
	token: ICP_TOKEN
});

const page = ({ id, cursor, hasMore }: { id: string; cursor: bigint; hasMore: boolean }): Page => ({
	transactions: [tx(id)],
	cursors: { vxp: cursor },
	done: { icp: false, ckUsdc: false, vxp: !hasMore },
	hasMore
});

// The pager keeps its fields in Svelte runes; outside the Svelte compiler a
// plain value stands in for `$state`, which is all the paging logic needs.
let WalletHistoryPager: typeof WalletHistoryPagerType;

before(async () => {
	Object.assign(globalThis, { $state: <T>(value: T): T => value });
	({ WalletHistoryPager } = await import('#lib/stores/wallet-history-pager.svelte.ts'));
});

const pagerWithManualPages = () => {
	const requests: PageRequest[] = [];
	const pager = new WalletHistoryPager({
		loadPage: ({ batchSize, cursors }) =>
			new Promise<Page>((resolve) => requests.push({ batchSize, cursors, resolve }))
	});

	return { pager, requests };
};

describe('WalletHistoryPager', () => {
	it('drops a page that lands after a reload started a new history', async () => {
		const { pager, requests } = pagerWithManualPages();

		const stale = pager.loadNext();
		const fresh = pager.reload();

		requests[1].resolve(page({ id: 'fresh', cursor: BigInt(7), hasMore: true }));
		await fresh;
		requests[0].resolve(page({ id: 'stale', cursor: BigInt(3), hasMore: false }));
		await stale;

		assert.deepEqual(
			pager.transactions.map(({ id }) => id),
			['fresh']
		);
		assert.equal(pager.hasMore, true);
		assert.equal(pager.loading, false);

		const next = pager.loadNext();
		assert.deepEqual(requests[2].cursors, { vxp: BigInt(7) });
		requests[2].resolve(page({ id: 'second', cursor: BigInt(9), hasMore: false }));
		await next;
	});

	it('keeps loading while the new page is still in flight', async () => {
		const { pager, requests } = pagerWithManualPages();

		const stale = pager.loadNext();
		const fresh = pager.setBatchSize(BigInt(50));

		requests[0].resolve(page({ id: 'stale', cursor: BigInt(3), hasMore: false }));
		await stale;

		assert.equal(pager.loading, true);
		assert.deepEqual(pager.transactions, []);
		assert.equal(pager.hasMore, true);

		assert.equal(requests[1].batchSize, BigInt(50));
		requests[1].resolve(page({ id: 'fresh', cursor: BigInt(7), hasMore: false }));
		await fresh;

		assert.deepEqual(
			pager.transactions.map(({ id }) => id),
			['fresh']
		);
		assert.equal(pager.hasMore, false);
		assert.equal(pager.loading, false);
	});
});
