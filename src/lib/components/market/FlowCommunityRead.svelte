<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import FlowCardSparkline from '#lib/components/market/FlowCardSparkline.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { MarketMetadata } from '#lib/types/market-metadata.ts';
	import type { CallSide, Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		market: Market;
		metadata?: MarketMetadata;
		// Crowd-side derived state piped down from FlowCard so the front
		// and back read off the same numbers (avoids two `derived`
		// computations diverging on float rounding).
		crowdPct: number;
		crowdSide: CallSide;
		// Real, market-wide 7d price history (0–100 YES series, oldest first)
		// from the clearing canister. Absent until FlowMode resolves it for the
		// focused card: the sparkline is then flat at the live price and the
		// weekly delta is hidden.
		points?: number[];
		// Parallel x-fractions (0–1) placing each `points` entry on the time
		// axis. Present alongside real history.
		pointXs?: number[];
	}

	const { market, metadata, crowdPct, crowdSide, points, pointXs }: Props = $props();

	const yesPct = $derived(crowdPct);
	const noPct = $derived(100 - yesPct);
	// Headline number must read off `crowdSide`, the majority side the
	// label shows. `crowdPct` is always the YES share, so a NO-leaning
	// market needs `noPct` here or the figure contradicts its own label.
	const crowdSidePct = $derived(crowdSide === 'YES' ? yesPct : noPct);

	// Weekly change: the true move over the real 7d history (last close −
	// first close of the window). Without at least two closes there is no
	// move to report, so the delta is hidden rather than guessed.
	const weekChange = $derived.by(() => {
		if (isNullish(points) || points.length < 2) {
			return;
		}

		return points[points.length - 1] - points[0];
	});
	const weekUp = $derived(nonNullish(weekChange) && weekChange >= 0);
	const weekDeltaPct = $derived(nonNullish(weekChange) ? Math.abs(Math.round(weekChange)) : 0);
</script>

<section class="flow-back-block flow-community">
	<div class="flow-community-top">
		<span class={`num flow-community-pct ${crowdSide === 'YES' ? 'text-yes' : 'text-no'}`}>
			{crowdSidePct}%
			<span class="flow-community-side">{crowdSide}</span>
		</span>
		{#if nonNullish(weekChange)}
			<span class={`flow-community-delta num ${weekUp ? 'flow-delta-yes' : 'flow-delta-no'}`}>
				{weekUp ? '▲' : '▼'}
				{weekDeltaPct}% {t({
					locale: $localeStore,
					key: 'card.back.this_week'
				})}
			</span>
		{/if}
	</div>
	<!-- Real market-wide history when FlowMode has resolved it for this card
	     (one bounded candle query, fetched only for the focused card); until
	     then `points` is absent and the sparkline is flat at the live price.
	     Event markers ("this week" days) are fed through while loading and on
	     real history (the deck card is always the 7d window,
	     so the sparkline anchors them on its time axis); the true cold-start
	     (real but empty) suppresses them. -->
	<FlowCardSparkline
		events={isNullish(points) || points.length > 0 ? metadata?.events : []}
		{pointXs}
		{points}
		seed={market.id}
		yesPercent={yesPct}
	/>
</section>

<style lang="postcss">
	.flow-back-block {
		display: flex;
		flex-direction: column;
	}

	/* The community read is bare: number + sparkline sit directly on the
	   card with no surface box; only the resolution / call-size / split
	   blocks are framed. */
	.flow-community {
		gap: 0.25rem;
	}

	.flow-community-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.flow-community-pct {
		font-size: 1.625rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.05;
	}
	.flow-community-side {
		margin-left: 2px;
		font-size: var(--t-13);
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.flow-community-delta {
		font-size: var(--t-12);
		font-weight: 500;
	}
	.flow-delta-yes {
		color: var(--yes);
	}
	.flow-delta-no {
		color: var(--no);
	}
</style>
