<script lang="ts">
	import FlowBackContext from '#lib/components/market/FlowBackContext.svelte';
	import FlowBackHeader from '#lib/components/market/FlowBackHeader.svelte';
	import FlowBackMeta from '#lib/components/market/FlowBackMeta.svelte';
	import FlowCallSize from '#lib/components/market/FlowCallSize.svelte';
	import FlowCommunityRead from '#lib/components/market/FlowCommunityRead.svelte';
	import FlowResolutionBlock from '#lib/components/market/FlowResolutionBlock.svelte';
	import FlowWhoCalling from '#lib/components/market/FlowWhoCalling.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { MarketMetadata } from '#lib/types/market-metadata.ts';
	import type {
		CategoryAccuracySignal,
		FollowedLeanSignal,
		PriorCallSignal
	} from '#lib/types/market-signals.ts';
	import type { CallSide, Market } from '#lib/types/market.ts';
	import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';

	interface Props {
		market: Market;
		category: FlowArtCategory;
		// Crowd-side derived state piped down from FlowCard so the front
		// and back read off the same numbers (avoids two `derived`
		// computations diverging on float rounding).
		crowdPct: number;
		crowdSide: CallSide;
		metadata?: MarketMetadata;
		categoryAcc?: CategoryAccuracySignal;
		priorCall?: PriorCallSignal;
		followedLean?: FollowedLeanSignal;
		onClose: () => void;
		// Mirrors FlowCard.interactive; only the topmost card is wired
		// for the tap-to-flip-back / horizontal-swipe-commits gestures.
		interactive?: boolean;
		// Current call size (string for input-binding parity with
		// FlowMode). Drives the call-size slider and payout preview.
		tradeAmount?: string;
		// Call-size ladder change callback. Fires when a rung or the
		// native range input changes.
		onCallSizeChange?: (next: string) => void;
		// Real, market-wide price history (0–100 YES series) for the
		// community-read sparkline. Absent → seed-based fallback shape.
		points?: number[];
		// Parallel x-fractions (0–1) placing each `points` entry on the time
		// axis. Present alongside real history; absent for the seed shape.
		pointXs?: number[];
		// Translated title / resolution for the active locale, resolved by the
		// parent. Default to the on-chain originals so untranslated decks (and
		// the guided onboarding card) render unchanged.
		displayTitle?: string;
		displayResolution?: string;
		// Proactive call-size warning resolved by FlowMode, rendered on the call-size
		// slider. Defaults to `'none'` so static / preview usages stay quiet.
		callSizeWarning?: 'none' | 'unaffordable' | 'wont-finish';
	}

	const {
		market,
		category,
		crowdPct,
		crowdSide,
		metadata,
		categoryAcc,
		priorCall,
		followedLean,
		onClose,
		interactive = true,
		tradeAmount,
		onCallSizeChange,
		points,
		pointXs,
		displayTitle,
		displayResolution,
		callSizeWarning = 'none'
	}: Props = $props();

	const catColor = $derived(tagColor(category));
	// Single source for the crowd split; both faces and every section
	// read off these so float rounding can't diverge between them.
	const yesPct = $derived(crowdPct);
	const noPct = $derived(100 - yesPct);
</script>

<div style:--cat-color={catColor} class="flow-back">
	<FlowBackHeader {category} {displayTitle} {market} {priorCall} />

	<div class="flow-back-scroll">
		<FlowBackMeta {displayTitle} {market} />

		<FlowResolutionBlock {displayResolution} {market} />

		<FlowCommunityRead {crowdPct} {crowdSide} {market} {metadata} {pointXs} {points} />

		<FlowCallSize {callSizeWarning} {market} {noPct} {onCallSizeChange} {tradeAmount} {yesPct} />

		<FlowWhoCalling {followedLean} {yesPct} />

		<FlowBackContext {category} {categoryAcc} {priorCall} {yesPct} />
	</div>

	{#if !interactive}
		<button
			class="flow-back-close-sr"
			aria-label={t({ locale: $localeStore, key: 'card.back.return_aria' })}
			onclick={onClose}
			type="button"
		></button>
	{/if}
</div>

<style lang="postcss">
	.flow-back {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		border-radius: var(--r-12);
		overflow: hidden;
	}

	.flow-back-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 0.875rem 1.25rem 1.125rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.flow-back-close-sr {
		position: absolute;
		left: -9999px;
		top: 0;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
</style>
