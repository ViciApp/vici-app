<script lang="ts">
	/**
	 * Editorial radial dial showing which way a binary market leans and
	 * how strongly. The needle points straight up at 50/50 and turns toward
	 * a quarter turn left for YES consensus, right for NO consensus.
	 * The label under the dial shows the *leading side's* percentage so
	 * a market with 35% YES reads as "65%" leaning right.
	 *
	 * Drives semantic colour off the leading side (--yes / --no) rather
	 * than the category palette so it
	 * reads as a market-state indicator, not a category accent.
	 */
	import { isNullish } from '@dfinity/utils';
	import MarketOddsSkeleton from '#lib/components/market/MarketOddsSkeleton.svelte';
	import { consensusLean } from '#lib/utils/market.utils.ts';

	interface Props {
		// 0–1 YES-side probability. Clamped defensively to [0, 1].
		// `undefined` means the book isn't known yet: the dial renders an
		// upright 50/50 needle and a skeleton in place of the percentage.
		yesProbability: number | undefined;
		// Whether the order book has been read. Distinguishes *loading* (book
		// not read yet → pulsing bar) from *loaded-but-empty* (no liquidity →
		// neutral dash) when `yesProbability` is unknown.
		priceLoaded?: boolean;
		// Rendered px size (square). 42 matches the in-card dial; 56
		// works well on a wider FlowCardBack panel.
		size?: number;
	}

	const { yesProbability, priceLoaded = false, size = 42 }: Props = $props();

	const known = $derived(!isNullish(yesProbability));
	const yesPct = $derived(
		isNullish(yesProbability) ? 50 : Math.max(0, Math.min(100, Math.round(yesProbability * 100)))
	);
	// When the probability is unknown, yesPct pins to 50 so the needle stands upright.
	const lean = $derived(consensusLean(yesPct));
	const sideClass = $derived(known ? (lean.isYes ? 'yes' : 'no') : 'unknown');
</script>

<div
	class="flow-compass {sideClass}"
	aria-label={known ? `${yesPct}% YES consensus` : undefined}
	role={known ? 'img' : undefined}
>
	<svg aria-hidden="true" height={size} viewBox="0 0 42 42" width={size}>
		<!-- Outer ring -->
		<circle cx="21" cy="21" fill="none" r="18" stroke="var(--border-base)" stroke-width="1.2" />
		<!-- YES (top) and NO (bottom) pole tick marks -->
		<line stroke="var(--parchment-faint)" stroke-width="1" x1="21" x2="21" y1="2" y2="5" />
		<line stroke="var(--parchment-faint)" stroke-width="1" x1="21" x2="21" y1="37" y2="40" />
		<!-- Needle -->
		<g transform={`rotate(${lean.angle} 21 21)`}>
			<line
				stroke="var(--needle-color)"
				stroke-linecap="round"
				stroke-width="2.4"
				x1="21"
				x2="21"
				y1="21"
				y2="6"
			/>
			<circle cx="21" cy="6" fill="var(--needle-color)" r="3" />
		</g>
		<!-- Centre hub -->
		<circle cx="21" cy="21" fill="var(--needle-color)" r="2.5" />
	</svg>
	{#if known}
		<span class="flow-compass-pct num">{lean.leadingPct}%</span>
	{:else}
		<span class="flow-compass-pct num"
			><MarketOddsSkeleton variant={priceLoaded ? 'empty' : 'loading'} /></span
		>
	{/if}
</div>

<style lang="postcss">
	.flow-compass {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		flex-shrink: 0;
	}

	.flow-compass svg {
		display: block;
	}

	.flow-compass-pct {
		margin-top: 2px;
		font-size: 9.5px;
		letter-spacing: var(--tracking-wide);
		font-weight: 700;
		color: var(--text-muted);
		line-height: 1;
	}

	.flow-compass.yes {
		--needle-color: var(--yes);
	}

	.flow-compass.yes .flow-compass-pct {
		color: var(--yes);
	}

	.flow-compass.no {
		--needle-color: var(--no);
	}

	.flow-compass.no .flow-compass-pct {
		color: var(--no);
	}

	.flow-compass.unknown {
		--needle-color: var(--border-base);
	}

	.flow-compass.unknown .flow-compass-pct {
		color: var(--text-muted);
	}
</style>
