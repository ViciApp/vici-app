<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import type { Market } from '#lib/types/market.ts';
	import { formatProbability } from '#lib/utils/format.utils.ts';

	interface Props {
		outcomes: NonNullable<Market['outcomes']>;
		winningOutcomeId?: string;
		/**
		 * Translated outcome titles keyed by outcome id. Any id absent here
		 * falls back to the on-chain title, so callers without an active market
		 * translation can omit this entirely.
		 */
		translatedTitles?: Record<string, string>;
	}

	type MarketOutcome = NonNullable<Market['outcomes']>[number];

	const { outcomes, winningOutcomeId, translatedTitles }: Props = $props();

	const titleFor = (outcome: MarketOutcome): string =>
		translatedTitles?.[outcome.id] ?? outcome.title;

	const isResolved = $derived(nonNullish(winningOutcomeId));

	// When resolved, surface the winning outcome first even if it had a low
	// pre-settlement probability. Otherwise keep the existing probability-desc
	// ordering so the card preview shows the most likely outcomes.
	const topOutcomes = $derived.by(() => {
		const sorted = outcomes.toSorted((...[a, b]: [MarketOutcome, MarketOutcome]) => {
			if (isResolved) {
				const aWon = a.id === winningOutcomeId ? 1 : 0;
				const bWon = b.id === winningOutcomeId ? 1 : 0;

				if (aWon !== bWon) {
					return bWon - aWon;
				}
			}

			const probA = a.probability ?? 0;
			const probB = b.probability ?? 0;

			return probB - probA || a.title.localeCompare(b.title);
		});

		return sorted.slice(0, 2);
	});
</script>

<div class="border-border bg-muted/30 col-span-2 flex flex-col gap-3 rounded-xl border p-4">
	<div class="flex items-center justify-between">
		<div class="text-muted-foreground eyebrow-xs">
			{isResolved ? 'Resolved Outcome' : 'Top Outcomes'}
		</div>
		<div class="text-primary eyebrow-xs">
			{outcomes.length} total
		</div>
	</div>

	<div class="flex flex-col gap-3">
		{#each topOutcomes as outcome (outcome.id)}
			{@const isWinner = isResolved && outcome.id === winningOutcomeId}
			{@const isLoser = isResolved && !isWinner}
			<div class="flex flex-col gap-1.5 {isLoser ? 'opacity-50' : ''}">
				<div class="flex items-center justify-between text-xs">
					<span
						class="font-bold {isWinner
							? 'text-success'
							: isLoser
								? 'text-foreground line-through'
								: 'text-foreground'}"
					>
						{titleFor(outcome)}{#if isWinner}
							✓{/if}
					</span>
					<span class="text-foreground num font-bold">
						{isResolved ? (isWinner ? '100%' : '0%') : formatProbability(outcome.probability ?? 0)}
					</span>
				</div>
				<div
					class="bg-background ring-border h-1.5 w-full overflow-hidden rounded-full ring-1 ring-inset"
				>
					<div
						style="width: {isResolved ? (isWinner ? 100 : 0) : (outcome.probability ?? 0) * 100}%"
						class="h-full transition-all duration-700 ease-out {isWinner
							? 'bg-success'
							: 'bg-primary'}"
					></div>
				</div>
			</div>
		{/each}
		{#if outcomes.length > 2}
			<div class="flex items-center justify-center pt-1">
				<span class="text-primary text-[10px] font-black tracking-widest uppercase">
					+ {outcomes.length - 2} Other...
				</span>
			</div>
		{/if}
	</div>
</div>
