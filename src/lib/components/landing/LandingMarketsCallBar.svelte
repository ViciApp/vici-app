<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import LandingMarketsSizeControl from '#lib/components/landing/LandingMarketsSizeControl.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingCallSide } from '#lib/types/landing-call.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { sidePercents } from '#lib/utils/landing-markets.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';
	import { vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	/**
	 * The Markets detail's call bar: the call-size slider and Yes / No, each
	 * labelled with what a right call earns at the chosen size (or that there
	 * is no price yet). Earnings use the order-book execution price, the same
	 * preview the app's call flow shows. Fixed under the side panel's body; `sticky` inside a front-page
	 * row, so the call stays under the thumb while the row is in view.
	 */
	interface Props {
		market: Market;
		size: number;
		onsizechange: (size: number) => void;
		oncall: (side: LandingCallSide) => void;
		sticky?: boolean;
	}

	const { market, size, onsizechange, oncall, sticky = false }: Props = $props();

	const percents = $derived(sidePercents(market.yesProbability));

	// Without a live price there is nothing honest to earn against: the
	// execution price would fall back to even odds and invent a payout.
	const earns = (action: 'YES' | 'NO'): string =>
		isNullish(percents)
			? t({ locale: $localeStore, key: 'landing.markets.earns_unknown' })
			: t({
					locale: $localeStore,
					key: 'landing.markets.earns',
					params: {
						amount: formatWholeVxpMagnitude(
							vxpNetWin({ amount: size, pWin: resolveOutcomeExecutionPrice({ market, action }) })
						)
					}
				});
</script>

<div class="lmc" class:is-sticky={sticky}>
	<LandingMarketsSizeControl onchange={onsizechange} value={size} />
	<button
		class="lmc-side is-yes"
		disabled={isNullish(percents)}
		onclick={() => oncall('yes')}
		type="button"
	>
		<b>{t({ locale: $localeStore, key: 'landing.markets.side.yes' })}</b>
		<span>{earns('YES')}</span>
	</button>
	<button
		class="lmc-side is-no"
		disabled={isNullish(percents)}
		onclick={() => oncall('no')}
		type="button"
	>
		<b>{t({ locale: $localeStore, key: 'landing.markets.side.no' })}</b>
		<span>{earns('NO')}</span>
	</button>
</div>

<style lang="postcss">
	.lmc {
		display: grid;
		flex: none;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		padding: 14px 22px calc(18px + var(--docked-footer-inset));
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--parchment) 10%, transparent);
	}

	.lmc.is-sticky {
		position: sticky;
		bottom: calc(8px + var(--docked-footer-inset));
		z-index: 2;
		margin: 0 10px 10px;
		padding: 10px;
		border-radius: 20px;
		background: var(--ink-elevated);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--parchment) 10%, transparent),
			0 18px 40px -22px color-mix(in srgb, var(--ink-deep) 80%, transparent);
	}

	.lmc.is-sticky .lmc-side {
		height: 56px;
	}

	.lmc-side {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 5px;
		min-width: 0;
		height: 60px;
		border: 0;
		border-radius: 16px;
		font: 500 13px/1 var(--font-display);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: transform 140ms var(--ease-vici);
	}

	.lmc-side b {
		font: 700 17px/1 var(--font-display);
	}

	.lmc-side span {
		max-width: 100%;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.lmc-side:active:not(:disabled) {
		transform: scale(0.96);
	}

	.lmc-side:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.lmc-side:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	.is-yes {
		background: color-mix(in srgb, var(--yes) 18%, transparent);
		color: var(--yes);
	}

	.is-no {
		background: color-mix(in srgb, var(--no) 18%, transparent);
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

	@media (prefers-reduced-motion: reduce) {
		.lmc-side {
			transition: none;
		}
	}
</style>
