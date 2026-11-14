<script lang="ts">
	interface Props {
		class?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'current';
		/**
		 * Drop-in contextual loader: wrap the spinner in
		 * `flex justify-center py-24`. This centers it horizontally and
		 * adds vertical breathing room; it does NOT center vertically in
		 * the viewport. For full-screen states leave this off (the default)
		 * and let the caller own the centering with an explicit-height flex
		 * wrapper.
		 */
		inlinePad?: boolean;
	}

	const { class: className = '', size = 'md', inlinePad = false }: Props = $props();

	const sizeClasses = {
		xs: 'h-4 w-4',
		sm: 'h-6 w-6',
		md: 'h-10 w-10',
		lg: 'h-16 w-16',
		current: 'h-full w-full'
	};

	// Eight laurel leaves evenly spaced on the ring, each tangent to the
	// circle so the mark reads as a rotating wreath. At small sizes the
	// leaves degrade to dots and the mark still reads as a spinner.
	const LEAF_COUNT = 8;
	const LEAF_ANGLES = Array.from({ length: LEAF_COUNT }, (_, i) => (i * 360) / LEAF_COUNT);

	// One shimmer wave travels the full ring per cycle: the per-leaf delay
	// times the leaf count equals the shimmer duration, so the wave wraps
	// seamlessly.
	const SHIMMER_DELAY_S = 0.18;
</script>

<div class={inlinePad ? `flex justify-center py-24 ${className}` : className}>
	<svg
		class="laurel-ring {sizeClasses[size]}"
		aria-hidden="true"
		fill="currentColor"
		viewBox="0 0 80 80"
		xmlns="http://www.w3.org/2000/svg"
	>
		{#each LEAF_ANGLES as angle, i (angle)}
			<ellipse
				style:animation-delay={`${i * SHIMMER_DELAY_S}s`}
				class="laurel-ring-leaf"
				cx="40"
				cy="10"
				rx="6.5"
				ry="2.6"
				transform="rotate({angle} 40 40)"
			/>
		{/each}
	</svg>
</div>

<style lang="postcss">
	.laurel-ring {
		color: var(--color-primary);
		transform-box: fill-box;
		transform-origin: center;
		animation: laurel-ring-rotate 2.8s linear infinite;
	}

	.laurel-ring-leaf {
		opacity: 0.25;
		animation: laurel-ring-shimmer 1.44s ease-in-out infinite;
	}

	@keyframes laurel-ring-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes laurel-ring-shimmer {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.laurel-ring,
		.laurel-ring-leaf {
			animation: none;
		}

		.laurel-ring-leaf {
			opacity: 0.8;
		}
	}
</style>
