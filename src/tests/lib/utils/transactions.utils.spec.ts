import { ICP_TOKEN as ICP, VXP_TOKEN as VXP } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { Token } from '#lib/types/token.ts';
import type { Transaction } from '#lib/types/wallet.ts';
import { mergeTransactionsPage } from '#lib/utils/transactions.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const tx = ({
	id,
	timestamp,
	token = ICP,
	amount = BigInt(1)
}: {
	id: string;
	timestamp: number;
	token?: Token;
	amount?: bigint;
}): Transaction => ({
	id,
	user: 'aaaaa-aa',
	timestamp: BigInt(timestamp),
	type: 'Receive',
	source: 'ledger',
	domain: 'wallet',
	amount,
	token
});

const ids = (txs: Transaction[]): string[] =>
	txs.map(({ id, token }) => `${id}@${token.ledgerCanisterId}`);

describe('transactions.utils', () => {
	describe('mergeTransactionsPage', () => {
		it('appends a page and sorts the result newest-first', () => {
			const merged = mergeTransactionsPage({
				transactions: [tx({ id: 'a', timestamp: 30 }), tx({ id: 'b', timestamp: 10 })],
				page: [tx({ id: 'c', timestamp: 20 }), tx({ id: 'd', timestamp: 5 })]
			});

			assert.deepEqual(ids(merged), [
				`a@${ICP.ledgerCanisterId}`,
				`c@${ICP.ledgerCanisterId}`,
				`b@${ICP.ledgerCanisterId}`,
				`d@${ICP.ledgerCanisterId}`
			]);
		});

		it('keeps one row per id and ledger, the page row winning', () => {
			const merged = mergeTransactionsPage({
				transactions: [tx({ id: 'a', timestamp: 10, amount: BigInt(1) })],
				page: [tx({ id: 'a', timestamp: 10, amount: BigInt(2) })]
			});

			assert.equal(merged.length, 1);
			assert.equal(merged[0].amount, BigInt(2));
		});

		it('keeps the same id on two ledgers as two rows', () => {
			const merged = mergeTransactionsPage({
				transactions: [tx({ id: '7', timestamp: 10, token: ICP })],
				page: [tx({ id: '7', timestamp: 20, token: VXP })]
			});

			assert.deepEqual(ids(merged), [`7@${VXP.ledgerCanisterId}`, `7@${ICP.ledgerCanisterId}`]);
		});

		it('returns an empty list for two empty inputs', () => {
			assert.deepEqual(mergeTransactionsPage({ transactions: [], page: [] }), []);
		});
	});
});
