<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import MarketProbabilitySkeleton from '#lib/components/market/MarketProbabilitySkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingCallSide } from '#lib/types/landing-call.ts';
	import type { Market } from '#lib/types/market.ts';
	import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatSettleCountdown, sidePercents } from '#lib/utils/landing-markets.utils.ts';

	/**
	 * One market in the Markets list: one decision per row. Art, the
	 * question with when it settles, the price, Yes / No. The row opens the
	 * market's detail; Yes / No hand the call to the page.
	 */
	interface Props {
		market: Market;
		title: string;
		artCategory: FlowArtCategory;
		nowMs: number;
		/** Position in the list, for the staggered entrance. */
		index: number;
		selected: boolean;
		detailId: string;
		onselect: () => void;
		oncall: (side: LandingCallSide) => void;
	}

	const { market, title, artCategory, nowMs, index, selected, detailId, onselect, oncall }: Props =
		$props();

	// Rows past the first screen enter together.
	const STAGGER_LIMIT = 10;

	const percents = $derived(sidePercents(market.yesProbability));
	const settlesWhen = $derived(
		formatSettleCountdown({ expiryMs: Number(market.expiryDate), nowMs, locale: $localeStore })
	);
</script>

<li style:--lmr-i={Math.min(index, STAGGER_LIMIT)} class="lmr" class:is-selected={selected}>
	<button
		class="lmr-open"
		aria-controls={detailId}
		aria-current={selected ? 'true' : undefined}
		data-series-id={market.id}
		onclick={onselect}
		type="button"
	>
		<span class="lmr-art" aria-hidden="true">
			<MarketArtwork bleed category={artCategory} fill seed={market.id} size={96} {title} />
		</span>
		<span class="lmr-text">
			<b>{title}</b>
			<small>
				{t({ locale: $localeStore, key: 'landing.markets.settles', params: { when: settlesWhen } })}
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
	<span class="lmr-act">
		<button
			class="is-yes"
			aria-label={t({ locale: $localeStore, key: 'landing.markets.call_yes', params: { title } })}
			disabled={isNullish(percents)}
			onclick={() => oncall('yes')}
			type="button"
		>
			{t({ locale: $localeStore, key: 'landing.markets.side.yes' })}
		</button>
		<button
			class="is-no"
			aria-label={t({ locale: $localeStore, key: 'landing.markets.call_no', params: { title } })}
			disabled={isNullish(percents)}
			onclick={() => oncall('no')}
			type="button"
		>
			{t({ locale: $localeStore, key: 'landing.markets.side.no' })}
		</button>
	</span>
</li>

<style lang="postcss">
	.lmr {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 14px;
		padding: 10px 12px;
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

	@media (hover: hover) and (pointer: fine) {
		.lmr:not(.is-selected):hover {
			background: var(--lm-pane-a);
		}
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

	/* The whole row is the target; the Yes / No sit above it. */
	.lmr-open::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
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

	.lmr-act {
		position: relative;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		min-width: 112px;
	}

	.lmr-act button {
		height: 34px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-pill);
		font: 700 14px/1 var(--font-display);
		cursor: pointer;
		transition:
			transform 140ms var(--ease-vici),
			background 160ms ease;
	}

	.lmr-act button:active:not(:disabled) {
		transform: scale(0.96);
	}

	.lmr-act button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.lmr-act button:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	.is-yes {
		background: color-mix(in srgb, var(--yes) 18%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--yes) 24%, transparent);
		color: var(--yes);
	}

	.is-no {
		background: color-mix(in srgb, var(--no) 18%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--no) 24%, transparent);
		color: var(--no);
	}

	@media (hover: hover) and (pointer: fine) {
		.is-yes:hover:not(:disabled) {
			background: color-mix(in srgb, var(--yes) 24%, transparent);
		}

		.is-no:hover:not(:disabled) {
			background: color-mix(in srgb, var(--no) 24%, transparent);
		}
	}

	@media (min-width: 901px) {
		.lmr {
			margin-left: -10px;
		}
	}

	/* Phones: the price beside the question, Yes / No on their own line. */
	@media (max-width: 900px) {
		.lmr {
			grid-template-columns: minmax(0, 1fr);
			gap: 8px;
			padding: 12px 10px;
		}

		.lmr-open {
			align-items: start;
			gap: 8px 12px;
		}

		.lmr-act {
			justify-content: flex-start;
			min-width: 0;
			padding-left: 56px;
		}

		.lmr-act button {
			height: 44px;
			padding: 0 20px;
			font-size: 15px;
		}

		.lmr.is-selected {
			box-shadow: none;
		}
	}

	@media (pointer: coarse) {
		.lmr-act button {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmr {
			animation-name: lmr-fade;
			animation-duration: 160ms;
			animation-delay: 0s;
		}

		.lmr-act button {
			transition: none;
		}
	}

	@keyframes lmr-fade {
		from {
			opacity: 0;
		}
	}
</style>
