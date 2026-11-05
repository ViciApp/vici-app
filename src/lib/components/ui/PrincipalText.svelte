<script lang="ts">
	import YouBadge from '#lib/components/ui/YouBadge.svelte';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { shortenWithMiddleEllipsis } from '#lib/utils/format.utils.ts';

	interface Props {
		principal: string;
		splitLength?: number;
		showSelfIndicator?: boolean;
	}

	const { principal, splitLength = 7, showSelfIndicator = true }: Props = $props();

	const displayPrincipal = $derived(shortenWithMiddleEllipsis({ text: principal, splitLength }));
	const isSelf = $derived(showSelfIndicator && !!$authPrincipal && principal === $authPrincipal);
</script>

<span class="inline-flex items-center gap-1.5">
	<span class="font-mono text-inherit">{displayPrincipal}</span>
	{#if isSelf}
		<YouBadge />
	{/if}
</span>
