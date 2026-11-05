<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import MarketOddsSkeleton from '#lib/components/market/MarketOddsSkeleton.svelte';
	import type { Outcome } from '#lib/types/market.ts';
	import { formatProbability } from '#lib/utils/format.utils.ts';

	interface Props {
		yesProbability: number | undefined;
		noProbability: number | undefined;
		priceLoaded?: boolean;
		winningOutcome?: Outcome;
	}

	const { yesProbability, noProbability, priceLoaded, winningOutcome }: Props = $props();

	const yesWon = $derived(winningOutcome === 'YES');
	const noWon = $derived(winningOutcome === 'NO');
	const isResolved = $derived(yesWon || noWon);
</script>

<div
	class="relative flex flex-col items-center rounded-xl border p-3 transition-colors {isResolved
		? noWon
			? 'border-no/30 bg-no-wash'
			: 'border-border bg-card opacity-60'
		: 'border-no/20 bg-no-wash hover:bg-no/15'}"
>
	<div
		class="eyebrow-xs mb-1 {isResolved && !noWon
			? 'text-muted-foreground line-through'
			: 'text-no'}"
	>
		No{#if noWon}
			✓{/if}
	</div>
	<div
		class="num text-lg font-black tabular-nums sm:text-xl {isResolved && !noWon
			? 'text-muted-foreground line-through'
			: 'text-no'}"
	>
		{#if isResolved}
			{noWon ? '100%' : '0%'}
		{:else if isNullish(noProbability)}
			<MarketOddsSkeleton variant={priceLoaded ? 'empty' : 'loading'} />
		{:else}
			{formatProbability(noProbability)}
		{/if}
	</div>
</div>

<div
	class="relative flex flex-col items-center rounded-xl border p-3 transition-colors {isResolved
		? yesWon
			? 'border-yes/30 bg-yes-wash'
			: 'border-border bg-card opacity-60'
		: 'border-yes/20 bg-yes-wash hover:bg-yes/15'}"
>
	<div
		class="eyebrow-xs mb-1 {isResolved && !yesWon
			? 'text-muted-foreground line-through'
			: 'text-yes'}"
	>
		Yes{#if yesWon}
			✓{/if}
	</div>
	<div
		class="num text-lg font-black tabular-nums sm:text-xl {isResolved && !yesWon
			? 'text-muted-foreground line-through'
			: 'text-yes'}"
	>
		{#if isResolved}
			{yesWon ? '100%' : '0%'}
		{:else if isNullish(yesProbability)}
			<MarketOddsSkeleton variant={priceLoaded ? 'empty' : 'loading'} />
		{:else}
			{formatProbability(yesProbability)}
		{/if}
	</div>
</div>
