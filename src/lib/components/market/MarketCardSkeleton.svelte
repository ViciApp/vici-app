<script lang="ts">
	import Card from '#lib/components/ui/Card.svelte';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
</script>

<Card
	class="bg-card/60 animate-pulse !border-dashed"
	data-tid={TestId.MarketCardSkeleton}
	padding="sm"
	variant="default"
>
	<div class="flex h-full w-full flex-col gap-3">
		<div class="flex items-start justify-between gap-4">
			<div class="bg-muted-foreground/20 h-5 w-28 rounded-full"></div>
			<div class="bg-muted-foreground/20 h-4 w-20 rounded-md"></div>
		</div>

		<div class="space-y-2">
			<div class="bg-muted-foreground/20 h-5 w-4/5 rounded-md"></div>
			<div class="bg-muted-foreground/10 h-3.5 w-full rounded-md"></div>
			<div class="bg-muted-foreground/10 h-3.5 w-2/3 rounded-md"></div>
		</div>

		<div class="mt-1 grid grid-cols-2 gap-2.5">
			<div class="bg-muted-foreground/10 h-14 rounded-xl"></div>
			<div class="bg-muted-foreground/10 h-14 rounded-xl"></div>
		</div>

		<div class="border-border mt-auto flex justify-end border-t pt-3">
			<div class="bg-muted-foreground/10 h-5 w-16 rounded-md"></div>
		</div>
	</div>
</Card>
