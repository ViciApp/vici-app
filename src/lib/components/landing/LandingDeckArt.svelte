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
</script>

<!-- The picture behind a card: its footage where the deck has some, the
     market's own generated artwork for a series that has none. -->
{#if hasDeckFilm(entry)}
	<LandingDeckMedia {clip} {entry} {playing} {preload} {priority} {viewport} />
{:else}
	<div class="art" aria-hidden="true">
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
		inset: 0;
		pointer-events: none;
	}
</style>
