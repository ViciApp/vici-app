import { LANDING_DECK_REFRESH_INTERVAL_MS } from '#lib/constants/landing.constants.ts';
import { minuteTick_ms } from '#lib/derived/time.derived.ts';
import { loadLandingDeckSeries } from '#lib/services/landing-deck.services.ts';
import type { LandingDeckCard, LandingDeckSeries } from '#lib/types/landing.ts';
import type { Market } from '#lib/types/market.ts';
import { startPolling } from '#lib/utils/async.utils.ts';
import { toLandingDeckCard } from '#lib/utils/landing-deck.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { fromStore } from 'svelte/store';

/**
 * Live data behind the landing deck: the curated series, read through the
 * public market reads and refreshed while the tab is visible.
 *
 * `cards` holds only the series that can be shown honestly (loaded, Yes/No,
 * open, released and priced), in curated order; a series that fails is
 * simply absent. `ready` turns true once every series has answered one way
 * or the other, which is when the deck can tell which card comes first.
 */
export class LandingDeckFeed {
	readonly #series: readonly LandingDeckSeries[];
	readonly #markets = new SvelteMap<string, Market>();
	readonly #histories = new SvelteMap<string, number[]>();
	readonly #answered = new SvelteSet<string>();
	// A scheduled series joins the deck within a minute of its start.
	readonly #now = fromStore(minuteTick_ms);

	readonly cards: LandingDeckCard[] = $derived.by(() =>
		this.#series
			.map((entry) =>
				toLandingDeckCard({
					entry,
					market: this.#markets.get(entry.seriesId),
					history: this.#histories.get(entry.seriesId),
					now: this.#now.current
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
						if (isNullish(market)) {
							this.#markets.delete(entry.seriesId);
							this.#histories.delete(entry.seriesId);
						} else {
							this.#markets.set(entry.seriesId, market);
						}

						this.#answered.add(entry.seriesId);
					},
					onHistory: (history) => this.#histories.set(entry.seriesId, history)
				});
				this.#answered.add(entry.seriesId);
			})
		);
	}
}
