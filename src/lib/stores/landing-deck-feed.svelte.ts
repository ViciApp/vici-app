import { LANDING_DECK_REFRESH_INTERVAL_MS } from '#lib/constants/landing.constants.ts';
import { loadLandingDeckSeries } from '#lib/services/landing-deck.services.ts';
import type { LandingDeckCard, LandingDeckSeries } from '#lib/types/landing.ts';
import type { Market } from '#lib/types/market.ts';
import { startPolling } from '#lib/utils/async.utils.ts';
import { toLandingDeckCard } from '#lib/utils/landing-deck.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

/**
 * Live data behind the landing deck: the curated series, read through the
 * public market reads and refreshed while the tab is visible.
 *
 * `cards` holds only the series that can be shown honestly (loaded, open and
 * priced), in curated order; a series that fails is simply absent. `ready`
 * turns true once every series has answered one way or the other, which is
 * when the deck can tell which card comes first.
 */
export class LandingDeckFeed {
	readonly #series: readonly LandingDeckSeries[];
	readonly #markets = new SvelteMap<string, Market>();
	readonly #histories = new SvelteMap<string, number[]>();
	readonly #answered = new SvelteSet<string>();

	readonly cards: LandingDeckCard[] = $derived.by(() =>
		this.#series
			.map((entry) =>
				toLandingDeckCard({
					entry,
					market: this.#markets.get(entry.seriesId),
					history: this.#histories.get(entry.seriesId)
				})
			)
			.filter(nonNullish)
	);

	readonly ready: boolean = $derived.by(() =>
		this.#series.every(({ seriesId }) => this.#answered.has(seriesId))
	);

	constructor(series: readonly LandingDeckSeries[]) {
		this.#series = series;
	}

	card(seriesId: string): LandingDeckCard | undefined {
		return this.cards.find(({ entry }) => entry.seriesId === seriesId);
	}

	/** Read now, then keep the prices fresh. Returns the stop function. */
	start(): () => void {
		return startPolling({
			onLoad: async () => {
				// A hidden tab shows nothing: skip the read, keep the schedule.
				if (!document.hidden) {
					await this.#load();
				}
			},
			onShouldUseSlowInterval: () => Promise.resolve(false),
			fastIntervalMs: LANDING_DECK_REFRESH_INTERVAL_MS,
			slowIntervalMs: LANDING_DECK_REFRESH_INTERVAL_MS,
			runImmediately: true
		});
	}

	async #load(): Promise<void> {
		await Promise.all(
			this.#series.map(async (entry) => {
				await loadLandingDeckSeries({
					entry,
					onMarket: (market) => {
						this.#markets.set(entry.seriesId, market);
						this.#answered.add(entry.seriesId);
					},
					onHistory: (history) => this.#histories.set(entry.seriesId, history)
				});
				this.#answered.add(entry.seriesId);
			})
		);
	}
}
