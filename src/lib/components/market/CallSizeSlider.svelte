<script lang="ts">
	import {
		VXP_CALL_SIZE_STEP,
		VXP_MAX_CALL_SIZE,
		VXP_MIN_CALL_SIZE,
		type VxpCallSize
	} from '#lib/constants/vxp-economy.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { CallSource } from '#lib/types/order.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { clampVxpCallSize } from '#lib/utils/vxp-economy.utils.ts';

	/**
	 * The one call-size control of every surface that sizes a ViciXP call: a
	 * labelled value readout over a native range whose `min`, `max` and `step`
	 * are the economy constants, so every stop is a size the trade guard and
	 * the web2 API accept. Native range keys work (arrows move one step, Home /
	 * End jump to the bounds). At the maximum the control switches to its cap
	 * state so the upper bound is felt, not read.
	 */
	interface Props {
		value: VxpCallSize;
		onValueChange: (next: VxpCallSize) => void;
		/** The surface hosting the control, reported with each settled change. */
		source: CallSource;
	}

	const { value, onValueChange, source }: Props = $props();

	const uid = $props.id();

	const atCap = $derived(value >= VXP_MAX_CALL_SIZE);
	const fillPct = $derived(
		((value - VXP_MIN_CALL_SIZE) / (VXP_MAX_CALL_SIZE - VXP_MIN_CALL_SIZE)) * 100
	);
	const valueText = $derived(
		t({ locale: $localeStore, key: 'card.call_size_value', params: { amount: value } })
	);

	const readSize = (event: Event): VxpCallSize =>
		clampVxpCallSize({ value: Number((event.currentTarget as HTMLInputElement).value) });

	const oninput = (event: Event) => {
		const next = readSize(event);

		if (next !== value) {
			onValueChange(next);
		}
	};

	// `change` fires once the range settles (a drag released, a key step), so
	// the event counts decisions, never the values a drag passes through.
	const onchange = (event: Event) => {
		const next = readSize(event);

		if (next !== value) {
			onValueChange(next);
		}

		track({ name: 'call_size_set', source, value: next });
	};
</script>

<div class={`call-size${atCap ? ' is-cap' : ''}`}>
	<div class="call-size-head">
		<label class="eyebrow call-size-label" for="{uid}-range">
			{atCap
				? t({ locale: $localeStore, key: 'card.call_size_cap' })
				: t({ locale: $localeStore, key: 'card.call_size' })}
		</label>
		<output class="call-size-value num" for="{uid}-range">
			{value}
			<span class="call-size-unit">VXP</span>
		</output>
	</div>
	<div class="call-size-slider">
		<div class="call-size-track" aria-hidden="true">
			<div style:width="{fillPct}%" class="call-size-fill"></div>
		</div>
		<div style:left="{fillPct}%" class="call-size-handle" aria-hidden="true"></div>
		<input
			id="{uid}-range"
			class="call-size-range"
			aria-valuetext={valueText}
			max={VXP_MAX_CALL_SIZE}
			min={VXP_MIN_CALL_SIZE}
			{onchange}
			{oninput}
			step={VXP_CALL_SIZE_STEP}
			type="range"
			{value}
		/>
	</div>
</div>

<style lang="postcss">
	.call-size {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.call-size-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.call-size-label {
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.call-size.is-cap .call-size-label {
		color: var(--no);
	}

	.call-size-value {
		font-family: var(--font-mono);
		font-size: 1.375rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--laurel);
	}

	.call-size.is-cap .call-size-value {
		color: var(--no);
	}

	.call-size-unit {
		font-size: var(--t-12);
		opacity: 0.7;
		margin-left: 2px;
	}

	.call-size-slider {
		position: relative;
		height: 28px;
		margin: 0.4rem 0 0.3rem;
	}

	.call-size-track {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		transform: translateY(-50%);
		height: 6px;
		border-radius: var(--r-pill);
		background: var(--border-strong);
		overflow: hidden;
	}

	.call-size-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--laurel), #ffd27a);
		border-radius: inherit;
		transition: width 220ms var(--ease-vici);
	}

	.call-size.is-cap .call-size-fill {
		background: linear-gradient(90deg, var(--laurel), var(--no));
	}

	.call-size-handle {
		position: absolute;
		top: 50%;
		width: 22px;
		height: 22px;
		border-radius: var(--r-pill);
		background: var(--laurel);
		border: 3px solid var(--bg-surface);
		transform: translate(-50%, -50%);
		box-shadow:
			0 0 0 1px var(--laurel),
			0 3px 10px color-mix(in srgb, var(--laurel) 40%, transparent);
		pointer-events: none;
		transition:
			left 220ms var(--ease-vici),
			background 220ms var(--ease-vici),
			border-color 220ms var(--ease-vici),
			box-shadow 220ms var(--ease-vici);
	}

	.call-size.is-cap .call-size-handle {
		background: var(--no);
		box-shadow:
			0 0 0 1px var(--no),
			0 3px 8px color-mix(in srgb, var(--no) 40%, transparent);
	}

	/* The native input is transparent over the drawn track, so its keyboard
	   focus is shown on the handle it moves. */
	.call-size-slider:has(.call-size-range:focus-visible) .call-size-handle {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.call-size-range {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		margin: 0;
	}

	/* The handle glides and the fill grows toward a newly selected size;
	   under reduced motion they snap to the new position instead. */
	@media (prefers-reduced-motion: reduce) {
		.call-size-handle,
		.call-size-fill {
			transition: none;
		}
	}
</style>
