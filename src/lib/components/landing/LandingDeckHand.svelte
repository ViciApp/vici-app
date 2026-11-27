<script lang="ts">
	interface Props {
		/**
		 * `arriving` fades the hand in, `pressing` sets it down on the card,
		 * `leaving` lifts it away; `still` is the reduced-motion pose, shown
		 * without any transition.
		 */
		phase: 'arriving' | 'pressing' | 'leaving' | 'still';
	}

	const { phase }: Props = $props();

	let entered = $state(false);

	// The hand mounts in its "before" pose and only then takes the phase's
	// pose, so the first phase transitions instead of appearing in place.
	$effect(() => {
		const frame = requestAnimationFrame(() => (entered = true));

		return () => cancelAnimationFrame(frame);
	});
</script>

<div
	class="hand"
	class:entered={entered || phase === 'still'}
	class:leaving={phase === 'leaving'}
	class:pressing={phase === 'pressing'}
	class:still={phase === 'still'}
	aria-hidden="true"
>
	<svg fill="none" height="64" viewBox="0 0 64 64" width="64">
		<circle class="touch" cx="27" cy="17" r="13" stroke-width="1.5" />
		<path
			class="glove"
			d="M24 31V15.5a4 4 0 0 1 8 0V27m0-1a4 4 0 0 1 8 0v3m0-1a4 4 0 0 1 8 0v14a15 15 0 0 1-15 15h-3a15 15 0 0 1-12.4-6.5L11 44a4 4 0 0 1 6.3-4.9L24 45V31"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2.2"
		/>
	</svg>
</div>

<style lang="postcss">
	.hand {
		position: absolute;
		bottom: 27%;
		left: 50%;
		z-index: 6;
		width: 64px;
		height: 64px;
		margin-left: -32px;
		opacity: 0;
		pointer-events: none;
		transform: translateY(10px) scale(1.12);
		transition:
			opacity 260ms var(--deck-ease),
			transform 320ms var(--deck-ease);
	}

	.hand.entered {
		opacity: 1;
		transform: none;
	}

	.hand.entered.pressing {
		transform: scale(0.9);
	}

	.hand.entered.leaving {
		opacity: 0;
		transform: translateY(-8px) scale(1.12);
	}

	.hand.still {
		transition: none;
	}

	.touch {
		fill: color-mix(in srgb, var(--film-fg) 16%, transparent);
		stroke: color-mix(in srgb, var(--film-fg) 55%, transparent);
	}

	.glove {
		fill: var(--film-fg);
		stroke: var(--film-bg);
	}
</style>
