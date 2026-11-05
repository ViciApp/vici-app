<script lang="ts">
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';

	interface Props {
		spinner?: boolean;
	}

	const { spinner = false }: Props = $props();
</script>

<div class="bg-card/30 fixed inset-0 z-40 flex items-center justify-center backdrop-blur-xl">
	{#if spinner}
		<LoadingSpinner size="md" />
	{/if}
</div>
