<script lang="ts">
	import OutcomeBadge from '#lib/components/market/OutcomeBadge.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		markets: Market[];
	}

	const { markets }: Props = $props();

	const RECENT_RESOLUTIONS_COUNT = 5;

	// The incoming order is the catalog's, which says nothing about when anything
	// was called: taking the first five off it showed an arbitrary sample under a
	// "Recent" heading. Sort by settlement time, newest first; markets whose
	// settlement carries no timestamp sort last rather than jumping to the top.
	const recentMarkets = $derived(
		[...markets]
			.sort((a, b) => {
				const left = a.resolvedAt ?? ZERO;
				const right = b.resolvedAt ?? ZERO;

				return right > left ? 1 : right < left ? -1 : 0;
			})
			.slice(0, RECENT_RESOLUTIONS_COUNT)
	);
</script>

<div
	class="border-border bg-card rounded-3xl border p-4 sm:p-8"
	data-tid={TestId.AdminResolutionHistory}
>
	<h2 class="text-foreground mb-6 text-2xl font-bold">
		{t({ locale: $localeStore, key: 'admin.resolution.history.title' })}
	</h2>
	<div class="space-y-4">
		{#each recentMarkets as market (market.id)}
			<div
				class="border-border flex items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0"
				data-market-id={market.id}
			>
				<span class="text-muted-foreground min-w-0 text-sm break-words">{market.title}</span>
				<div class="shrink-0">
					<OutcomeBadge outcome={market.outcome} />
				</div>
			</div>
		{/each}
	</div>
</div>
