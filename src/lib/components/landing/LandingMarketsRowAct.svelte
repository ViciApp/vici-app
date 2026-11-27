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
	 * A row's call: Yes / No, then the call confirmed in the row (the side,
	 * its price, the size and what a right call earns) before it is made.
	 * Empty once this market is called.
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
		title: string;
		size: number;
	}

	const { market, view, title, size }: Props = $props();

	const percents = $derived(sidePercents(market.yesProbability));
	const pending = $derived(view.pendingOf(market));

	let confirmButton = $state<HTMLButtonElement | undefined>(undefined);

	// Keyboard users land on Confirm as it replaces the button they pressed.
	$effect(() => {
		if (nonNullish(pending)) {
			confirmButton?.focus({ preventScroll: true });
		}
	});

	const pendingText = $derived.by(() => {
		if (isNullish(pending) || isNullish(percents)) {
			return '';
		}

		const action = pending === 'yes' ? 'YES' : 'NO';

		return t({
			locale: $localeStore,
			key: 'landing.markets.pending',
			params: {
				side: t({ locale: $localeStore, key: SIDE_LABEL_KEYS[pending] }),
				pct: pending === 'yes' ? percents.yes : percents.no,
				amount: size,
				earns: formatWholeVxpMagnitude(
					vxpNetWin({ amount: size, pWin: resolveOutcomeExecutionPrice({ market, action }) })
				)
			}
		});
	});
</script>

{#if isNullish(view.calledOf(market))}
	<span class="lmra" class:is-pending={nonNullish(pending)} class:is-used={view.used()}>
		{#if nonNullish(pending)}
			<span class="lmra-confirm" aria-live="polite">{pendingText}</span>
			<button
				bind:this={confirmButton}
				class="lmra-ok"
				onclick={() => view.onconfirm()}
				type="button"
			>
				{t({ locale: $localeStore, key: 'landing.markets.confirm' })}
			</button>
			<button
				class="lmra-cancel"
				aria-label={t({ locale: $localeStore, key: 'landing.markets.cancel' })}
				onclick={() => view.oncancel()}
				type="button"
			>
				<span aria-hidden="true">×</span>
			</button>
		{:else}
			<button
				class="is-yes"
				aria-label={t({ locale: $localeStore, key: 'landing.markets.call_yes', params: { title } })}
				disabled={isNullish(percents)}
				onclick={() => view.onside({ market, side: 'yes' })}
				type="button"
			>
				{t({ locale: $localeStore, key: 'outcome.yes' })}
			</button>
			<button
				class="is-no"
				aria-label={t({ locale: $localeStore, key: 'landing.markets.call_no', params: { title } })}
				disabled={isNullish(percents)}
				onclick={() => view.onside({ market, side: 'no' })}
				type="button"
			>
				{t({ locale: $localeStore, key: 'outcome.no' })}
			</button>
		{/if}
	</span>
{/if}

<style lang="postcss">
	.lmra {
		position: relative;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		min-width: 112px;
	}

	button {
		height: 34px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-pill);
		font: 700 14px/1 var(--font-display);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			transform 140ms var(--ease-vici),
			background 160ms ease;
	}

	button:active:not(:disabled) {
		transform: scale(0.96);
	}

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	button:focus-visible {
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
	.lmra.is-used button {
		background: var(--lm-pane-a);
		box-shadow: none;
		color: var(--lm-quiet);
	}

	.lmra-confirm {
		align-self: center;
		font: 600 14px/1.25 var(--font-display);
		font-variant-numeric: tabular-nums;
	}

	.lmra-ok {
		background: var(--parchment);
		box-shadow:
			inset 0 1px 0 var(--parchment),
			0 8px 18px -10px color-mix(in srgb, var(--ink-deep) 70%, transparent);
		color: var(--ink);
	}

	.lmra-cancel {
		padding: 0 11px;
		background: var(--lm-pane-a);
		color: inherit;
		font-size: 17px;
	}

	@media (max-width: 900px) {
		.lmra {
			flex-wrap: wrap;
			justify-content: flex-start;
			min-width: 0;
		}

		button {
			height: 44px;
			padding: 0 20px;
			font-size: 15px;
		}

		.lmra-cancel {
			padding: 0 14px;
		}

		.lmra-confirm {
			flex: 1 1 100%;
		}
	}

	@media (pointer: coarse) {
		button {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
