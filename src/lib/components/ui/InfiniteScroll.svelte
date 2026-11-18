<script lang="ts">
	import { onMount } from 'svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';

	interface Props {
		loading: boolean;
		hasMore?: boolean;
		rootMargin?: string;
		onLoadMore?: () => void;
	}

	let { loading, hasMore = false, rootMargin = '400px', onLoadMore }: Props = $props();

	let observer: IntersectionObserver | undefined;
	let sentinel: HTMLElement | undefined = $state();

	$effect(() => {
		if (sentinel && hasMore && !loading && onLoadMore) {
			observer?.disconnect();
			observer = new IntersectionObserver(
				(entries) => {
					if (entries[0].isIntersecting) {
						onLoadMore();
					}
				},
				{ rootMargin }
			);
			observer.observe(sentinel);
		} else {
			observer?.disconnect();
		}
	});

	onMount(() => () => observer?.disconnect());
</script>

{#if hasMore}
	<div class="flex h-10 w-full items-center justify-center">
		<div bind:this={sentinel} class="h-1 w-full"></div>
		{#if loading}
			<LoadingSpinner size="sm" />
		{/if}
	</div>
{/if}
