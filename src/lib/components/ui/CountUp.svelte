<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		// Final value to count up to.
		to: number;
		// Total duration of the eased ramp.
		duration_ms?: number;
	}

	const { to, duration_ms = 700 }: Props = $props();

	// Eased count-up (cubic ease-out). Reduced-motion users jump straight to
	// the final value — no rAF loop. Mirrors the chip count-up used by the
	// in-flow beats and the resolution digest so every celebratory number
	// ramps the same way.
	let shown = $state(0);

	onMount(() => {
		if (to <= 0 || prefersReducedMotion()) {
			shown = to;

			return;
		}

		let raf = 0;
		const t0 = performance.now();

		const step = (now: number) => {
			const p = Math.min(1, (now - t0) / duration_ms);
			shown = Math.round(to * (1 - Math.pow(1 - p, 3)));

			if (p < 1) {
				raf = requestAnimationFrame(step);
			}
		};

		raf = requestAnimationFrame(step);

		return () => cancelAnimationFrame(raf);
	});
</script>

{shown.toLocaleString()}
