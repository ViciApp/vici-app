import type { LandingDeckCard } from '#lib/types/landing.ts';
import type { LandingDeckCardMotion } from '#lib/utils/landing-deck-motion.utils.ts';
import { LandingDeckTable } from '#lib/utils/landing-deck-table.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The table only reads each card's series id.
const card = (seriesId: string): LandingDeckCard =>
	({ entry: { seriesId, media: 'btc', category: 'economy' } }) as LandingDeckCard;

const A = card('a');
const B = card('b');
const C = card('c');

const newTable = (): LandingDeckTable =>
	new LandingDeckTable({ newMotion: () => ({}) as LandingDeckCardMotion });

const layout = (table: LandingDeckTable): string[] =>
	table.items.map(({ seriesId, place }) => `${place}:${seriesId}`);

describe('LandingDeckTable', () => {
	it('hands every change to onchange', () => {
		const seen: number[] = [];
		const table = new LandingDeckTable({
			newMotion: () => ({}) as LandingDeckCardMotion,
			onchange: (items) => seen.push(items.length)
		});
		table.deal({ cards: [A, B] });
		table.drop(table.top?.key ?? -1);

		assert.deepEqual(seen, [1, 2, 1]);
	});

	describe('deal', () => {
		it('lays the first card on top with the next one under it', () => {
			const table = newTable();

			assert.equal(table.deal({ cards: [A, B, C], enterFrom: 'from' }), true);
			assert.deepEqual(layout(table), ['top:a', 'under:b']);
			assert.equal(table.top?.first, true);
			assert.equal(table.top?.enterFrom, 'from');
		});

		it('deals nothing from an empty feed', () => {
			const table = newTable();

			assert.equal(table.deal({ cards: [] }), false);
			assert.deepEqual(table.items, []);
		});
	});

	describe('promote', () => {
		it('lifts the card under, throws the leaving one and deals in turn', () => {
			const table = newTable();
			table.deal({ cards: [A, B] });
			table.promote({ cards: [A, B], leaving: table.top });

			assert.deepEqual(layout(table), ['top:b', 'out:a', 'under:a']);
		});

		it('lays nothing new once the feed is empty, instead of crashing', () => {
			const table = newTable();
			table.deal({ cards: [A, B] });
			table.promote({ cards: [], leaving: table.top });

			assert.deepEqual(layout(table), ['top:b', 'out:a']);
		});

		it('keeps every key distinct', () => {
			const table = newTable();
			table.deal({ cards: [A] });
			table.promote({ cards: [A], leaving: table.top });

			const keys = table.items.map(({ key }) => key);
			assert.equal(new Set(keys).size, keys.length);
		});
	});

	describe('drop', () => {
		it('takes a card off by key', () => {
			const table = newTable();
			table.deal({ cards: [A, B] });
			const leaving = table.top;
			table.promote({ cards: [A, B], leaving });
			table.drop(leaving?.key ?? -1);

			assert.deepEqual(layout(table), ['top:b', 'under:a']);
		});
	});

	describe('reconcile', () => {
		it('leaves a table whose cards are all still live untouched', () => {
			const table = newTable();
			table.deal({ cards: [A, B] });
			const before = table.items;

			assert.equal(table.reconcile([A, B]), false);
			assert.deepEqual(table.items, before);
		});

		it('replaces a top card whose series left the feed with the one under it', () => {
			const table = newTable();
			table.deal({ cards: [A, B, C] });

			assert.equal(table.reconcile([B, C]), false);
			assert.deepEqual(layout(table), ['top:b', 'under:c']);
		});

		it('never lays the top series under itself while another one is live', () => {
			const table = newTable();
			table.deal({ cards: [A, B] });
			table.promote({ cards: [A, B], leaving: table.top });
			table.promote({ cards: [A, B], leaving: table.top });

			assert.deepEqual(layout(table), ['out:a', 'top:a', 'out:b', 'under:b']);
		});

		it('refills both places when the top and the card under it both left', () => {
			const table = newTable();
			table.deal({ cards: [A, B, C] });

			assert.equal(table.reconcile([C]), false);
			assert.deepEqual(layout(table), ['top:c', 'under:c']);
		});

		it('lets a card already flying out finish, even when its series left', () => {
			const table = newTable();
			table.deal({ cards: [A, B, C] });
			table.promote({ cards: [A, B, C], leaving: table.top });

			assert.equal(table.reconcile([B, C]), false);
			assert.deepEqual(layout(table), ['top:b', 'out:a', 'under:c']);
		});

		it('reports a table the refresh emptied, once', () => {
			const table = newTable();
			table.deal({ cards: [A, B] });

			assert.equal(table.reconcile([]), true);
			assert.deepEqual(table.items, []);
			assert.equal(table.reconcile([]), false);
		});

		it('deals again when the feed comes back', () => {
			const table = newTable();
			table.deal({ cards: [A] });
			table.reconcile([]);

			assert.equal(table.reconcile([B]), false);
			assert.deepEqual(layout(table), ['top:b', 'under:b']);
		});
	});
});
