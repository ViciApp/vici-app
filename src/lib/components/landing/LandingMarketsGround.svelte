<script lang="ts">
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';

	/**
	 * The ground of the Markets view: the lead's art, blurred and dimmed
	 * behind everything, gives the glass panes a colour to pick up. Dropped
	 * under reduced transparency and higher contrast.
	 */
	interface Props {
		market: Market;
		view: LandingMarketsView;
	}

	const { market, view }: Props = $props();
</script>

<div class="lmg" aria-hidden="true">
	<MarketArtwork bleed category={view.artOf(market)} fill seed={market.id} size={240} />
</div>
<div class="lmg-veil" aria-hidden="true"></div>

<style lang="postcss">
	.lmg {
		position: absolute;
		inset: -90px;
		z-index: -1;
		opacity: 0.75;
		filter: blur(70px) saturate(160%);
		pointer-events: none;
		container-type: size;
	}

	/* The art is square: size it to the larger side and centre it, so it
	   covers the frame like a poster instead of letterboxing. */
	.lmg :global(.market-artwork) {
		position: absolute;
		top: 50%;
		left: 50%;
		width: max(100cqw, 100cqh);
		height: max(100cqw, 100cqh);
		translate: -50% -50%;
	}

	.lmg-veil {
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--ink) 50%, transparent) 0%,
			color-mix(in srgb, var(--ink) 74%, transparent) 46%,
			color-mix(in srgb, var(--ink) 90%, transparent) 100%
		);
		pointer-events: none;
	}

	@media (prefers-reduced-transparency: reduce) {
		.lmg {
			display: none;
		}

		.lmg-veil {
			background: var(--ink);
		}
	}

	@media (prefers-contrast: more) {
		.lmg {
			display: none;
		}
	}
</style>
