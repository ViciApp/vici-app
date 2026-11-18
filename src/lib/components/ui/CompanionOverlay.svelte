<script lang="ts">
	import Companion from '#lib/components/ui/Companion.svelte';
	import { companionStore, dismissCompanion } from '#lib/stores/companion.store.ts';
</script>

{#if $companionStore}
	{@const msg = $companionStore}
	<Companion
		anchor={msg.anchor}
		dwell_ms={msg.dwell_ms}
		lightning={msg.lightning}
		line={msg.line}
		mood={msg.mood}
		onDismiss={dismissCompanion}
		stage={msg.stage}
		sticky={msg.sticky}
		who={msg.who}
	/>
{/if}
