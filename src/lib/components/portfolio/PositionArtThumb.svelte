<script lang="ts" module>
	import { SvelteSet } from 'svelte/reactivity';

	// Module-scope so the "only fade once per marketId+result" guard
	// survives component remounts (table sort / filter / virtualization /
	// page navigation back-and-forth). Component-instance state would
	// reset on every mount and re-trigger the crossfade.
	const seen = new SvelteSet<string>();
</script>

<script lang="ts">
	import FlowArtFrame from '#lib/components/artwork/FlowArtFrame.svelte';
	import { resolveFlowArtCategory, type FlowArtState } from '#lib/utils/flow-art.utils.ts';

	interface Props {
		// Stable seed — `market.id` for parity with FlowCard.
		marketId: string | number;
		// The market's stored `tags` (micros first, then free tags). The
		// renderer resolves the artwork macro from them and falls back to a
		// hash-based pick when they're missing or carry no micros.
		tags?: readonly string[];
		// Final state for resolved positions. `'neutral'` means the
		// position is still open or there is no recorded outcome — the
		// thumb sits in neutral and never crossfades.
		result?: FlowArtState;
		// Output size in CSS px. Spec checks 80 / 140 / 220 — list rows
		// use the smaller end (44 / 56) for a tight thumbnail.
		size?: number;
		// Optional layout class for outer wrapper sizing.
		class?: string;
	}

	const {
		marketId,
		tags = [],
		result = 'neutral',
		size = 56,
		class: extraClass = ''
	}: Props = $props();

	let faded = $state(false);

	// React to `result` transitions, not just initial mount — `result`
	// can flip from 'neutral' → 'won' / 'lost' when the parent's
	// market data arrives async after the row first renders.
	$effect(() => {
		if (result === 'neutral') {
			faded = false;

			return;
		}

		const key = `${marketId}::${result}`;

		if (seen.has(key)) {
			faded = true;

			return;
		}

		// One-tick delay so the neutral SVG paints first; the overlay
		// then fades in over the spec's hero duration.
		const id = setTimeout(() => {
			faded = true;
			seen.add(key);
		}, 80);

		return () => clearTimeout(id);
	});

	const category = $derived(resolveFlowArtCategory({ tags, seed: marketId }));
	const showOverlay = $derived(result !== 'neutral');
</script>

<div style:width="{size}px" style:height="{size}px" class="position-art-thumb {extraClass}">
	<FlowArtFrame class="position-art-base" {category} seed={marketId} {size} state="neutral" />
	{#if showOverlay}
		<div class="position-art-overlay" class:has-faded={faded}>
			<FlowArtFrame
				class="position-art-resolved"
				{category}
				seed={marketId}
				{size}
				state={result}
			/>
		</div>
	{/if}
</div>

<style lang="postcss">
	.position-art-thumb {
		position: relative;
		display: inline-block;
		flex: 0 0 auto;
		line-height: 0;
	}
	.position-art-overlay {
		position: absolute;
		inset: 0;
		opacity: 0;
		transition: opacity var(--d-hero) var(--ease-vici);
		pointer-events: none;
	}
	.position-art-overlay.has-faded {
		opacity: 1;
	}
	/* Both inner FlowArtFrame children inherit their own border-radius
	   + inset-hi shadow — strip the outer wrapper's bookkeeping so they
	   align pixel-for-pixel during the crossfade. */
	.position-art-thumb :global(.position-art-base),
	.position-art-thumb :global(.position-art-resolved) {
		display: block;
	}
</style>
