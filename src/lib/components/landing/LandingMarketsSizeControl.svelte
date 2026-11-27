<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { callSizeStopIndex, callSizeStops } from '#lib/utils/vxp-economy.utils.ts';

	/**
	 * The call-size slider above Yes / No in the Markets detail. It steps
	 * through `callSizeStops()`, so its range and steps follow the VXP
	 * economy constants rather than numbers of its own.
	 */
	interface Props {
		/** Call size in VXP. */
		value: number;
		onchange: (value: number) => void;
	}

	const { value, onchange }: Props = $props();

	const uid = $props.id();

	const stops = callSizeStops();
	const lastIndex = stops.length - 1;

	const index = $derived(callSizeStopIndex({ value }));
	const fillPercent = $derived(lastIndex > 0 ? (index / lastIndex) * 100 : 0);
	const valueText = $derived(
		t({ locale: $localeStore, key: 'landing.markets.size.value', params: { amount: value } })
	);

	const oninput = (event: Event): void => {
		const next = stops[Number((event.currentTarget as HTMLInputElement).value)];

		if (next !== value) {
			onchange(next);
		}
	};
</script>

<div class="lms">
	<label for="{uid}-size">{t({ locale: $localeStore, key: 'landing.markets.size.label' })}</label>
	<output for="{uid}-size">{valueText}</output>
	<input
		id="{uid}-size"
		style:--lms-fill="{fillPercent}%"
		aria-valuetext={valueText}
		max={lastIndex}
		min={0}
		{oninput}
		step={1}
		type="range"
		value={index}
	/>
</div>

<style lang="postcss">
	.lms {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 2px 12px;
		margin: 0 2px 4px;
		font: 500 13px/1.3 var(--font-display);
		color: color-mix(in srgb, var(--parchment) 64%, transparent);
	}

	output {
		font: 700 14px/1.3 var(--font-display);
		color: var(--parchment);
		font-variant-numeric: tabular-nums;
	}

	input {
		--lms-track: color-mix(in srgb, var(--parchment) 20%, transparent);
		grid-column: 1 / -1;
		width: 100%;
		height: 28px;
		margin: 0;
		background: none;
		cursor: pointer;
		touch-action: pan-y;
		appearance: none;
	}

	input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(
			90deg,
			var(--parchment) var(--lms-fill),
			var(--lms-track) var(--lms-fill)
		);
	}

	input::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: var(--lms-track);
	}

	input::-moz-range-progress {
		height: 4px;
		border-radius: 2px;
		background: var(--parchment);
	}

	input::-webkit-slider-thumb {
		width: 20px;
		height: 20px;
		margin-top: -8px;
		border: 0;
		border-radius: 50%;
		background: var(--parchment);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--ink-deep) 50%, transparent);
		transition: transform 140ms var(--ease-vici);
		appearance: none;
	}

	input::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border: 0;
		border-radius: 50%;
		background: var(--parchment);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--ink-deep) 50%, transparent);
	}

	input:active::-webkit-slider-thumb {
		transform: scale(1.15);
	}

	input:focus-visible {
		border-radius: var(--r-8);
		outline: 2px solid var(--parchment);
		outline-offset: 4px;
	}

	@media (max-width: 900px) {
		input {
			height: 44px;
		}
	}

	@media (pointer: coarse) {
		input {
			height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		input::-webkit-slider-thumb {
			transition: none;
		}
	}
</style>
