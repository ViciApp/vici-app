<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { minuteTick_ms } from '#lib/derived/time.derived.ts';
	import { listMarketTagsBySeries } from '#lib/services/market-tags.services.ts';
	import { loadMarketsProgressive } from '#lib/services/market.services.ts';
	import { loadMarketPriceCandles } from '#lib/services/trade.services.ts';
	import type { LandingMarketsHistory } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { priceHistoryQueryWindow } from '#lib/utils/market-price-history.utils.ts';

	/**
	 * Renderless data feed of the landing Markets view: the market set (the
	 * public read, refreshed on the shared minute tick), the tags, and last
	 * week's history of each series in `historyIds`, read once per mount.
	 */
	interface Props {
		historyIds: string[];
		onmarkets: (markets: Market[]) => void;
		ontags: (tags: Record<string, string[]>) => void;
		onhistory: (loaded: { seriesId: string; history: LandingMarketsHistory }) => void;
	}

	const { historyIds, onmarkets, ontags, onhistory }: Props = $props();

	let latest: Market[] | undefined;

	// Each run carries the last set forward so rows keep their price while the
	// books are re-read, and a newer run retires the one before it.
	$effect(() => {
		void $minuteTick_ms;

		let stale = false;

		void loadMarketsProgressive({
			domain: get(balanceDomain),
			previous: latest,
			onUpdate: (markets) => {
				latest = markets;
				untrack(() => onmarkets(markets));
			},
			isStale: () => stale
		}).catch(() => {
			// An unreadable catalog reads as "nothing open", never a skeleton forever.
			if (isNullish(latest)) {
				untrack(() => onmarkets([]));
			}
		});

		return () => {
			stale = true;
		};
	});

	$effect(() => {
		let stale = false;

		// Tags only add categories, search terms and art; the view works without them.
		void listMarketTagsBySeries()
			.then((tags) => {
				if (!stale) {
					ontags(tags);
				}
			})
			.catch(() => {});

		return () => {
			stale = true;
		};
	});

	// Plain bookkeeping, not state: a series is asked for once per mount.
	const requested: Record<string, true> = {};

	$effect(() => {
		historyIds
			.filter((seriesId) => !requested[seriesId])
			.forEach((seriesId) => {
				requested[seriesId] = true;

				const { startTimeNs, endTimeNs } = priceHistoryQueryWindow('7d');
				const windowEndMs = Number(endTimeNs / MILLISECOND_IN_NANOSECONDS);
				const windowStartMs = Number((startTimeNs ?? endTimeNs) / MILLISECOND_IN_NANOSECONDS);

				void loadMarketPriceCandles({
					seriesId,
					period: '7d',
					onLoad: ({ response: { yes, xs } }) =>
						onhistory({ seriesId, history: { yes, xs, windowStartMs, windowEndMs } })
				});
			});
	});
</script>
