<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import type { Snippet } from 'svelte';
	import LandingMarketsArt from '#lib/components/landing/LandingMarketsArt.svelte';
	import LandingMarketsRowAct from '#lib/components/landing/LandingMarketsRowAct.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		formatSettleCountdown,
		SIDE_LABEL_KEYS,
		sidePercents
	} from '#lib/utils/landing-markets.utils.ts';

	/**
	 * One market in the Markets list: one decision per row. Art, the
	 * question with when it settles (and the visitor's call once made), the
	 * price, the row's call. The row opens the market: in place on the front
	 * page (`expansion`), in the side panel in the table (`controls`).
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
		nowMs: number;
		size: number;
		/** Position in the list, for the staggered entrance. */
		index: number;
		selected: boolean;
		/** Id of what the row opens: its own expansion or the side panel. */
		controls: string;
		onselect: () => void;
		/** Front page: the market's detail, shown under the row while it is open. */
		expansion?: Snippet;
		table?: boolean;
	}

	const {
		market,
		view,
		nowMs,
		size,
		index,
		selected,
		controls,
		onselect,
		expansion,
		table = false
	}: Props = $props();

	// Rows past the first screen enter together.
	const STAGGER_LIMIT = 10;

	const title = $derived(view.titleOf(market));
	const called = $derived(view.calledOf(market));
	const percents = $derived(sidePercents(market.yesProbability));
	const settlesWhen = $derived(
		formatSettleCountdown({ expiryMs: Number(market.expiryDate), nowMs, locale: $localeStore })
	);
	const expanded = $derived(selected && !table && nonNullish(expansion));
</script>

<li
	style:--lmr-i={Math.min(index, STAGGER_LIMIT)}
	class="lmr"
	class:is-expanded={expanded}
	class:is-selected={selected}
	class:is-table={table}
>
	<div class="lmr-head">
		<button
			class="lmr-open"
			aria-controls={controls}
			aria-current={selected && table ? 'true' : undefined}
			aria-expanded={table ? undefined : expanded}
			data-series-id={market.id}
			onclick={onselect}
			type="button"
		>
			<span class="lmr-art" aria-hidden="true">
				<LandingMarketsArt {market} size={96} {title} {view} />
			</span>
			<span class="lmr-text">
				<b>{title}</b>
				{#if nonNullish(called)}
					<em>
						{t({
							locale: $localeStore,
							key: 'landing.markets.called.at',
							params: {
								side: t({ locale: $localeStore, key: SIDE_LABEL_KEYS[called.side] }),
								pct: called.pricePercent
							}
						})}
					</em>
				{/if}
				<small>
					{t({
						locale: $localeStore,
						key: 'landing.markets.settles',
						params: { when: settlesWhen }
					})}
				</small>
			</span>
			<span class="lmr-price">
				{#if nonNullish(percents)}
					{percents.yes}%
				{:else}
					<MarketProbabilitySkeleton variant={market.priceLoaded ? 'empty' : 'loading'} />
				{/if}
			</span>
		</button>
		<LandingMarketsRowAct {market} {size} {title} {view} />
	</div>
	{#if expanded}
		<div id={controls} class="lmr-expansion">
			{@render expansion?.()}
		</div>
	{/if}
</li>

<style lang="postcss">
	.lmr {
		position: relative;
		border-radius: 18px;
		animation: lmr-in 420ms var(--ease-vici) both;
		animation-delay: calc(var(--lmr-i) * 30ms);
	}

	@keyframes lmr-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	.lmr + :global(.lmr) {
		box-shadow: 0 -1px 0 color-mix(in srgb, var(--parchment) 6%, transparent);
	}

	.lmr.is-selected {
		background: var(--lm-pane-a);
		box-shadow: var(--lm-ring);
	}

	.lmr.is-selected + :global(.lmr) {
		box-shadow: none;
	}

	/* Open in place: the row and its detail read as one pane. */
	.lmr.is-expanded {
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--parchment) 24%, transparent),
			inset 1px 0 0 color-mix(in srgb, var(--parchment) 8%, transparent),
			inset -1px 0 0 color-mix(in srgb, var(--parchment) 8%, transparent),
			inset 0 -1px 0 color-mix(in srgb, var(--parchment) 8%, transparent);
	}

	@media (hover: hover) and (pointer: fine) {
		.lmr:not(.is-selected) .lmr-head:hover {
			border-radius: 18px;
			background: var(--lm-pane-a);
		}
	}

	.lmr-head {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 14px;
		padding: 10px 12px;
	}

	.lmr-open {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) auto;
		align-items: center;
		gap: 14px;
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}

	/* The whole row head is the target; the call buttons sit above it. */
	.lmr-open::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 18px;
	}

	.lmr-open:focus-visible {
		outline: none;
	}

	.lmr-open:focus-visible::after {
		outline: 2px solid var(--parchment);
		outline-offset: -2px;
	}

	.lmr-art {
		position: relative;
		display: block;
		width: 44px;
		height: 44px;
		overflow: hidden;
		border-radius: 13px;
		background: linear-gradient(140deg, var(--ink-elevated), var(--ink-raised));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--parchment) 10%, transparent);
	}

	.lmr-art :global(.market-artwork) {
		position: absolute;
		inset: 0;
	}

	.lmr-text {
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.lmr-text b {
		display: -webkit-box;
		overflow: hidden;
		font: 600 16px/1.25 var(--font-display);
		letter-spacing: -0.005em;
		text-wrap: pretty;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.lmr-text em {
		font: 600 13px/1.2 var(--font-display);
		font-style: normal;
		color: var(--parchment);
		font-variant-numeric: tabular-nums;
	}

	.lmr-text small {
		overflow: hidden;
		font: 500 13px/1.3 var(--font-display);
		color: var(--lm-quiet);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.lmr-price {
		justify-self: end;
		font: 800 20px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
	}

	.lmr-expansion {
		position: relative;
		z-index: 1;
	}

	@media (min-width: 901px) {
		.lmr.is-table {
			margin-left: -10px;
		}
	}

	/* Phones: the price beside the question, the call on its own line. */
	@media (max-width: 900px) {
		.lmr-head {
			grid-template-columns: minmax(0, 1fr);
			gap: 8px;
			padding: 12px 10px;
		}

		.lmr-open {
			align-items: start;
			gap: 8px 12px;
		}

		.lmr-head > :global(.lmra) {
			padding-left: 56px;
		}

		.lmr.is-selected:not(.is-expanded) {
			box-shadow: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmr {
			animation-name: lmr-fade;
			animation-duration: 160ms;
			animation-delay: 0s;
		}
	}

	@keyframes lmr-fade {
		from {
			opacity: 0;
		}
	}
</style>
