<script lang="ts">
	import { pinToVisualViewport } from '#lib/actions/pin-to-visual-viewport.ts';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { maintenanceStore } from '#lib/stores/maintenance.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

{#if $maintenanceStore}
	<!-- Above every other layer, incl. BottomSheet's z-80 scrim: while the
	     satellite is stopped for a deploy nothing behind this is actionable.
	     `use:pinToVisualViewport` drives top/left/width/height off the
	     visual viewport (iOS Chrome resolves fixed insets against the large
	     layout viewport); `h-dvh w-screen` from the top-left corner is the
	     no-visualViewport fallback — deliberately not `inset-0`, which would
	     fight the action's inline sizing. -->
	<div
		class="bg-background fixed top-0 left-0 z-[90] flex h-dvh w-screen items-center justify-center"
		role="status"
		use:pinToVisualViewport
	>
		<div class="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
			<LoadingSpinner size="lg" />
			<p class="text-foreground mt-4 text-lg font-black">
				{t({ locale: $localeStore, key: 'maintenance.title' })}
			</p>
			<p class="text-muted-foreground text-sm">
				{t({ locale: $localeStore, key: 'maintenance.body' })}
			</p>
		</div>
	</div>
{/if}
