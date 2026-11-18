import { readBattleDoc, type BattleDoc } from '#lib/types/battle.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Battle docs proposed before the rename still hold the amount as `wager` in
// Juno, so the read path must keep showing it and never write it back.

const BASE: BattleDoc = {
	id: 'bt-1',
	kind: 'league',
	sideA: 'lg-a',
	sideB: 'lg-b',
	proposer: 'principal-a',
	state: 'proposed',
	kickoffMs: 1,
	settleMs: 2
};

describe('readBattleDoc', () => {
	it('reads a legacy doc amount from `wager` and drops the old key', () => {
		const doc = readBattleDoc({ ...BASE, wager: 150 });

		assert.equal(doc.amount, 150);
		assert.equal('wager' in doc, false);
	});

	it('prefers `amount` when a doc carries both names', () => {
		assert.equal(readBattleDoc({ ...BASE, amount: 200, wager: 150 }).amount, 200);
	});

	it('keeps a doc with no amount free of the key', () => {
		const doc = readBattleDoc(BASE);

		assert.deepEqual(doc, BASE);
		assert.equal('amount' in doc, false);
	});
});
