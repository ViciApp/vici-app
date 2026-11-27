import type { LandingDeckCard } from '#lib/types/landing.ts';
import type { LandingDeckCardMotion } from '#lib/utils/landing-deck-motion.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

export type DeckPlace = 'under' | 'top' | 'out';

export interface DeckItem {
	key: number;
	seriesId: string;
	motion: LandingDeckCardMotion;
	place: DeckPlace;
	first: boolean;
	enterFrom?: string;
}

type DeckCards = readonly LandingDeckCard[];

/**
 * The cards on the landing deck's table: the top card, the one under it and
 * any still flying out. Deals from the live feed in turn and keeps the table
 * whole when a refresh takes a card away. Plain data: every change of
 * `items` is handed to `onchange`, so the deck can mirror it into its state.
 */
export class LandingDeckTable {
	#items: readonly DeckItem[] = [];

	readonly #newMotion: () => LandingDeckCardMotion;
	readonly #onchange: (items: readonly DeckItem[]) => void;
	#nextKey = 0;
	#cursor = 0;

	constructor({
		newMotion,
		onchange = () => {}
	}: {
		newMotion: () => LandingDeckCardMotion;
		onchange?: (items: readonly DeckItem[]) => void;
	}) {
		this.#newMotion = newMotion;
		this.#onchange = onchange;
	}

	get items(): readonly DeckItem[] {
		return this.#items;
	}

	#set(items: readonly DeckItem[]): void {
		this.#items = items;
		this.#onchange(items);
	}

	get top(): DeckItem | undefined {
		return this.items.find(({ place }) => place === 'top');
	}

	/** The first card on top with one under it; `false` when there is nothing to deal. */
	deal({ cards, enterFrom }: { cards: DeckCards; enterFrom?: string }): boolean {
		const first = this.#lay({ cards, first: true });

		if (isNullish(first)) {
			return false;
		}

		this.#set([first]);
		this.promote({ cards, enterFrom });

		return true;
	}

	/** The card underneath becomes the top card, `leaving` flies out, a fresh one is laid under. */
	promote({
		cards,
		leaving,
		enterFrom
	}: {
		cards: DeckCards;
		leaving?: DeckItem;
		enterFrom?: string;
	}): void {
		const staying = this.items.filter((item) => item !== leaving);
		const nextTop =
			staying.find(({ place }) => place === 'under') ??
			staying.find(({ place }) => place === 'top');
		const fresh = this.#lay({ cards, avoid: nextTop?.seriesId });

		this.#set([
			...staying.map((item) =>
				item.place === 'under' ? { ...item, place: 'top' as const, enterFrom } : item
			),
			...(nonNullish(leaving) ? [{ ...leaving, place: 'out' as const }] : []),
			...(nonNullish(fresh) ? [fresh] : [])
		]);
	}

	drop(key: number): void {
		this.#set(this.items.filter((item) => item.key !== key));
	}

	/**
	 * After a refresh: drop the cards whose series left the feed (settled,
	 * expired, unpriced; one already flying out finishes its exit), then
	 * refill the top and the card under it from what is left. `true` when the
	 * refresh emptied a table that was in play.
	 */
	reconcile(cards: DeckCards): boolean {
		const live = this.items.filter(
			({ place, seriesId }) =>
				place === 'out' || cards.some(({ entry }) => entry.seriesId === seriesId)
		);
		const dropped = live.length < this.items.length;
		this.#set(live);

		// Each pass lays a card under, lifting the one under to the top when
		// the top is gone: at most two passes.
		while (
			cards.length > 0 &&
			(isNullish(this.top) || !this.items.some(({ place }) => place === 'under'))
		) {
			this.promote({ cards });
		}

		return dropped && cards.length === 0;
	}

	/**
	 * A fresh card from the feed, in turn, skipping `avoid` (the series about
	 * to be on top) when another one can be shown; `undefined` when the feed
	 * is empty.
	 */
	#lay({
		cards,
		first = false,
		avoid
	}: {
		cards: DeckCards;
		first?: boolean;
		avoid?: string;
	}): DeckItem | undefined {
		if (cards.length === 0) {
			return;
		}

		if (cards.length > 1 && cards[this.#cursor % cards.length].entry.seriesId === avoid) {
			this.#cursor += 1;
		}

		const { entry } = cards[this.#cursor % cards.length];
		this.#cursor += 1;

		return {
			key: this.#nextKey++,
			seriesId: entry.seriesId,
			motion: this.#newMotion(),
			place: 'under',
			first
		};
	}
}
