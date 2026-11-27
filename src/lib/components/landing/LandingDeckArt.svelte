<script lang="ts">
	import LandingDeckMedia from '#lib/components/landing/LandingDeckMedia.svelte';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import type { LandingDeckSeries } from '#lib/types/landing.ts';
	import { resolveFlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { hasDeckFilm, type DeckViewport } from '#lib/utils/landing-deck.utils.ts';

	interface Props {
		entry: LandingDeckSeries;
		viewport: DeckViewport;
		/** The footage options below apply to an entry that has footage; artwork ignores them. */
		clip?: boolean;
		playing?: boolean;
		priority?: boolean;
		preload?: boolean;
	}

	const {
		entry,
		viewport,
		clip = false,
		playing = false,
		priority = false,
		preload = false
	}: Props = $props();

	// The artwork is drawn square and letterboxes in any other shape. A
	// centred square as large as the card's longer side covers the card the
	// way a still does, cropping the overflow instead of leaving bands.
	const side = $derived(Math.max(viewport.width, viewport.height));
</script>

<!-- The picture behind a card: its footage where the deck has some, the
     market's own generated artwork for a series that has none. -->
{#if hasDeckFilm(entry)}
	<LandingDeckMedia {clip} {entry} {playing} {preload} {priority} {viewport} />
{:else}
	<div style:width="{side}px" class="art" aria-hidden="true" data-landing-deck-art>
		<MarketArtwork
			bleed
			category={resolveFlowArtCategory({ tags: [], seed: entry.seriesId })}
			fill
			seed={entry.seriesId}
		/>
	</div>
{/if}

<style lang="postcss">
	.art {
		position: absolute;
		top: 50%;
		left: 50%;
		aspect-ratio: 1;
		pointer-events: none;
		transform: translate(-50%, -50%);
	}
</style>
