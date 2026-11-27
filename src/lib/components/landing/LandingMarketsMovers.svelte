<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { sidePercents, sparklinePolyline } from '#lib/utils/landing-markets.utils.ts';
	import { formatPriceMove24h } from '#lib/utils/market-price-move.utils.ts';

	/**
	 * "Moving now": the markets with the biggest real move in 24 hours, each with
	 * its price, the move and last week's line. A tile makes its market the
	 * lead. The host passes only markets that moved.
	 */
	interface Props {
		movers: Market[];
		view: LandingMarketsView;
		headingId: string;
		onpick: (market: Market) => void;
	}

	const { movers, view, headingId, onpick }: Props = $props();

	const SPARK_WIDTH = 72;
	const SPARK_HEIGHT = 22;
</script>

<h2 id={headingId} class="lmv-heading">
	{t({ locale: $localeStore, key: 'landing.markets.moving_now' })}
</h2>
<div class="lmv" aria-labelledby={headingId} role="group">
	{#each movers as market (market.id)}
		{@const move = view.moveOf(market) ?? 0}
		{@const history = view.historyOf(market)}
		{@const percents = sidePercents(market.yesProbability)}
		<button
			class="lmv-tile"
			data-series-id={market.id}
			onclick={() => onpick(market)}
			type="button"
		>
			<small>{view.categoryOf(market) ?? ''}</small>
			<b>{view.titleOf(market)}</b>
			<span class="lmv-row">
				<span class="lmv-px">
					<b>{nonNullish(percents) ? `${percents.yes}%` : ''}</b>
					<i class={move > 0 ? 'up' : 'dn'}>{formatPriceMove24h({ move, locale: $localeStore })}</i>
				</span>
				{#if nonNullish(history)}
					<svg class="lmv-spark" aria-hidden="true" viewBox="0 0 {SPARK_WIDTH} {SPARK_HEIGHT}">
						<polyline
							fill="none"
							points={sparklinePolyline({
								values: history.yes,
								width: SPARK_WIDTH,
								height: SPARK_HEIGHT
							})}
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.6"
						/>
					</svg>
				{/if}
			</span>
		</button>
	{/each}
</div>

<style lang="postcss">
	.lmv-heading {
		margin: 6px 0 -6px;
		font: 700 18px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.02em;
	}

	.lmv {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}

	.lmv-tile {
		display: grid;
		align-content: space-between;
		gap: 10px;
		padding: 14px;
		border: 0;
		border-radius: 22px;
		background: color-mix(in srgb, var(--parchment) 6%, transparent);
		box-shadow: var(--lm-ring);
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
		transition:
			transform 140ms var(--ease-vici),
			background 160ms ease;
	}

	.lmv-tile:active {
		transform: scale(0.985);
	}

	.lmv-tile:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	@media (hover: hover) and (pointer: fine) {
		.lmv-tile:hover {
			background: var(--lm-pane-a);
		}
	}

	.lmv-tile small {
		font: 500 13px/1 var(--font-display);
		color: var(--lm-quiet);
	}

	.lmv-tile > b {
		display: -webkit-box;
		min-height: 2.5em;
		overflow: hidden;
		font: 600 15px/1.25 var(--font-display);
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.lmv-row {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 10px;
	}

	.lmv-px {
		display: grid;
		justify-items: start;
		gap: 3px;
		font-variant-numeric: tabular-nums;
	}

	.lmv-px b {
		font: 800 20px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.03em;
	}

	/* A move is information, not a side: neutral text with an arrow. */
	.lmv-px i {
		font: 500 13px/1 var(--font-display);
		font-style: normal;
		color: var(--parchment);
	}

	.lmv-px i::before {
		content: '▲\00a0';
		font-size: 0.72em;
	}

	.lmv-px i.dn::before {
		content: '▼\00a0';
	}

	.lmv-spark {
		display: block;
		flex: none;
		width: 72px;
		height: 22px;
		overflow: visible;
		color: var(--lm-quiet);
	}

	@media (max-width: 1240px) {
		.lmv {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* Phones: one row that scrolls sideways, a tile at a time. */
	@media (max-width: 900px) {
		.lmv {
			grid-auto-columns: 74%;
			grid-auto-flow: column;
			grid-template-columns: none;
			margin: 0 calc(var(--lm-pad) * -1);
			padding: 2px var(--lm-pad);
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			scrollbar-width: none;
			touch-action: pan-x pan-y;
		}

		.lmv::-webkit-scrollbar {
			display: none;
		}

		.lmv-tile {
			scroll-snap-align: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmv-tile {
			transition: none;
		}
	}
</style>
