<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type { PriceChartMarker } from '#lib/utils/price-chart.utils.ts';

	/**
	 * The market's events under the price chart, one row each: the direction
	 * it pushed Yes, its day and its label. The plot draws the matching dots;
	 * this list is what reads them, to sighted and screen-reader users alike.
	 */
	interface Props {
		markers: PriceChartMarker[];
	}

	const { markers }: Props = $props();

	const dayLabel = (atMs: number): string =>
		new Date(atMs).toLocaleDateString($localeStore, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
</script>

<ul class="pch-events" aria-label={t({ locale: $localeStore, key: 'market.chart.events' })}>
	{#each markers as marker, index (index)}
		<li>
			<span class="pch-event-dir {marker.dir}" aria-hidden="true">
				{marker.dir === 'up' ? '▲' : '▼'}
			</span>
			<time datetime={new Date(marker.atMs).toISOString()}>{dayLabel(marker.atMs)}</time>
			<span class="pch-event-label">{marker.label}</span>
			<span class="sr-only">
				{t({
					locale: $localeStore,
					key: marker.dir === 'up' ? 'market.chart.event_up' : 'market.chart.event_down'
				})}
			</span>
		</li>
	{/each}
</ul>

<style lang="postcss">
	.pch-events {
		display: grid;
		gap: 6px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
		font: 500 13px/1.3 var(--font-display);
		color: color-mix(in srgb, var(--text-base) 64%, transparent);
	}

	.pch-events li {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}

	.pch-events time {
		flex: none;
		font-variant-numeric: tabular-nums;
	}

	.pch-event-label {
		min-width: 0;
		color: var(--text-base);
	}

	.pch-event-dir {
		flex: none;
		font-size: 0.72em;
		color: var(--color-success);
	}

	.pch-event-dir.down {
		color: var(--color-destructive);
	}
</style>
