<script lang="ts">
	import { isNullish } from '@dfinity/utils';
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
		// focused card — the sparkline and the weekly delta then fall back to
		// the seed-based shape / prior heuristic.
		points?: number[];
		// Parallel x-fractions (0–1) placing each `points` entry on the time
		// axis. Present alongside real history; absent for the seed shape.
		pointXs?: number[];
	}

	const { market, metadata, crowdPct, crowdSide, points, pointXs }: Props = $props();

	const yesPct = $derived(crowdPct);
	const noPct = $derived(100 - yesPct);
	// Headline number must read off `crowdSide` — the majority side the
	// label shows. `crowdPct` is always the YES share, so a NO-leaning
	// market needs `noPct` here or the figure contradicts its own label.
	const crowdSidePct = $derived(crowdSide === 'YES' ? yesPct : noPct);

	// Weekly change: when real 7d history has resolved, the true move (last
	// close − first close of the window); otherwise the prior heuristic, so an
	// unloaded / untraded card reads exactly as before.
	const weekChange = $derived.by(() => {
		if (isNullish(points) || points.length < 2) {
			return;
		}

		return points[points.length - 1] - points[0];
	});
	const weekUp = $derived(isNullish(weekChange) ? yesPct >= 50 : weekChange >= 0);
	const weekDeltaPct = $derived(
		isNullish(weekChange)
			? Math.abs(yesPct - Math.max(5, yesPct - 12))
			: Math.abs(Math.round(weekChange))
	);
</script>

<section class="flow-back-block flow-community">
	<div class="flow-community-top">
		<span class={`num flow-community-pct ${crowdSide === 'YES' ? 'text-yes' : 'text-no'}`}>
			{crowdSidePct}%
			<span class="flow-community-side">{crowdSide}</span>
		</span>
		<span class={`flow-community-delta num ${weekUp ? 'flow-delta-yes' : 'flow-delta-no'}`}>
			{weekUp ? '▲' : '▼'}
			{weekDeltaPct}% {t({
				locale: $localeStore,
				key: 'card.back.this_week'
			})}
		</span>
	</div>
	<!-- Real market-wide history when FlowMode has resolved it for this card
	     (one bounded candle query, fetched only for the focused card); until
	     then `points` is absent and the sparkline falls back to its seed-based
	     shape. Event markers ("this week" days) are fed through on the seed
	     fallback and on real history (the deck card is always the 7d window,
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

	/* The community read is bare — number + sparkline sit directly on the
	   card with no surface box; only the resolution / stake / split
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
