<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { SIDE_LABEL_KEYS, sidePercents } from '#lib/utils/landing-markets.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';
	import { vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	/**
	 * The lead's call: Yes / No at the live price with what each earns at the
	 * current size; once called, what was called and what it earns; once any
	 * call is made here, that calls open with the waitlist.
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
		size: number;
	}

	const { market, view, size }: Props = $props();

	const percents = $derived(sidePercents(market.yesProbability));
	const called = $derived(view.calledOf(market));

	const earns = (action: 'YES' | 'NO'): string =>
		formatWholeVxpMagnitude(
			vxpNetWin({ amount: size, pWin: resolveOutcomeExecutionPrice({ market, action }) })
		);
</script>

{#if nonNullish(called)}
	<p class="lmlk-pay">
		<b>
			{t({
				locale: $localeStore,
				key: 'landing.markets.called.with',
				params: {
					side: t({ locale: $localeStore, key: SIDE_LABEL_KEYS[called.side] }),
					amount: called.amountVxp
				}
			})}
		</b>
		{t({
			locale: $localeStore,
			key: 'landing.markets.called.earn',
			params: { amount: formatWholeVxpMagnitude(called.earnsVxp) }
		})}
	</p>
{:else}
	<div class="lmlk-cta" class:is-used={view.used()}>
		<button
			class="is-yes"
			disabled={isNullish(percents)}
			onclick={() => view.oncall({ market, side: 'yes' })}
			type="button"
		>
			{nonNullish(percents)
				? t({ locale: $localeStore, key: 'landing.markets.yes_at', params: { pct: percents.yes } })
				: t({ locale: $localeStore, key: 'landing.markets.side.yes' })}
		</button>
		<button
			class="is-no"
			disabled={isNullish(percents)}
			onclick={() => view.oncall({ market, side: 'no' })}
			type="button"
		>
			{nonNullish(percents)
				? t({ locale: $localeStore, key: 'landing.markets.no_at', params: { pct: percents.no } })
				: t({ locale: $localeStore, key: 'landing.markets.side.no' })}
		</button>
	</div>
	{#if nonNullish(percents)}
		<p class="lmlk-pay">
			{view.used()
				? t({ locale: $localeStore, key: 'landing.markets.waitlist' })
				: t({
						locale: $localeStore,
						key: 'landing.markets.lead.payout',
						params: { amount: size, yes: earns('YES'), no: earns('NO') }
					})}
			<span>{t({ locale: $localeStore, key: 'signin.legal.line1' })}</span>
		</p>
	{/if}
{/if}

<style lang="postcss">
	.lmlk-cta {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		pointer-events: auto;
	}

	.lmlk-cta button {
		height: var(--lml-cta-height, 46px);
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-pill);
		font: 700 15px/1 var(--font-display);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			transform 140ms var(--ease-vici),
			background 160ms ease;
	}

	.lmlk-cta button:active:not(:disabled) {
		transform: scale(0.96);
	}

	.lmlk-cta button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.lmlk-cta button:focus-visible {
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

	/* After a call the buttons step back: the next call opens with the claim. */
	.lmlk-cta.is-used button {
		background: var(--lm-pane-a);
		box-shadow: none;
		color: var(--lm-quiet);
	}

	.lmlk-pay {
		margin: -6px 0 0;
		min-height: 18px;
		font: 500 13px/1.4 var(--font-display);
		color: var(--lm-quiet);
	}

	.lmlk-pay b {
		font-weight: 700;
		color: var(--parchment);
	}

	.lmlk-pay span {
		display: block;
	}

	@media (pointer: coarse) {
		.lmlk-cta button {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmlk-cta button {
			transition: none;
		}
	}
</style>
