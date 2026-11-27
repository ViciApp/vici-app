<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { curatedDeckStill } from '#lib/utils/landing-deck.utils.ts';

	/**
	 * A market's picture in the Markets view. A market the deck shows as a
	 * film card keeps that card's still, in the cut the deck shows on this
	 * window, so a card floating in lands on its own picture; every other
	 * market gets its generated artwork. The parent frames and sizes it.
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
		/** Pixel size the generated artwork is drawn at. */
		size: number;
		title?: string;
	}

	const { market, view, size, title }: Props = $props();

	const still = $derived(
		curatedDeckStill({
			seriesId: market.id,
			viewport: { width: innerWidth.current ?? 0, height: innerHeight.current ?? 0 }
		})
	);
</script>

{#if nonNullish(still)}
	<picture>
		<source srcset={still.cut.stillWebp} type="image/webp" />
		<img
			style:object-position={still.focus}
			alt=""
			decoding="async"
			draggable="false"
			src={still.cut.stillJpg}
		/>
	</picture>
{:else}
	<MarketArtwork bleed category={view.artOf(market)} fill seed={market.id} {size} {title} />
{/if}

<style lang="postcss">
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
