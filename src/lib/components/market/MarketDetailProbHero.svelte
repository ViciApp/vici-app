<script lang="ts">
	import MarketOddsSkeleton from '#lib/components/market/MarketOddsSkeleton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { CallSide } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		yesPercent: number;
		noPercent: number;
		/**
		 * Whether the odds are known. When `false` the hero renders an odds
		 * skeleton in place of both percentages (and a neutral bar) rather than
		 * a misleading 0/100 split for an unpriced or empty book.
		 */
		known?: boolean;
		/**
		 * Whether the order book has been read: picks the skeleton variant when
		 * the odds are unknown (`empty` dash vs `loading` bar).
		 */
		priceLoaded?: boolean;
		/**
		 * When the market has settled, the hero reads "FINAL YES" / "FINAL
		 * NO" and dims the losing side so the winning outcome carries the
		 * weight. Defaults to the live presentation.
		 */
		resolved?: boolean;
		/** The settled binary outcome, when known. */
		resolvedOutcome?: CallSide;
	}

	const {
		yesPercent,
		noPercent,
		known = true,
		priceLoaded = false,
		resolved = false,
		resolvedOutcome
	}: Props = $props();

	// Dim the side that lost once settled (only when we know the
	// outcome). The winning side, and the live presentation, stay at
	// full strength.
	const yesLost = $derived(resolved && resolvedOutcome === 'NO');
	const noLost = $derived(resolved && resolvedOutcome === 'YES');
</script>

<!-- Probability hero: large YES percent on the left baseline-aligned
     with the "YES" eyebrow, mirrored on the right with a smaller NO
     percent. Below sits the split bar (the page's `ProbBar` equivalent:
     same shape as `forecast-split-bar` on the old card). -->
<div class="prob-hero">
	<div class="prob-hero-row">
		<div class="prob-hero-side prob-hero-yes" class:is-lost={yesLost}>
			<span class="num prob-hero-yes-pct">
				{#if known}{yesPercent}%{:else}<MarketOddsSkeleton
						variant={priceLoaded ? 'empty' : 'loading'}
					/>{/if}
			</span>
			<span class="prob-hero-eyebrow">
				{resolved
					? t({ locale: $localeStore, key: 'outcome.final_yes' })
					: t({ locale: $localeStore, key: 'outcome.yes' })}
			</span>
		</div>
		<div class="prob-hero-side prob-hero-no" class:is-lost={noLost}>
			<span class="prob-hero-eyebrow">
				{resolved
					? t({ locale: $localeStore, key: 'outcome.final_no' })
					: t({ locale: $localeStore, key: 'outcome.no' })}
			</span>
			<span class="num prob-hero-no-pct">
				{#if known}{noPercent}%{:else}<MarketOddsSkeleton
						variant={priceLoaded ? 'empty' : 'loading'}
					/>{/if}
			</span>
		</div>
	</div>

	<div class="prob-hero-bar" role="presentation">
		{#if known}
			<span style:width={`${yesPercent}%`} class="prob-hero-bar-yes"></span>
			<span style:width={`${noPercent}%`} class="prob-hero-bar-no"></span>
		{/if}
	</div>
</div>

<style lang="postcss">
	.prob-hero {
		padding: 1.25rem 1.25rem 0.75rem;
	}

	.prob-hero-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.prob-hero-side {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}

	/* Settled losing side: dimmed so the winning outcome reads as the
	   final answer. Reduced opacity only; the side keeps its colour. */
	.prob-hero-side.is-lost {
		opacity: 0.55;
	}

	.prob-hero-eyebrow {
		font-size: var(--t-11);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.prob-hero-yes .prob-hero-eyebrow {
		color: var(--yes);
	}

	.prob-hero-no .prob-hero-eyebrow {
		color: var(--no);
	}

	.prob-hero-yes-pct {
		color: var(--yes);
		font-size: 3rem;
		font-weight: 600;
		letter-spacing: -0.04em;
		line-height: 1;
	}

	.prob-hero-no-pct {
		color: var(--no);
		font-size: var(--t-24);
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
		line-height: 1;
	}

	.prob-hero-bar {
		display: flex;
		height: 0.5rem;
		margin-top: 0.625rem;
		overflow: hidden;
		border-radius: var(--r-pill);
		background: var(--bg-surface);
	}

	.prob-hero-bar-yes,
	.prob-hero-bar-no {
		display: block;
		height: 100%;
		transition: width var(--d-enter) var(--ease-vici);
	}

	.prob-hero-bar-yes {
		background: linear-gradient(90deg, var(--yes-deep), var(--yes));
	}

	.prob-hero-bar-no {
		background: var(--no);
	}
</style>
